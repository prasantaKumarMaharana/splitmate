from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime
import re


# ── Auth ────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_rules(cls, v):
        errors = []
        if len(v) < 8:
            errors.append("at least 8 characters")
        if not re.search(r"[A-Z]", v):
            errors.append("one uppercase letter")
        if not re.search(r"[0-9]", v):
            errors.append("one digit")
        if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;':\",./<>?]", v):
            errors.append("one special character")
        if errors:
            raise ValueError("Password must contain: " + ", ".join(errors))
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: UUID
    name: str
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Groups ───────────────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Group name cannot be empty")
        return v.strip()


class MemberOut(BaseModel):
    id: UUID
    name: str
    email: str

    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: UUID
    name: str
    owner_id: UUID
    created_at: datetime
    members: List[MemberOut] = []

    model_config = {"from_attributes": True}


class AddMemberRequest(BaseModel):
    email: EmailStr


# ── Expenses ─────────────────────────────────────────────────────────────────

class SplitMemberIn(BaseModel):
    user_id: UUID
    share_paise: int


class ExpenseCreate(BaseModel):
    description: str
    amount_paise: int
    paid_by: UUID
    date: Optional[datetime] = None
    split_type: str  # "equal" | "custom"
    split_member_ids: Optional[List[UUID]] = None      # for equal split
    custom_splits: Optional[List[SplitMemberIn]] = None  # for custom split

    @field_validator("amount_paise")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("Amount must be positive")
        return v

    @field_validator("split_type")
    @classmethod
    def valid_split_type(cls, v):
        if v not in ("equal", "custom"):
            raise ValueError("split_type must be 'equal' or 'custom'")
        return v


class SplitOut(BaseModel):
    user_id: UUID
    share_paise: int
    user_name: str

    model_config = {"from_attributes": True}


class ExpenseOut(BaseModel):
    id: UUID
    group_id: UUID
    description: str
    amount_paise: int
    paid_by: UUID
    payer_name: str
    date: datetime
    split_type: str
    created_by: UUID
    creator_name: str
    created_at: datetime
    updated_at: datetime
    splits: List[SplitOut] = []

    model_config = {"from_attributes": True}


class ExpenseListOut(BaseModel):
    items: List[ExpenseOut]
    total: int
    page: int
    page_size: int


# ── Balances ─────────────────────────────────────────────────────────────────

class MemberBalance(BaseModel):
    user_id: UUID
    name: str
    net_paise: int  # positive = owed money, negative = owes money


class DebtSuggestion(BaseModel):
    from_user_id: UUID
    from_name: str
    to_user_id: UUID
    to_name: str
    amount_paise: int


class GroupBalanceOut(BaseModel):
    group_id: UUID
    balances: List[MemberBalance]
    suggestions: List[DebtSuggestion]


class OverallBalanceOut(BaseModel):
    total_owed_paise: int      # others owe you
    total_you_owe_paise: int   # you owe others
    net_paise: int
    group_count: int
    most_owed_group_id: Optional[UUID]
    most_owed_group_name: Optional[str]
    most_owed_amount_paise: int


# ── Settlements ──────────────────────────────────────────────────────────────

class SettlementCreate(BaseModel):
    payee_id: UUID
    amount_paise: int

    @field_validator("amount_paise")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("Settlement amount must be positive")
        return v


class SettlementOut(BaseModel):
    id: UUID
    group_id: UUID
    payer_id: UUID
    payee_id: UUID
    amount_paise: int
    recorded_at: datetime

    model_config = {"from_attributes": True}


# ── Activity ─────────────────────────────────────────────────────────────────

class ActivityOut(BaseModel):
    id: UUID
    group_id: UUID
    actor_id: UUID
    actor_name: str
    event_type: str
    payload: dict
    created_at: datetime

    model_config = {"from_attributes": True}
