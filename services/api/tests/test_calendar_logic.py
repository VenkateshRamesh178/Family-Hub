"""Recurrence and iCalendar output. No database needed."""

from datetime import UTC, date, datetime, time

from app.calendar import IcsEvent, build_ics, escape_text, fold, occurrences


def d(s: str) -> date:
    return date.fromisoformat(s)


def occ(start: str, rec: str, frm: str, to: str) -> list[str]:
    return [x.isoformat() for x in occurrences(d(start), rec, d(frm), d(to))]


def test_one_off():
    assert occ("2026-10-11", "none", "2026-10-01", "2026-10-31") == ["2026-10-11"]
    assert occ("2026-10-11", "none", "2026-11-01", "2026-11-30") == []


def test_weekly_starts_at_first_occurrence_in_range():
    assert occ("2026-10-01", "weekly", "2026-10-10", "2026-10-31") == ["2026-10-15", "2026-10-22", "2026-10-29"]
    # Never before the start date.
    assert occ("2026-10-20", "weekly", "2026-10-01", "2026-10-31") == ["2026-10-20", "2026-10-27"]


def test_monthly_skips_months_without_that_day():
    assert occ("2026-01-31", "monthly", "2026-01-01", "2026-05-31") == ["2026-01-31", "2026-03-31", "2026-05-31"]
    assert occ("2026-03-15", "monthly", "2026-01-01", "2026-04-30") == ["2026-03-15", "2026-04-15"]


def test_yearly_and_leap_day_birthdays():
    assert occ("1990-06-02", "yearly", "2026-01-01", "2027-12-31") == ["2026-06-02", "2027-06-02"]
    assert occ("2000-02-29", "yearly", "2026-01-01", "2028-12-31") == ["2028-02-29"]


def test_range_before_start_is_empty():
    assert occ("2027-01-01", "yearly", "2026-01-01", "2026-12-31") == []


def test_escape_and_fold():
    assert escape_text("a, b; c\\d\nnext") == "a\\, b\\; c\\\\d\\nnext"
    long = "SUMMARY:" + "é" * 60  # 2 bytes each
    folded = fold(long)
    parts = folded.split("\r\n ")
    assert "".join(parts) == long
    assert all(len(p.encode()) <= 75 for p in parts)


def test_build_ics():
    now = datetime(2026, 10, 11, 8, 30, tzinfo=UTC)
    ics = build_ics(
        "Family Hub · The Sharmas",
        [
            IcsEvent(uid="event-1@family-hub", summary="🎂 Ana", start=d("1990-06-02"), recurrence="yearly", alarm="PT9H"),
            IcsEvent(uid="event-2@family-hub", summary="Dentist", start=d("2026-10-20"), start_time=time(9, 30)),
        ],
        now=now,
    )
    assert ics.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
    assert ics.endswith("END:VCALENDAR\r\n")
    assert "X-WR-CALNAME:Family Hub · The Sharmas" in ics
    assert "DTSTART;VALUE=DATE:19900602\r\nDTEND;VALUE=DATE:19900603" in ics
    assert "RRULE:FREQ=YEARLY" in ics
    assert "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:🎂 Ana\r\nTRIGGER:PT9H\r\nEND:VALARM" in ics
    assert "DTSTART:20261020T093000\r\nDURATION:PT1H" in ics
    assert "DTSTAMP:20261011T083000Z" in ics
    assert ics.count("BEGIN:VEVENT") == 2
