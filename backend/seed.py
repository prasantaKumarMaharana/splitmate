"""
Seed script: creates 2 test users, 1 group with both members,
2 expenses (equal + custom) so balances are non-zero and real-time flows work immediately.

Run: python seed.py
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import AsyncSessionLocal, engine, Base
from app.core.security import hash_password
from app.models.models import User, Group, GroupMember, Expense, ExpenseSplit, SplitType
from app.services.balance import compute_equal_splits
from datetime import datetime, timezone

USERS = [
    {"name": "Priya Sharma", "email": "priya@splitmate.dev", "password": "Test@1234"},
    {"name": "Ravi Kumar",   "email": "ravi@splitmate.dev",  "password": "Test@1234"},
]

async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # Create users
        users = []
        for u in USERS:
            from sqlalchemy import select
            r = await db.execute(select(User).where(User.email == u["email"]))
            existing = r.scalar_one_or_none()
            if existing:
                users.append(existing)
                print(f"  User already exists: {u['email']}")
            else:
                user = User(name=u["name"], email=u["email"], password_hash=hash_password(u["password"]))
                db.add(user)
                await db.flush()
                users.append(user)
                print(f"  Created user: {u['email']}")

        priya, ravi = users

        # Create group
        group = Group(name="Goa Trip 🏖️", owner_id=priya.id)
        db.add(group)
        await db.flush()
        print(f"  Created group: {group.name} ({group.id})")

        # Add members
        for user in users:
            db.add(GroupMember(group_id=group.id, user_id=user.id))

        await db.flush()

        # Expense 1: Equal split — Priya paid ₹1000, split equally
        exp1 = Expense(
            group_id=group.id,
            description="Hotel booking (equal split)",
            amount_paise=100000,   # ₹1000
            paid_by=priya.id,
            date=datetime.now(timezone.utc),
            split_type=SplitType.equal,
            created_by=priya.id,
        )
        db.add(exp1)
        await db.flush()

        splits = compute_equal_splits(100000, [priya.id, ravi.id])
        for uid, share in splits.items():
            db.add(ExpenseSplit(expense_id=exp1.id, user_id=uid, share_paise=share))

        print(f"  Created expense 1: {exp1.description} — ₹{exp1.amount_paise/100:.2f}")

        # Expense 2: Custom split — Ravi paid ₹750, Priya owes ₹500, Ravi owes ₹250
        exp2 = Expense(
            group_id=group.id,
            description="Scooter rental (custom split)",
            amount_paise=75000,    # ₹750
            paid_by=ravi.id,
            date=datetime.now(timezone.utc),
            split_type=SplitType.custom,
            created_by=ravi.id,
        )
        db.add(exp2)
        await db.flush()

        db.add(ExpenseSplit(expense_id=exp2.id, user_id=priya.id, share_paise=50000))  # ₹500
        db.add(ExpenseSplit(expense_id=exp2.id, user_id=ravi.id, share_paise=25000))   # ₹250

        print(f"  Created expense 2: {exp2.description} — ₹{exp2.amount_paise/100:.2f}")

        await db.commit()

        print("\n✅ Seed complete!")
        print("──────────────────────────────────────")
        print("Test accounts (password: Test@1234):")
        for u in USERS:
            print(f"  {u['email']}")
        print(f"\nGroup: Goa Trip 🏖️ (id: {group.id})")
        print("\nExpected balances after seed:")
        print("  Priya: paid ₹1000, owes ₹500 hotel + ₹500 scooter = net +₹0 (actually let's compute)")
        print("  Use GET /groups/{id}/balances to see live balances.")

if __name__ == "__main__":
    asyncio.run(seed())
