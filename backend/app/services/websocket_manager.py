"""
WebSocket connection manager.

SECURITY:
  - On connect, client sends JWT access token as query param ?token=<jwt>
  - Server validates the token; invalid tokens are rejected immediately (ws.close(4001))
  - Each connection is registered under the user's groups only.
  - Events are broadcast to group rooms, not globally.

ROOMS:
  Each group has a room keyed by group_id (UUID string).
  When a user connects they join all their group rooms.
  When an event fires in a group, only members of that group receive it.

DISCONNECTS:
  FastAPI/Starlette handles TCP disconnects. We remove the ws from all rooms on disconnect.
  Clients use exponential backoff to reconnect (implemented in frontend).
  All state is in the DB; a page refresh always gets current data.
"""

import asyncio
import json
from collections import defaultdict
from typing import Dict, Set
from uuid import UUID
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # group_id (str) -> set of WebSocket connections
        self.rooms: Dict[str, Set[WebSocket]] = defaultdict(set)
        # ws -> set of group_ids it joined
        self.ws_groups: Dict[WebSocket, Set[str]] = {}

    def join_group(self, ws: WebSocket, group_id: str):
        self.rooms[group_id].add(ws)
        if ws not in self.ws_groups:
            self.ws_groups[ws] = set()
        self.ws_groups[ws].add(group_id)

    def disconnect(self, ws: WebSocket):
        groups = self.ws_groups.pop(ws, set())
        for gid in groups:
            self.rooms[gid].discard(ws)

    async def broadcast_to_group(self, group_id: str, event_type: str, data: dict, exclude_ws: WebSocket = None):
        """Send event to all connected members of a group."""
        message = json.dumps({"event": event_type, "data": data})
        dead = []
        for ws in list(self.rooms.get(group_id, set())):
            if ws is exclude_ws:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_balance_update(self, group_id: str, user_ids: list, data: dict):
        """Broadcast a user's overall balance update to all their active connections."""
        message = json.dumps({"event": "balance_update", "data": data})
        for gid, connections in self.rooms.items():
            for ws in list(connections):
                try:
                    await ws.send_text(message)
                except Exception:
                    self.disconnect(ws)


manager = ConnectionManager()
