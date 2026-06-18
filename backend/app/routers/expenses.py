from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import datetime, timezone
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import (
    Expense, ExpenseSplit, GroupMember, User, Group,
    ActivityLog, EventType, SplitType
)
from app.schemas.schemas import ExpenseCreate, ExpenseOut, SplitOut, ExpenseListOut
from app.services.balance import compute_equal_splits
from app.services.websocket_manager import manager
from app.routers.groups import assert_member

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["expenses"])


async def get_member_ids(db, group_id) -> set:
    r = await db.execute(select(GroupMember.user_id).where(GroupMember.group_id == group_id))
    return {row[0] for row in r.fetchall()}


def _expense_to_out(e: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=e.id,
        group_id=e.group_id,
        description=e.description,
        amount_paise=e.amount_paise,
        paid_by=e.paid_by,
        payer_name=e.payer.name,
        date=e.date,
        split_type=e.split_type.value,
        created_by=e.created_by,
        creator_name=e.creator.name,
        created_at=e.created_at,
        updated_at=e.updated_at,
        splits=[
            SplitOut(user_id=s.user_id, share_paise=s.share_paise, user_name=s.user.name)
            for s in e.splits
        ],
    )


async def _load_expense(db, expense_id, group_id) -> Expense:
    r = await db.execute(
        select(Expense)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.user),
            selectinload(Expense.payer),
            selectinload(Expense.creator),
        )
        .where(Expense.id == expense_id, Expense.group_id == group_id)
    )
    e = r.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    return e


@router.post("", response_model=ExpenseOut, status_code=201)
async def create_expense(
    group_id: UUID,
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)
    member_ids = await get_member_ids(db, group_id)

    if body.paid_by not in member_ids:
        raise HTTPException(status_code=400, detail="Payer must be a member of the group")

    splits_map: dict[UUID, int] = {}

    if body.split_type == "equal":
        if not body.split_member_ids:
            raise HTTPException(status_code=400, detail="Provide split_member_ids for equal split")
        for uid in body.split_member_ids:
            if uid not in member_ids:
                raise HTTPException(status_code=400, detail=f"User {uid} is not a group member")
        splits_map = compute_equal_splits(body.amount_paise, body.split_member_ids)

    elif body.split_type == "custom":
        if not body.custom_splits:
            raise HTTPException(status_code=400, detail="Provide custom_splits for custom split")
        total = 0
        for cs in body.custom_splits:
            if cs.user_id not in member_ids:
                raise HTTPException(status_code=400, detail=f"User {cs.user_id} is not a group member")
            if cs.share_paise < 0:
                raise HTTPException(status_code=400, detail="Share cannot be negative")
            splits_map[cs.user_id] = cs.share_paise
            total += cs.share_paise
        if total != body.amount_paise:
            raise HTTPException(
                status_code=400,
                detail=f"Custom splits sum to {total} paise but expense is {body.amount_paise} paise"
            )

    expense = Expense(
        group_id=group_id,
        description=body.description,
        amount_paise=body.amount_paise,
        paid_by=body.paid_by,
        date=body.date or datetime.now(timezone.utc),
        split_type=SplitType(body.split_type),
        created_by=current_user.id,
    )
    db.add(expense)
    await db.flush()

    for uid, share in splits_map.items():
        db.add(ExpenseSplit(expense_id=expense.id, user_id=uid, share_paise=share))

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.expense_added,
        payload={
            "expense_id": str(expense.id),
            "description": expense.description,
            "amount_paise": expense.amount_paise,
        },
    )
    db.add(log)
    await db.commit()

    e = await _load_expense(db, expense.id, group_id)
    out = _expense_to_out(e)

    await manager.broadcast_to_group(
        str(group_id), "expense_added",
        {"group_id": str(group_id), "expense": out.model_dump(mode="json")}
    )

    return out


