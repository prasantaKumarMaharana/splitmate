"""
Balance calculation service.

Money is always stored and computed in PAISE (integer).
1 INR = 100 paise. No floats ever touch the balance math.

ROUNDING RULE FOR EQUAL SPLITS:
  100 paise ÷ 3 members = 33 paise each, remainder 1.
  The remainder is added to the FIRST member in the list.
  So shares = [34, 33, 33]. Sum always == total. No money invented or lost.
"""
from typing import List, Dict
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.models import Group, Expense, ExpenseSplit, Settlement, GroupMember, User


def compute_equal_splits(amount_paise: int, member_ids: List[UUID]) -> Dict[UUID, int]:
    """
    Divide amount_paise equally among member_ids.
    Remainder (amount_paise % len) goes to first member.
    Returns {user_id: share_paise}.
    """
    n = len(member_ids)
    base = amount_paise // n
    remainder = amount_paise % n
    splits = {}
    for i, uid in enumerate(member_ids):
        splits[uid] = base + (remainder if i == 0 else 0)
    return splits


async def get_group_net_balances(
    db: AsyncSession, group_id: UUID
) -> Dict[UUID, int]:
    """
    Compute net balance for each member in a group.
    Positive = this member is owed money (others owe them).
    Negative = this member owes money.

    Formula per expense:
      payer gets +amount_paise
      each split member gets -(their share_paise)
    Then settlements adjust: payer gets -(amount), payee gets +(amount)
    """
    # Get all expenses with splits
    exp_result = await db.execute(
        select(Expense)
        .options(selectinload(Expense.splits))
        .where(Expense.group_id == group_id)
    )
    expenses = exp_result.scalars().all()

    # Get all settlements
    sett_result = await db.execute(
        select(Settlement).where(Settlement.group_id == group_id)
    )
    settlements = sett_result.scalars().all()

    balances: Dict[UUID, int] = {}

    for expense in expenses:
        paid_by = expense.paid_by
        # Payer is credited the full amount
        balances[paid_by] = balances.get(paid_by, 0) + expense.amount_paise
        # Each person in the split is debited their share
        for split in expense.splits:
            uid = split.user_id
            balances[uid] = balances.get(uid, 0) - split.share_paise

    for settlement in settlements:
        # Payer reduces their credit / increases negative
        balances[settlement.payer_id] = balances.get(settlement.payer_id, 0) + settlement.amount_paise
        # Payee reduces what they're owed
        balances[settlement.payee_id] = balances.get(settlement.payee_id, 0) - settlement.amount_paise

    return balances


def simplify_debts(balances: Dict[UUID, int]) -> List[dict]:
    """
    Given net balances, produce minimal list of 'X owes Y amount' transactions.
    Uses greedy matching of largest creditor and largest debtor.
    """
    # Split into debtors (negative balance) and creditors (positive balance)
    debtors = sorted(
        [(uid, -bal) for uid, bal in balances.items() if bal < 0],
        key=lambda x: -x[1]
    )
    creditors = sorted(
        [(uid, bal) for uid, bal in balances.items() if bal > 0],
        key=lambda x: -x[1]
    )

    suggestions = []
    di, ci = 0, 0

    while di < len(debtors) and ci < len(creditors):
        debtor_id, debt = debtors[di]
        creditor_id, credit = creditors[ci]

        amount = min(debt, credit)
        if amount > 0:
            suggestions.append({
                "from_user_id": debtor_id,
                "to_user_id": creditor_id,
                "amount_paise": amount,
            })

        debt -= amount
        credit -= amount

        if debt == 0:
            di += 1
        else:
            debtors[di] = (debtor_id, debt)

        if credit == 0:
            ci += 1
        else:
            creditors[ci] = (creditor_id, credit)

    return suggestions
