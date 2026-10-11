"""The family calendar.

Events, reminders and birthdays are stored in `calendar_events`. Everything else
with a date (to-do due dates, purchases, warranty expiries, document expiries)
is read from its own table each time, so the calendar never drifts out
of sync with the lists.

External calendars (Google, Apple, Outlook) subscribe to a private iCalendar feed
per user. Read-only and polled by the calendar app, which is the simplest sync
that works everywhere without OAuth.
"""

import datetime as dt
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..calendar import IcsEvent, build_ics, occurrences
from ..deps import CurrentMember, Db, Member, find_membership, require
from ..models import CalendarEvent, CalendarFeed, Document, PurchasedItem, Todo
from ..schemas import (
    CalendarEventIn,
    CalendarEventOut,
    CalendarEventPatch,
    CalendarFeedCreatedOut,
    CalendarFeedOut,
    OccurrenceOut,
)
from ..security import hash_token, new_session_token
from .crud import add_crud_routes

MAX_RANGE_DAYS = 400
FEED_PATH = "/api/calendar/feed/{token}.ics"

# Same-day entries: timed ones by time, then all-day ones in this order.
_KIND_ORDER = {"birthday": 0, "reminder": 1, "event": 2, "todo": 3, "warranty": 4, "document": 5, "purchase": 6}

Reader = Annotated[Member, Depends(require("calendar", "read"))]

events = APIRouter(prefix="/events", tags=["calendar"])
add_crud_routes(
    events,
    CalendarEvent,
    CalendarEventIn,
    CalendarEventPatch,
    CalendarEventOut,
    [CalendarEvent.start_date, CalendarEvent.start_time.asc().nulls_first(), CalendarEvent.created_at],
    resource="calendar",
)

router = APIRouter(prefix="/calendar", tags=["calendar"])


async def family_occurrences(db: AsyncSession, family_id, frm: date, to: date) -> list[OccurrenceOut]:
    out: list[OccurrenceOut] = []

    for e in await db.scalars(
        select(CalendarEvent).where(CalendarEvent.family_id == family_id, CalendarEvent.start_date <= to)
    ):
        for d in occurrences(e.start_date, e.recurrence, frm, to):
            age = d.year - e.start_date.year if e.kind == "birthday" and d.year > e.start_date.year else None
            out.append(
                OccurrenceOut(
                    key=f"event:{e.id}:{d}",
                    date=d,
                    time=e.start_time,
                    title=e.title,
                    kind=e.kind,
                    source_type="event",
                    source_id=e.id,
                    notes=e.notes,
                    recurrence=e.recurrence,
                    age=age,
                )
            )

    for t in await db.scalars(
        select(Todo).where(Todo.family_id == family_id, Todo.due_date.between(frm, to))
    ):
        out.append(
            OccurrenceOut(
                key=f"todo:{t.id}", date=t.due_date, title=t.title, kind="todo", source_type="todo", source_id=t.id, done=t.done
            )
        )

    for p in await db.scalars(select(PurchasedItem).where(PurchasedItem.family_id == family_id)):
        if frm <= p.bought_date <= to:
            out.append(
                OccurrenceOut(
                    key=f"purchase:{p.id}", date=p.bought_date, title=p.item_name, kind="purchase", source_type="purchase", source_id=p.id
                )
            )
        if p.has_warranty and p.warranty_expiry_date and frm <= p.warranty_expiry_date <= to:
            out.append(
                OccurrenceOut(
                    key=f"warranty:{p.id}",
                    date=p.warranty_expiry_date,
                    title=p.item_name,
                    kind="warranty",
                    source_type="purchase",
                    source_id=p.id,
                )
            )

    for d in await db.scalars(
        select(Document).where(
            Document.family_id == family_id, Document.deleted_at.is_(None), Document.expiry_date.between(frm, to)
        )
    ):
        out.append(
            OccurrenceOut(
                key=f"document:{d.id}", date=d.expiry_date, title=d.title, kind="document", source_type="document", source_id=d.id
            )
        )

    out.sort(key=lambda o: (o.date, o.time is None, o.time or dt.time.min, _KIND_ORDER[o.kind], o.title.lower()))
    return out


@router.get("", response_model=list[OccurrenceOut])
async def calendar_range(
    member: Reader,
    db: Db,
    frm: Annotated[date, Query(alias="from")],
    to: date,
) -> list[OccurrenceOut]:
    if to < frm:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "`to` must not be before `from`.")
    if (to - frm).days > MAX_RANGE_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Ask for at most {MAX_RANGE_DAYS} days at a time.")
    return await family_occurrences(db, member.family.id, frm, to)


# --- Subscription feed ----------------------------------------------------------------


