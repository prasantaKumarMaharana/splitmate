from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import Group, GroupMember, User, ActivityLog, EventType
from app.schemas.schemas import GroupCreate, GroupOut, AddMemberRequest, MemberOut
from app.services.balance import get_group_net_balances
from app.services.websocket_manager import manager

router = APIRouter(prefix="/groups", tags=["groups"])


async def assert_member(db, group_id, user_id):
    r = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id
        )
    )
    if not r.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this group")


async def assert_owner(db, group_id, user_id):
    r = await db.execute(select(Group).where(Group.id == group_id))
    group = r.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Only the group owner can do this")
    return group


@router.post("", response_model=GroupOut, status_code=201)
async def create_group(
    body: GroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    group = Group(name=body.name, owner_id=current_user.id)
    db.add(group)
    await db.flush()

    member = GroupMember(group_id=group.id, user_id=current_user.id)
    db.add(member)

    log = ActivityLog(
        group_id=group.id,
        actor_id=current_user.id,
        event_type=EventType.member_added,
        payload={"user_name": current_user.name, "action": "created group"},
    )
    db.add(log)
    await db.commit()

    result = await db.execute(
        select(Group).options(selectinload(Group.members).selectinload(GroupMember.user))
        .where(Group.id == group.id)
    )
    g = result.scalar_one()
    return _group_to_out(g)


@router.get("", response_model=list[GroupOut])
async def list_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Group)
        .join(GroupMember, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == current_user.id)
        .options(selectinload(Group.members).selectinload(GroupMember.user))
    )
    groups = result.scalars().unique().all()
    return [_group_to_out(g) for g in groups]


@router.get("/{group_id}", response_model=GroupOut)
async def get_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Group).options(selectinload(Group.members).selectinload(GroupMember.user))
        .where(Group.id == group_id)
    )
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    return _group_to_out(g)


@router.post("/{group_id}/members", status_code=201)
async def add_member(
    group_id: UUID,
    body: AddMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_owner(db, group_id, current_user.id)

    user_result = await db.execute(select(User).where(User.email == body.email))
    new_member = user_result.scalar_one_or_none()
    if not new_member:
        raise HTTPException(status_code=404, detail="No user with that email")

    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == new_member.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a member")

    m = GroupMember(group_id=group_id, user_id=new_member.id)
    db.add(m)

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.member_added,
        payload={"user_name": new_member.name, "email": new_member.email},
    )
    db.add(log)
    await db.commit()

    await manager.broadcast_to_group(
        str(group_id), "member_added",
        {"group_id": str(group_id), "user_name": new_member.name}
    )

    return {"detail": f"{new_member.name} added to group"}


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(
    group_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    group = await assert_owner(db, group_id, current_user.id)

    if user_id == group.owner_id:
        raise HTTPException(status_code=400, detail="Cannot remove the group owner")

    # Check balance is zero
    balances = await get_group_net_balances(db, group_id)
    bal = balances.get(user_id, 0)
    if bal != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot remove member: they have an outstanding balance of {bal} paise. Settle up first."
        )

    await db.execute(
        delete(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id
        )
    )

    user_result = await db.execute(select(User).where(User.id == user_id))
    removed_user = user_result.scalar_one_or_none()

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.member_removed,
        payload={"user_name": removed_user.name if removed_user else str(user_id)},
    )
    db.add(log)
    await db.commit()

    await manager.broadcast_to_group(
        str(group_id), "member_removed",
        {"group_id": str(group_id), "user_id": str(user_id)}
    )

    return {"detail": "Member removed"}


@router.delete("/{group_id}")
async def delete_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_owner(db, group_id, current_user.id)
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return {"detail": "Group deleted"}


def _group_to_out(g: Group) -> GroupOut:
    return GroupOut(
        id=g.id,
        name=g.name,
        owner_id=g.owner_id,
        created_at=g.created_at,
        members=[MemberOut(id=m.user.id, name=m.user.name, email=m.user.email) for m in g.members],
    )
