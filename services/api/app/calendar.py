"""Calendar logic with no database or HTTP: recurrence expansion and iCalendar output.

Recurrence follows RFC 5545, so the app and subscribed phone calendars agree: a
monthly event on the 31st skips shorter months, and a yearly one on 29 February
only occurs in leap years.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

Recurrence = str  # "none" | "weekly" | "monthly" | "yearly"


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def occurrences(start: date, recurrence: Recurrence, frm: date, to: date) -> Iterator[date]:
    """Dates in [frm, to] on which an item starting on `start` occurs."""
    if to < frm or to < start:
        return
    if recurrence == "none":
        if frm <= start <= to:
            yield start
    elif recurrence == "weekly":
        skip_weeks = max(0, -(-(frm - start).days // 7))  # ceil division
        d = start + timedelta(weeks=skip_weeks)
        while d <= to:
            yield d
            d += timedelta(weeks=1)
    elif recurrence == "monthly":
        first = max(start, frm)
        y, m = first.year, first.month
        while (y, m) <= (to.year, to.month):
            d = _safe_date(y, m, start.day)
            if d is not None and frm <= d <= to and d >= start:
                yield d
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    elif recurrence == "yearly":
        for y in range(max(start.year, frm.year), to.year + 1):
            d = _safe_date(y, start.month, start.day)
            if d is not None and frm <= d <= to:
                yield d
    else:
        raise ValueError(f"Unknown recurrence {recurrence!r}")


# --- iCalendar (RFC 5545) ---------------------------------------------------------


@dataclass
class IcsEvent:
    uid: str
    summary: str
    start: date
    start_time: time | None = None
    recurrence: Recurrence = "none"
    description: str = ""
    categories: str = ""
    # Alarm trigger relative to the start, e.g. "PT9H" (9am on an all-day item) or "-P6DT15H".
    alarm: str | None = None
    updated: datetime | None = None
    url: str | None = None


_RRULE = {"weekly": "FREQ=WEEKLY", "monthly": "FREQ=MONTHLY", "yearly": "FREQ=YEARLY"}


def escape_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")
    )


def fold(line: str) -> str:
    """Split a content line into 75-octet pieces (RFC 5545 §3.1) without breaking UTF-8 characters."""
    out: list[str] = []
    current, size = "", 0
    for ch in line:
        n = len(ch.encode())
        limit = 75 if not out else 74  # continuation lines start with a space
        if size + n > limit:
            out.append(current)
            current, size = "", 0
        current += ch
        size += n
    out.append(current)
    return "\r\n ".join(out)


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def build_ics(calendar_name: str, events: Iterable[IcsEvent], now: datetime) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Family Hub//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(calendar_name)}",
        # Hints for how often subscribers re-fetch. Google Calendar ignores them (it refreshes every few hours).
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{_stamp(e.updated or now)}"]
        if e.start_time is None:
            lines += [
                f"DTSTART;VALUE=DATE:{e.start:%Y%m%d}",
                f"DTEND;VALUE=DATE:{e.start + timedelta(days=1):%Y%m%d}",
                "TRANSP:TRANSPARENT",
            ]
        else:
            # Floating local time: shown at the same clock time wherever the subscriber is.
            lines += [f"DTSTART:{datetime.combine(e.start, e.start_time):%Y%m%dT%H%M%S}", "DURATION:PT1H"]
        if e.recurrence in _RRULE:
            lines.append(f"RRULE:{_RRULE[e.recurrence]}")
        lines.append(f"SUMMARY:{escape_text(e.summary)}")
        if e.description:
            lines.append(f"DESCRIPTION:{escape_text(e.description)}")
        if e.categories:
            lines.append(f"CATEGORIES:{escape_text(e.categories)}")
        if e.url:
            lines.append(f"URL:{e.url}")
        if e.alarm:
            lines += [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{escape_text(e.summary)}",
                f"TRIGGER:{e.alarm}",
                "END:VALARM",
            ]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
