from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import (
    Group, GroupMember, User, Settlement, ActivityLog, EventType
)
from app.schemas.schemas import (
    GroupBalanceOut, MemberBalance, DebtSuggestion,
    OverallBalanceOut, SettlementCreate, SettlementOut, ActivityOut
)
from app.services.balance import get_group_net_balances, simplify_debts
from app.services.websocket_manager import manager
from app.routers.groups import assert_member

router = APIRouter(tags=["balances"])


@router.get("/groups/{group_id}/balances", response_model=GroupBalanceOut)
async def group_balances(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)

    net = await get_group_net_balances(db, group_id)

    # Fetch member names
    members_r = await db.execute(
        select(GroupMember).options(selectinload(GroupMember.user))
        .where(GroupMember.group_id == group_id)
    )
    members = members_r.scalars().all()
    id_to_name = {m.user_id: m.user.name for m in members}

    balances = [
        MemberBalance(user_id=uid, name=id_to_name.get(uid, "Unknown"), net_paise=bal)
        for uid, bal in net.items()
    ]

    raw_suggestions = simplify_debts(net)
    suggestions = [
        DebtSuggestion(
            from_user_id=s["from_user_id"],
            from_name=id_to_name.get(s["from_user_id"], "?"),
            to_user_id=s["to_user_id"],
            to_name=id_to_name.get(s["to_user_id"], "?"),
            amount_paise=s["amount_paise"],
        )
        for s in raw_suggestions
    ]

    return GroupBalanceOut(group_id=group_id, balances=balances, suggestions=suggestions)


@router.get("/users/me/balance", response_model=OverallBalanceOut)
async def overall_balance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Get all groups this user is in
    groups_r = await db.execute(
        select(Group)
        .join(GroupMember, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == current_user.id)
    )
    groups = groups_r.scalars().all()

    total_owed = 0     # others owe you
    total_you_owe = 0  # you owe others
    most_owed_group_id = None
    most_owed_group_name = None
    most_owed_amount = 0

    for group in groups:
        net = await get_group_net_balances(db, group.id)
        my_bal = net.get(current_user.id, 0)

        if my_bal > 0:
            total_owed += my_bal
        elif my_bal < 0:
            total_you_owe += abs(my_bal)

        if my_bal < 0 and abs(my_bal) > most_owed_amount:
            most_owed_amount = abs(my_bal)
            most_owed_group_id = group.id
            most_owed_group_name = group.name

    return OverallBalanceOut(
        total_owed_paise=total_owed,
        total_you_owe_paise=total_you_owe,
        net_paise=total_owed - total_you_owe,
        group_count=len(groups),
        most_owed_group_id=most_owed_group_id,
        most_owed_group_name=most_owed_group_name,
        most_owed_amount_paise=most_owed_amount,
    )


@router.post("/groups/{group_id}/settlements", response_model=SettlementOut, status_code=201)
async def record_settlement(
    group_id: UUID,
    body: SettlementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)

    if body.payee_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot settle with yourself")

    # Verify payee is in group
    payee_r = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == body.payee_id,
        )
    )
    if not payee_r.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Payee is not a member of this group")

    # Validate there's an actual balance between payer and payee
    net = await get_group_net_balances(db, group_id)
    my_bal = net.get(current_user.id, 0)

    if my_bal >= 0:
        raise HTTPException(
            status_code=400,
            detail="You don't owe anyone in this group. No settlement needed."
        )

    settlement = Settlement(
        group_id=group_id,
        payer_id=current_user.id,
        payee_id=body.payee_id,
        amount_paise=body.amount_paise,
    )
    db.add(settlement)

    payee_user_r = await db.execute(select(User).where(User.id == body.payee_id))
    payee_user = payee_user_r.scalar_one()

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.settlement_recorded,
        payload={
            "payer_name": current_user.name,
            "payee_name": payee_user.name,
            "amount_paise": body.amount_paise,
        },
    )
    db.add(log)
    await db.commit()
    await db.refresh(settlement)

    await manager.broadcast_to_group(
        str(group_id), "settlement_recorded",
        {
            "group_id": str(group_id),
            "payer_name": current_user.name,
            "payee_name": payee_user.name,
            "amount_paise": body.amount_paise,
        }
    )

    return settlement


@router.get("/groups/{group_id}/activity", response_model=list[ActivityOut])
async def group_activity(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)

    from app.models.models import ActivityLog
    r = await db.execute(
        select(ActivityLog)
        .options(selectinload(ActivityLog.actor))
        .where(ActivityLog.group_id == group_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(50)
    )
    logs = r.scalars().all()
    return [
        ActivityOut(
            id=l.id,
            group_id=l.group_id,
            actor_id=l.actor_id,
            actor_name=l.actor.name,
            event_type=l.event_type.value,
            payload=l.payload,
            created_at=l.created_at,
        )
        for l in logs
    ]


@router.get("/users/me/activity", response_model=list[ActivityOut])
async def personal_activity(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.models import ActivityLog
    # Get all group IDs user is in
    groups_r = await db.execute(
        select(GroupMember.group_id).where(GroupMember.user_id == current_user.id)
    )
    group_ids = [row[0] for row in groups_r.fetchall()]

    if not group_ids:
        return []

    r = await db.execute(
        select(ActivityLog)
        .options(selectinload(ActivityLog.actor))
        .where(ActivityLog.group_id.in_(group_ids))
        .order_by(ActivityLog.created_at.desc())
        .limit(30)
    )
    logs = r.scalars().all()
    return [
        ActivityOut(
            id=l.id,
            group_id=l.group_id,
            actor_id=l.actor_id,
            actor_name=l.actor.name,
            event_type=l.event_type.value,
            payload=l.payload,
            created_at=l.created_at,
        )
        for l in logs
    ]
