# SplitMate

---

## What the app does

SplitMate is a shared expense tracker — think Splitwise but built from scratch. You create a group (say, "Goa Trip" or "Flat expenses"), add members, and log expenses. The app figures out who owes whom and keeps a running balance for everyone. The interesting part: when someone adds or edits an expense, everyone else in that group sees the balances update **immediately**, no refresh, no polling. There's also a personal dashboard that shows your net balance across all your groups at a glance.

---

## How to run it (from a clean clone)

**You'll need:** Python 3.11+, Node.js 18+, and a PostgreSQL database (local install or a free Supabase project both work fine).

**Step 1 — Backend**
```bash
cd splitmate/backend
cp .env.example .env
# Open .env and fill in your DATABASE_URL and a random SECRET_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Step 2 — Seed some test data**
```bash
cd backend
python seed.py
```
This creates two test accounts you can log in with right away:
- `priya@splitmate.dev` / `Test@1234`
- `ravi@splitmate.dev` / `Test@1234`

It also creates a group called "Goa Trip 🏖️" with two pre-made expenses (one equal split, one custom) so you can see how everything looks without manually entering data.

**Step 3 — Frontend**
```bash
cd ../frontend
cp .env.example .env    # already points to localhost:8000 by default
npm install
npm run dev             # opens at http://localhost:5173
```

---

## Data model

There are 7 tables. Here's how they fit together:

```
users
  ↓ owns many
groups  ←→  users  (via group_members - the many-to-many join table)
  ↓ has many
expenses
  ↓ has many
expense_splits  (one row per person in the split)

groups also has:
  → settlements  (direct "I paid you back" records)
  → activity_logs  (audit trail of what happened and when)

users also has:
  → refresh_tokens  (for auth - covered below)
