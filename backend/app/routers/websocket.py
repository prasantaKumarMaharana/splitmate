from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.models.models import GroupMember, User
from app.services.websocket_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    """
    Authenticated WebSocket endpoint.
    Client connects with: ws://host/ws?token=<access_token>
    On connect:
      1. Validate JWT
      2. Look up user's group memberships
      3. Register connection in each group's room
    On disconnect: remove from all rooms.
    """
    # Validate token
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = payload.get("sub")

    async with AsyncSessionLocal() as db:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return

        # Get all groups the user belongs to
        groups_result = await db.execute(
            select(GroupMember.group_id).where(GroupMember.user_id == user_id)
        )
        group_ids = [str(row[0]) for row in groups_result.fetchall()]

    await websocket.accept()

    # Join all group rooms
    for gid in group_ids:
        manager.join_group(websocket, gid)

    try:
        while True:
            # Keep connection alive; handle ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