@router.get("", response_model=ExpenseListOut)
async def list_expenses(
    group_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("date", pattern="^(date|amount_paise)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)

    count_result = await db.execute(
        select(func.count(Expense.id)).where(Expense.group_id == group_id)
    )
    total = count_result.scalar()

    sort_col = Expense.date if sort_by == "date" else Expense.amount_paise
    sort_expr = sort_col.desc() if order == "desc" else sort_col.asc()

    result = await db.execute(
        select(Expense)
        .options(
            selectinload(Expense.splits).selectinload(ExpenseSplit.user),
            selectinload(Expense.payer),
            selectinload(Expense.creator),
        )
        .where(Expense.group_id == group_id)
        .order_by(sort_expr)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    expenses = result.scalars().all()

    return ExpenseListOut(
        items=[_expense_to_out(e) for e in expenses],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{expense_id}", response_model=ExpenseOut)
async def get_expense(
    group_id: UUID,
    expense_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)
    e = await _load_expense(db, expense_id, group_id)
    return _expense_to_out(e)


@router.put("/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    group_id: UUID,
    expense_id: UUID,
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)
    e = await _load_expense(db, expense_id, group_id)

    # Only creator or group owner can edit
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one()

    if e.created_by != current_user.id and group.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the expense creator or group owner can edit this")

    member_ids = await get_member_ids(db, group_id)

    if body.paid_by not in member_ids:
        raise HTTPException(status_code=400, detail="Payer must be a group member")

    splits_map: dict[UUID, int] = {}

    if body.split_type == "equal":
        if not body.split_member_ids:
            raise HTTPException(status_code=400, detail="Provide split_member_ids for equal split")
        for uid in body.split_member_ids:
            if uid not in member_ids:
                raise HTTPException(status_code=400, detail=f"User {uid} is not a group member")
        splits_map = compute_equal_splits(body.amount_paise, body.split_member_ids)

    elif body.split_type == "custom":
        if not body.custom_splits:
            raise HTTPException(status_code=400, detail="Provide custom_splits for custom split")
        total = 0
        for cs in body.custom_splits:
            if cs.user_id not in member_ids:
                raise HTTPException(status_code=400, detail=f"User {cs.user_id} is not a group member")
            splits_map[cs.user_id] = cs.share_paise
            total += cs.share_paise
        if total != body.amount_paise:
            raise HTTPException(
                status_code=400,
                detail=f"Splits sum to {total} paise but expense is {body.amount_paise} paise"
            )

    # Update expense fields
    e.description = body.description
    e.amount_paise = body.amount_paise
    e.paid_by = body.paid_by
    e.date = body.date or e.date
    e.split_type = SplitType(body.split_type)
    e.updated_at = datetime.now(timezone.utc)

    # Remove old splits and insert new ones
    for split in list(e.splits):
        await db.delete(split)
    await db.flush()

    for uid, share in splits_map.items():
        db.add(ExpenseSplit(expense_id=e.id, user_id=uid, share_paise=share))

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.expense_edited,
        payload={"expense_id": str(e.id), "description": e.description},
    )
    db.add(log)
    await db.commit()

    updated = await _load_expense(db, e.id, group_id)
    out = _expense_to_out(updated)

    await manager.broadcast_to_group(
        str(group_id), "expense_updated",
        {"group_id": str(group_id), "expense": out.model_dump(mode="json")}
    )

    return out


@router.delete("/{expense_id}")
async def delete_expense(
    group_id: UUID,
    expense_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(db, group_id, current_user.id)
    e = await _load_expense(db, expense_id, group_id)

    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one()

    if e.created_by != current_user.id and group.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the expense creator or group owner can delete this")

    log = ActivityLog(
        group_id=group_id,
        actor_id=current_user.id,
        event_type=EventType.expense_deleted,
        payload={"expense_id": str(e.id), "description": e.description},
    )
    db.add(log)
    await db.delete(e)
    await db.commit()

    await manager.broadcast_to_group(
        str(group_id), "expense_deleted",
        {"group_id": str(group_id), "expense_id": str(expense_id)}
    )

    return {"detail": "Expense deleted"}