```

**In plain words:**
- A user can own multiple groups and be a member of groups they didn't create.
- Each expense belongs to one group, was paid by one user, and is split among some or all members of that group. Each person's share is stored as its own row in `expense_splits`.
- Settlements let you record a repayment directly (e.g., "Ravi paid Priya ₹500") without touching expenses. The balance algorithm accounts for both expenses and settlements.
- Activity logs track every add/edit/delete for the live feed.

---

## How money is stored and how rounding works

**No floats, ever.** Every monetary value is stored as an integer in **paise** (₹1 = 100 paise). So ₹250.50 is stored as `25050`. This completely eliminates floating-point rounding bugs — you can't get a ₹0.001 discrepancy when you're doing integer arithmetic.

**Rounding rule for equal splits:**

When you can't divide evenly, the remainder goes to the first person in the list. Example:

```
₹100 split 3 ways → 10000 paise ÷ 3 = 3333 remainder 1
Shares: [3334, 3333, 3333]  ← first person absorbs the extra paisa
```

The shares always sum to exactly the total. No money appears or disappears.

---

## Stack and why

| Layer | What | Why |
|---|---|---|
| Backend | FastAPI (Python) | Async-first, great Pydantic integration for request validation |
| Database | PostgreSQL | Real constraints and cascade deletes - clean data by design |
| ORM | SQLAlchemy async | Full async support; pairs well with asyncpg |
| Frontend | React + Vite + TypeScript | Fast dev experience, type safety across the API |
| Styling | Tailwind CSS | Utility classes, no specificity wars |
| Auth | JWT + bcrypt | Industry standard; bcrypt is the correct choice for password hashing |

---

## How the refresh token flow works

**What's stored where:**
- `access_token` - saved in `localStorage`, short-lived (15 minutes), sent as an `Authorization: Bearer` header on every API call
- `refresh_token` - also saved in `localStorage`, lasts 7 days, sent **only** to the `/auth/refresh` endpoint

*(Note: in a production app the refresh token should live in an `httpOnly` cookie so JavaScript can't touch it. localStorage was chosen here to keep the demo simple - the trade-off is documented.)*

**What happens when the access token expires:**

1. A request gets a `401` response
2. An Axios interceptor in the frontend catches it before it reaches your code
3. The interceptor calls `POST /auth/refresh` with the stored refresh token
4. The server looks up the SHA-256 hash of the token in the DB and checks it isn't revoked
5. If valid: the old token is marked `revoked = true` and a brand new pair is issued (token rotation)
6. The new tokens are saved to localStorage
7. The original failed request is retried automatically with the new access token
8. Any other requests that came in during the refresh are queued and replayed once the new token arrives

If the refresh fails (token expired or revoked), the user gets sent to `/login`.

---

## How WebSockets work

**Authenticating the connection:**

The client connects like this:
```
ws://localhost:8000/ws?token=<access_token>
```

The server validates the JWT immediately on connect. If it's invalid or the wrong type, the connection is closed with code `4001` - the client never gets in.

**Making sure events only go to the right people:**

The server keeps two data structures:
- `rooms` - maps each `group_id` to the set of WebSocket connections currently watching that group
- `ws_groups` - the reverse: maps each connection back to which groups it's in (used for cleanup on disconnect)

When anything changes (expense added, edited, deleted, or a settlement recorded), the server does:
```python
await manager.broadcast_to_group(group_id, event_type, data)
```

This sends the event only to connections registered in that group's room. If you're in Group A, you never see events from Group B - there's no global broadcast.

**Handling disconnects and reconnects:**

- If you lose connection, the frontend WebSocket hook tries to reconnect with exponential backoff: waits 1s, then 2s, 4s, 8s... up to a max of 30s between attempts.
- On the server, a disconnect immediately removes you from all rooms.
- The app never depends purely on WebSocket state — everything lives in the database. If your socket is down, you can refresh the page and get current data.
- To prevent idle timeouts, the client sends a `ping` frame every 25 seconds and the server replies with `pong`.

---

## What was hard

**Balance calculation correctness** - The sign convention has to be exactly right: the person who paid gets `+amount`, each person in the split gets `-their_share`. One wrong sign and every balance is wrong. I unit-tested it manually using the seed data before hooking it up to the API.

**Equal split rounding** - The naïve `amount ÷ n` approach loses 1 paise when there's a remainder. The fix (give remainder to the first member) is simple once you see it, but the correctness proof - that shares always sum to the total - took a moment to think through carefully.

**WebSocket room scoping** - The first design I had used a single global broadcast, which is both a security issue (wrong people see wrong events) and just noisy. I rethought it into the room model where each group is its own isolated channel.

**Refresh token race condition** - If two API calls fail at the same time, both try to refresh the token simultaneously. The fix was a request queue: only the first one actually calls `/auth/refresh`, the rest wait in line and replay once the new token is ready.

---

## Known issues / what's incomplete

- Refresh token in `localStorage` - real production apps use `httpOnly` cookies to protect against XSS
- No email verification on signup
- If you're added to a new group while your session is active, your WebSocket won't join that group's room until you refresh the page
- Pagination UI isn't built yet - the backend supports `page` and `sort_by` parameters but the frontend only ever loads page 1
- No percentage split type (was a stretch goal, not attempted)
- No automated tests - everything was manually tested via Postman and the seed data

---

## What I'd improve with more time

- Move refresh token to an `httpOnly` cookie
- Add email verification
- Build the pagination and sorting UI
- Add percentage split type
- Write pytest tests for balance calculation, split validation, and auth flows
- Docker Compose setup so the whole thing starts with one command
- Deploy: backend on Render, frontend on Vercel
- Optimistic UI updates that rollback if the server rejects the change

---

## Where I used AI and what I learned

I used Claude throughout this project, being deliberate about what I handed off vs. what I worked through myself:

- **SQLAlchemy models and router structure** — Claude scaffolded the initial versions. I read through every model, understood how the cascade rules worked, and adjusted the `GroupMember` cascade so orphaned records clean up correctly on group delete.
- **WebSocket manager** — The first draft Claude produced used global broadcast. I caught the problem, understood why it was wrong (security + noise), and redesigned it to the room-based model.
- **Balance algorithm** — Claude suggested a greedy min-cash-flow approach for `simplify_debts`. I traced through it manually with the seed data to verify it actually produces correct suggestions before trusting it.
- **Tailwind component styling** — Claude generated the initial class sets. I rewrote the color palette to go darker/moodier (dark surfaces, green brand) rather than the warm-cream default look it produced.

**Things I actually learned from this project:**
- The refresh token queue pattern for handling race conditions in token refresh
- `selectinload` vs `joinedload` in SQLAlchemy async sessions — `joinedload` causes issues with async; `selectinload` is the right choice
- The WebSocket `4001` close code convention for auth failures
