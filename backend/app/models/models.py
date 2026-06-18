import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, BigInteger, Boolean, DateTime,
    ForeignKey, Enum as SAEnum, Text, JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class SplitType(str, enum.Enum):
    equal = "equal"
    custom = "custom"


class EventType(str, enum.Enum):
    expense_added = "expense_added"
    expense_edited = "expense_edited"
    expense_deleted = "expense_deleted"
    member_added = "member_added"
    member_removed = "member_removed"
    settlement_recorded = "settlement_recorded"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    memberships = relationship("GroupMember", back_populates="user")
    owned_groups = relationship("Group", back_populates="owner")
    refresh_tokens = relationship("RefreshToken", back_populates="user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class Group(Base):
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    owner = relationship("User", back_populates="owned_groups")
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="group", cascade="all, delete-orphan")
    settlements = relationship("Settlement", back_populates="group", cascade="all, delete-orphan")
    activity_logs = relationship("ActivityLog", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    joined_at = Column(DateTime(timezone=True), default=utcnow)

    group = relationship("Group", back_populates="members")
    user = relationship("User", back_populates="memberships")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    description = Column(String(255), nullable=False)
    # Amount stored in paise (integer). 1 INR = 100 paise. Never floats.
    amount_paise = Column(BigInteger, nullable=False)
    paid_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    split_type = Column(SAEnum(SplitType), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    group = relationship("Group", back_populates="expenses")
    payer = relationship("User", foreign_keys=[paid_by])
    creator = relationship("User", foreign_keys=[created_by])
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id = Column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # Share in paise
    share_paise = Column(BigInteger, nullable=False)

    expense = relationship("Expense", back_populates="splits")
    user = relationship("User")


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    payer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    payee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # Amount in paise
    amount_paise = Column(BigInteger, nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow)

    group = relationship("Group", back_populates="settlements")
    payer = relationship("User", foreign_keys=[payer_id])
    payee = relationship("User", foreign_keys=[payee_id])


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    event_type = Column(SAEnum(EventType), nullable=False)
    payload = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), default=utcnow)

    group = relationship("Group", back_populates="activity_logs")
    actor = relationship("User")
