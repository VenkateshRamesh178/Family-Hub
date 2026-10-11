import uuid
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


Timestamp = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Always stored lower-cased.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    # sha256 of the cookie token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(Timestamp)

    user: Mapped[User] = relationship(lazy="joined")


class Family(Base):
    __tablename__ = "families"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    owner: Mapped[User] = relationship(lazy="joined")


class Membership(Base):
    __tablename__ = "memberships"
    # A user belongs to at most one family for now (the UI has no family switcher).
    __table_args__ = (UniqueConstraint("user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_id: Mapped[str] = mapped_column(String(80))
    invited_by: Mapped[str] = mapped_column(String(254))
    invited_at: Mapped[datetime] = mapped_column(Timestamp)
    joined_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    user: Mapped[User] = relationship(lazy="joined")
    family: Mapped[Family] = relationship(lazy="joined")


class Invite(Base):
    """A pending invitation. Deleted when accepted, so an email is either invited or a member."""

    __tablename__ = "invites"
    __table_args__ = (UniqueConstraint("family_id", "email"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(254), index=True)
    role_id: Mapped[str] = mapped_column(String(80))
    invited_by: Mapped[str] = mapped_column(String(254))
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    family: Mapped[Family] = relationship(lazy="joined")


class CustomRole(Base):
    __tablename__ = "custom_roles"

    family_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text)
    # {area: "reader" | "writer"}, same shape as RoleDefinition.folders in packages/core.
    folders: Mapped[dict[str, Any]] = mapped_column(JSONB)


# --- Lists --------------------------------------------------------------------


class FamilyItem:
    """Columns shared by every family-owned list item."""

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Python-side defaults, so values are known without a refresh (async sessions can't lazy-load).
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)

    @declared_attr
    def created_by(cls) -> Mapped[User | None]:
        return relationship(lazy="joined")

    @property
    def created_by_email(self) -> str | None:
        return self.created_by.email if self.created_by else None


class ShoppingItem(FamilyItem, Base):
    __tablename__ = "shopping_items"

    name: Mapped[str] = mapped_column(String(120))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    unit: Mapped[str | None] = mapped_column(String(20))
    checked: Mapped[bool] = mapped_column(default=False)


class Todo(FamilyItem, Base):
    __tablename__ = "todos"

    title: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date)
    assignee_email: Mapped[str | None] = mapped_column(String(254))
    done: Mapped[bool] = mapped_column(default=False)


class PurchasedItem(FamilyItem, Base):
    __tablename__ = "purchased_items"
    __table_args__ = (
        CheckConstraint(
            "(has_warranty AND warranty_expiry_date IS NOT NULL)"
            " OR (NOT has_warranty AND warranty_expiry_date IS NULL)",
            name="warranty_expiry_matches_flag",
        ),
    )

    item_name: Mapped[str] = mapped_column(String(120))
    specifications: Mapped[str] = mapped_column(Text, default="")
    purchase_link: Mapped[str | None] = mapped_column(Text)
    bought_date: Mapped[date] = mapped_column(Date)
    has_warranty: Mapped[bool] = mapped_column(default=False)
    warranty_expiry_date: Mapped[date | None] = mapped_column(Date)


# --- Calendar -----------------------------------------------------------------


class CalendarEvent(FamilyItem, Base):
    """An event, reminder or birthday entered on the calendar.

    To-do due dates, purchases and warranty expiries also appear on the calendar,
    but they are read from their own tables (app/calendar.py), never copied here.
    """

    __tablename__ = "calendar_events"

    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # event | reminder | birthday
    start_date: Mapped[date] = mapped_column(Date)
    # Null = all day. Times are "floating": local to the family, no time zone.
    start_time: Mapped[time | None] = mapped_column(Time)
    recurrence: Mapped[str] = mapped_column(String(10), default="none")  # none | weekly | monthly | yearly
    notes: Mapped[str] = mapped_column(Text, default="")


class CalendarFeed(Base):
    """A user's private .ics subscription link. Only the hash of its token is stored."""

    __tablename__ = "calendar_feeds"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    user: Mapped[User] = relationship(lazy="joined")


# --- Documents ----------------------------------------------------------------


class DocFolder(FamilyItem, Base):
    """A folder in the family's shared documents. Top-level folders have no parent."""

    __tablename__ = "doc_folders"

    name: Mapped[str] = mapped_column(String(80))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doc_folders.id", ondelete="CASCADE"))


class DocumentVersion(Base):
    """One uploaded file. A document's versions are kept so an earlier one can be restored.

    Created as a pending upload (no document yet, nothing stored); it becomes part of a
    document once the browser has uploaded the bytes and the size has been checked.
    """

    __tablename__ = "document_versions"
    __table_args__ = (CheckConstraint("pending OR document_id IS NOT NULL", name="ready_has_document"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(127))
    # Declared by the browser while pending; the stored size once ready.
    size: Mapped[int]
    pending: Mapped[bool] = mapped_column(default=True)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    uploaded_by: Mapped[User | None] = relationship(lazy="joined")

    @property
    def uploaded_by_email(self) -> str | None:
        return self.uploaded_by.email if self.uploaded_by else None


class Document(FamilyItem, Base):
    __tablename__ = "documents"

    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    # Null = top level. Deleting a folder is refused while it holds documents, but
    # trashed ones fall back to the top level so they can still be restored.
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("doc_folders.id", ondelete="SET NULL"), index=True
    )
    expiry_date: Mapped[date | None] = mapped_column(Date)
    # Receipts and warranty cards attached to an item purchased.
    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchased_items.id", ondelete="SET NULL"), index=True
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("document_versions.id", ondelete="SET NULL", use_alter=True)
    )
    # Set = in the trash.
    deleted_at: Mapped[datetime | None] = mapped_column(Timestamp)

    current_version: Mapped[DocumentVersion | None] = relationship(
        foreign_keys=[current_version_id], lazy="joined", post_update=True
    )

    @property
    def file(self) -> DocumentVersion | None:
        return self.current_version


class DocAuditEvent(Base):
    """Who did what to which document. Kept when the document is deleted (title is copied)."""

    __tablename__ = "doc_audit_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    document_title: Mapped[str] = mapped_column(String(200))
    # upload | replace | restore_version | update | download | trash | restore | purge
    action: Mapped[str] = mapped_column(String(20))
    actor_email: Mapped[str] = mapped_column(String(254))
    detail: Mapped[str] = mapped_column(String(300), default="")
    at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