@router.get("/feed", response_model=CalendarFeedOut)
async def feed_status(member: CurrentMember, db: Db) -> CalendarFeedOut:
    feed = await db.get(CalendarFeed, member.user.id)
    return CalendarFeedOut(active=feed is not None, created_at=feed.created_at if feed else None)


@router.post("/feed", response_model=CalendarFeedCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_feed(member: CurrentMember, db: Db) -> CalendarFeedCreatedOut:
    """Create the user's feed link, replacing (and so disabling) any earlier one."""
    token, token_hash = new_session_token()
    feed = await db.get(CalendarFeed, member.user.id)
    if feed is None:
        feed = CalendarFeed(user_id=member.user.id, token_hash=token_hash)
        db.add(feed)
    else:
        feed.token_hash = token_hash
        feed.created_at = datetime.now(UTC)
    await db.commit()
    return CalendarFeedCreatedOut(path=FEED_PATH.format(token=token), created_at=feed.created_at)


@router.delete("/feed", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_feed(member: CurrentMember, db: Db) -> None:
    feed = await db.get(CalendarFeed, member.user.id)
    if feed is not None:
        await db.delete(feed)
        await db.commit()


# No session cookie here: calendar apps fetch this URL on their own. The token in it is the credential.
@router.get("/feed/{token}.ics", include_in_schema=False)
async def feed_ics(token: str, db: Db) -> Response:
    feed = await db.scalar(select(CalendarFeed).where(CalendarFeed.token_hash == hash_token(token)))
    membership = await find_membership(db, feed.user) if feed else None
    if feed is None or membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This calendar link has been turned off.")

    body = build_ics(
        f"Family Hub · {membership.family.name}",
        await _feed_events(db, membership.family_id),
        now=datetime.now(UTC),
    )
    return Response(
        body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="family-hub.ics"', "Cache-Control": "private, max-age=300"},
    )


# 9am on the day, and 9am a week before.
_ON_THE_DAY = "PT9H"
_WEEK_BEFORE = "-P6DT15H"


async def _feed_events(db: AsyncSession, family_id) -> list[IcsEvent]:
    out: list[IcsEvent] = []
    for e in await db.scalars(select(CalendarEvent).where(CalendarEvent.family_id == family_id)):
        alarm = None
        if e.kind == "reminder":
            alarm = "PT0M" if e.start_time else _ON_THE_DAY
        elif e.kind == "birthday":
            alarm = _ON_THE_DAY
        out.append(
            IcsEvent(
                uid=f"event-{e.id}@family-hub",
                summary=f"🎂 {e.title}" if e.kind == "birthday" else e.title,
                start=e.start_date,
                start_time=e.start_time,
                recurrence=e.recurrence,
                description=e.notes,
                categories=e.kind.capitalize(),
                alarm=alarm,
                updated=e.updated_at,
            )
        )

    for t in await db.scalars(
        select(Todo).where(Todo.family_id == family_id, Todo.due_date.is_not(None), Todo.done.is_(False))
    ):
        out.append(
            IcsEvent(
                uid=f"todo-{t.id}@family-hub",
                summary=f"To-do: {t.title}",
                start=t.due_date,
                description=f"Assigned to {t.assignee_email}" if t.assignee_email else "",
                categories="To-do",
                alarm=_ON_THE_DAY,
                updated=t.updated_at,
            )
        )

    for p in await db.scalars(select(PurchasedItem).where(PurchasedItem.family_id == family_id)):
        out.append(
            IcsEvent(
                uid=f"purchase-{p.id}@family-hub",
                summary=f"Bought: {p.item_name}",
                start=p.bought_date,
                description=p.specifications,
                categories="Purchase",
                url=p.purchase_link,
                updated=p.updated_at,
            )
        )
        if p.has_warranty and p.warranty_expiry_date:
            out.append(
                IcsEvent(
                    uid=f"warranty-{p.id}@family-hub",
                    summary=f"Warranty ends: {p.item_name}",
                    start=p.warranty_expiry_date,
                    description=p.specifications,
                    categories="Warranty",
                    alarm=_WEEK_BEFORE,
                    updated=p.updated_at,
                )
            )

    for d in await db.scalars(
        select(Document).where(
            Document.family_id == family_id, Document.deleted_at.is_(None), Document.expiry_date.is_not(None)
        )
    ):
        out.append(
            IcsEvent(
                uid=f"document-{d.id}@family-hub",
                summary=f"Expires: {d.title}",
                start=d.expiry_date,
                description=d.notes,
                categories="Document",
                alarm=_WEEK_BEFORE,
                updated=d.updated_at,
            )
        )
    return out
