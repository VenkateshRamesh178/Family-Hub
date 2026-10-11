"""Request/response models. JSON uses camelCase to match packages/core (the Zod schemas there
parse every response, so drift between the two shows up as a client-side error)."""

import datetime as dt
import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

from .roles import FOLDER_KEYS


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        from_attributes=True,
    )


def _blank_to_none(v: str | None) -> str | None:
    return v or None


Email = Annotated[EmailStr, AfterValidator(lambda v: v.lower())]
Text = Annotated[str, StringConstraints(strip_whitespace=True)]


def optional_text(max_length: int):
    """Stripped text where blank means "not set" (None)."""
    return Annotated[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_length)] | None,
        AfterValidator(_blank_to_none),
    ]


# --- Auth ---------------------------------------------------------------------


class SignUpIn(ApiModel):
    display_name: Annotated[Text, Field(min_length=1, max_length=80)]
    email: Email
    password: Annotated[str, Field(min_length=8, max_length=200)]


class SignInIn(ApiModel):
    email: Email
    password: str


class IdentityOut(ApiModel):
    email: str
    display_name: str


# --- Family, members, roles ----------------------------------------------------


class FamilyOut(ApiModel):
    family_id: uuid.UUID
    name: str
    owner_email: str
    created_at: datetime


# Omitted rather than null, to match the optional fields in packages/core.
OmitIfNone = Field(default=None, exclude_if=lambda v: v is None)


class RoleOut(ApiModel):
    id: str
    name: str
    built_in: bool
    description: str | None = OmitIfNone
    folders: dict[str, Literal["reader", "writer"]]


class SessionOut(ApiModel):
    family: FamilyOut
    me: IdentityOut
    role: RoleOut
    is_admin: bool


class CreateFamilyIn(ApiModel):
    name: Annotated[Text, Field(min_length=1, max_length=60)]


class JoinFamilyIn(ApiModel):
    code: uuid.UUID


class PendingInviteOut(ApiModel):
    code: uuid.UUID
    family_name: str
    invited_by: str
    role_name: str


class MemberOut(ApiModel):
    email: str
    display_name: str | None = OmitIfNone
    role_id: str
    status: Literal["invited", "active"]
    invited_at: datetime
    invited_by: str


class InviteIn(ApiModel):
    email: Email
    role_id: Annotated[str, Field(min_length=1)]


class ChangeRoleIn(ApiModel):
    role_id: Annotated[str, Field(min_length=1)]


class RoleIn(ApiModel):
    id: Annotated[str, Field(min_length=1, max_length=80, pattern=r"^custom-[a-z0-9-]+$")]
    name: Annotated[Text, Field(min_length=1, max_length=40)]
    description: optional_text(500) = None
    folders: dict[str, Literal["reader", "writer"]]

    @field_validator("folders")
    @classmethod
    def _all_folders(cls, v: dict[str, str]) -> dict[str, str]:
        if set(v) != set(FOLDER_KEYS):
            raise ValueError(f"folders must have exactly these keys: {', '.join(FOLDER_KEYS)}")
        # Only the admin changes members and roles, whatever a custom role says.
        return {**v, "meta": "reader"}


# --- Lists --------------------------------------------------------------------


class ItemOut(ApiModel):
    id: uuid.UUID
    created_by_email: str | None = Field(default=None, serialization_alias="createdBy")
    created_at: datetime
    updated_at: datetime


class ShoppingItemIn(ApiModel):
    name: Annotated[Text, Field(min_length=1, max_length=120)]
    quantity: Annotated[float | None, Field(gt=0, lt=10_000_000)] = None
    unit: optional_text(20) = None
    checked: bool = False


class ShoppingItemPatch(ApiModel):
    name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    checked: bool | None = None


class ShoppingItemOut(ItemOut):
    name: str
    quantity: float | None
    unit: str | None
    checked: bool


class TodoIn(ApiModel):
    title: Annotated[Text, Field(min_length=1, max_length=200)]
    due_date: date | None = None
    assignee_email: Email | None = None
    done: bool = False

    @field_validator("assignee_email", mode="before")
    @classmethod
    def _blank_assignee(cls, v: object) -> object:
        return v or None


class TodoPatch(ApiModel):
    title: str | None = None
    due_date: date | None = None
    assignee_email: str | None = None
    done: bool | None = None


class TodoOut(ItemOut):
    title: str
    due_date: date | None
    assignee_email: str | None
    done: bool


class PurchasedItemIn(ApiModel):
    item_name: Annotated[Text, Field(min_length=1, max_length=120)]
    specifications: Annotated[Text, Field(max_length=4000)] = ""
    purchase_link: optional_text(2000) = None
    bought_date: date
    has_warranty: bool = False
    warranty_expiry_date: date | None = None

    @field_validator("purchase_link")
    @classmethod
    def _http_link(cls, v: str | None) -> str | None:
        if v is not None and not v.lower().startswith(("http://", "https://")):
            raise ValueError("Purchase link must start with http:// or https://")
        return v

    @model_validator(mode="after")
    def _warranty(self) -> "PurchasedItemIn":
        if self.has_warranty and self.warranty_expiry_date is None:
            raise ValueError("Warranty expiry date is required when the item has a warranty")
        if not self.has_warranty:
            self.warranty_expiry_date = None
        return self


class PurchasedItemPatch(ApiModel):
    item_name: str | None = None
    specifications: str | None = None
    purchase_link: str | None = None
    bought_date: date | None = None
    has_warranty: bool | None = None
    warranty_expiry_date: date | None = None


class PurchasedItemOut(ItemOut):
    item_name: str
    specifications: str
    purchase_link: str | None
    bought_date: date
    has_warranty: bool
    warranty_expiry_date: date | None


# --- Calendar -----------------------------------------------------------------

EventKind = Literal["event", "reminder", "birthday"]
Recurrence = Literal["none", "weekly", "monthly", "yearly"]


class CalendarEventIn(ApiModel):
    title: Annotated[Text, Field(min_length=1, max_length=200)]
    kind: EventKind = "event"
    start_date: date
    start_time: time | None = None
    recurrence: Recurrence = "none"
    notes: Annotated[Text, Field(max_length=2000)] = ""

    @field_validator("start_time")
    @classmethod
    def _minutes_only(cls, v: time | None) -> time | None:
        return v.replace(second=0, microsecond=0, tzinfo=None) if v else None

    @model_validator(mode="after")
    def _birthdays(self) -> "CalendarEventIn":
        # A birthday is an all-day yearly event; its start date is the date of birth.
        if self.kind == "birthday":
            self.recurrence = "yearly"
            self.start_time = None
        return self


class CalendarEventPatch(ApiModel):
    title: str | None = None
    kind: EventKind | None = None
    start_date: date | None = None
    start_time: time | None = None
    recurrence: Recurrence | None = None
    notes: str | None = None


class CalendarEventOut(ItemOut):
    title: str
    kind: EventKind
    start_date: date
    start_time: time | None
    recurrence: Recurrence
    notes: str


class OccurrenceOut(ApiModel):
    """One dated entry on the calendar, whatever it comes from."""

    # Unique per occurrence, e.g. "event:<id>:2026-10-11" or "warranty:<id>".
    key: str
    date: dt.date
    time: dt.time | None = None
    title: str
    kind: Literal["event", "reminder", "birthday", "todo", "warranty", "purchase", "document"]
    source_type: Literal["event", "todo", "purchase", "document"]
    source_id: uuid.UUID
    notes: str = ""
    recurrence: Recurrence = "none"
    # Birthdays: the age reached that day, when the birth year is known.
    age: int | None = None
    # To-dos: whether it's been done.
    done: bool | None = None


class CalendarFeedOut(ApiModel):
    active: bool
    created_at: datetime | None = None


class CalendarFeedCreatedOut(ApiModel):
    """The feed path, shown once. Prefix it with the app's origin to get the URL."""

    path: str
    created_at: datetime


# --- Documents ----------------------------------------------------------------


class DocFolderIn(ApiModel):
    name: Annotated[Text, Field(min_length=1, max_length=80)]
    parent_id: uuid.UUID | None = None


class DocFolderPatch(ApiModel):
    name: str | None = None
    parent_id: uuid.UUID | None = None


class DocFolderOut(ItemOut):
    name: str
    parent_id: uuid.UUID | None


class UploadIn(ApiModel):
    """Asks for somewhere to upload one file."""

    filename: Annotated[Text, Field(min_length=1, max_length=255)]
    content_type: Annotated[str, Field(max_length=127)] = ""
    size: Annotated[int, Field(gt=0)]


class UploadTicketOut(ApiModel):
    """PUT the file's bytes to `url` with `headers`, then create or replace a document with `uploadId`."""

    upload_id: uuid.UUID
    url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]
    expires_at: datetime


class DocumentIn(ApiModel):
    title: Annotated[Text, Field(min_length=1, max_length=200)]
    notes: Annotated[Text, Field(max_length=2000)] = ""
    folder_id: uuid.UUID | None = None
    expiry_date: date | None = None
    purchase_id: uuid.UUID | None = None


class DocumentCreateIn(ApiModel):
    upload_id: uuid.UUID
    # Defaults to the file name without its extension.
    title: optional_text(200) = None
    notes: Annotated[Text, Field(max_length=2000)] = ""
    folder_id: uuid.UUID | None = None
    expiry_date: date | None = None
    purchase_id: uuid.UUID | None = None


class DocumentPatch(ApiModel):
    title: str | None = None
    notes: str | None = None
    folder_id: uuid.UUID | None = None
    expiry_date: date | None = None
    purchase_id: uuid.UUID | None = None


class ReplaceFileIn(ApiModel):
    upload_id: uuid.UUID


class DocumentFileOut(ApiModel):
    """One version of a document's file."""

    id: uuid.UUID
    filename: str
    content_type: str
    size: int
    uploaded_at: datetime
    uploaded_by_email: str | None = Field(default=None, serialization_alias="uploadedBy")


class DocumentOut(ItemOut):
    title: str
    notes: str
    folder_id: uuid.UUID | None
    expiry_date: date | None
    purchase_id: uuid.UUID | None
    # Set = in the trash.
    deleted_at: datetime | None
    file: DocumentFileOut | None


class DownloadOut(ApiModel):
    url: str


DocAction = Literal["upload", "replace", "restore_version", "update", "download", "trash", "restore", "purge"]


class DocAuditEventOut(ApiModel):
    id: uuid.UUID
    document_id: uuid.UUID | None
    document_title: str
    action: DocAction
    actor_email: str
    detail: str
    at: datetime
