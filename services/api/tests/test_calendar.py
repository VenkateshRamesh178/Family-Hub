from .conftest import add_member, create_family


async def test_events_crud_and_birthday_rules(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    r = await admin.post(
        "/api/events",
        json={"title": "Ana", "kind": "birthday", "startDate": "1990-06-02", "startTime": "10:00", "recurrence": "none"},
    )
    assert r.status_code == 201, r.text
    bday = r.json()
    # Birthdays are always all-day and yearly.
    assert (bday["kind"], bday["recurrence"], bday["startTime"]) == ("birthday", "yearly", None)

    r = await admin.post("/api/events", json={"title": "Dentist", "kind": "reminder", "startDate": "2026-10-20", "startTime": "09:30:45"})
    reminder = r.json()
    assert reminder["startTime"] == "09:30:00"

    r = await admin.patch(f"/api/events/{reminder['id']}", json={"recurrence": "weekly", "notes": "Bring the card"})
    assert (r.json()["recurrence"], r.json()["notes"]) == ("weekly", "Bring the card")

    assert (await admin.post("/api/events", json={"title": "x", "startDate": "2026-10-20", "kind": "party"})).status_code == 422
    assert len((await admin.get("/api/events")).json()) == 2
    assert (await admin.delete(f"/api/events/{reminder['id']}")).status_code == 204


async def test_calendar_combines_events_and_dated_items(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)
    await admin.post("/api/events", json={"title": "Ana", "kind": "birthday", "startDate": "1990-10-05"})
    await admin.post("/api/events", json={"title": "Bins", "kind": "reminder", "startDate": "2026-10-06", "startTime": "07:00", "recurrence": "weekly"})
    await admin.post("/api/todos", json={"title": "Pay rent", "dueDate": "2026-10-10"})
    await admin.post(
        "/api/purchases",
        json={"itemName": "Fridge", "boughtDate": "2024-10-12", "hasWarranty": True, "warrantyExpiryDate": "2026-10-12"},
    )
    await admin.post("/api/purchases", json={"itemName": "Kettle", "boughtDate": "2026-10-08"})

    r = await admin.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-14"})
    assert r.status_code == 200, r.text
    got = [(o["date"], o["kind"], o["title"], o.get("time"), o.get("age")) for o in r.json()]
    assert got == [
        ("2026-10-05", "birthday", "Ana", None, 36),
        ("2026-10-06", "reminder", "Bins", "07:00:00", None),
        ("2026-10-08", "purchase", "Kettle", None, None),
        ("2026-10-10", "todo", "Pay rent", None, None),
        ("2026-10-12", "warranty", "Fridge", None, None),
        ("2026-10-13", "reminder", "Bins", "07:00:00", None),
    ]
    keys = [o["key"] for o in r.json()]
    assert len(set(keys)) == len(keys)

    # Changes to the source show up immediately: nothing is copied.
    todo_id = next(o["sourceId"] for o in r.json() if o["kind"] == "todo")
    await admin.patch(f"/api/todos/{todo_id}", json={"dueDate": "2026-11-01"})
    r = await admin.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-14"})
    assert "todo" not in [o["kind"] for o in r.json()]


async def test_calendar_range_limits(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)
    assert (await admin.get("/api/calendar", params={"from": "2026-10-10", "to": "2026-10-01"})).status_code == 422
    assert (await admin.get("/api/calendar", params={"from": "2026-01-01", "to": "2027-12-31"})).status_code == 422


async def test_readers_see_but_cannot_add_events(make_user):
    admin = await make_user("admin@example.com")
    reader = await make_user("r@example.com")
    await create_family(admin)
    await add_member(admin, reader, "r@example.com", "reader")
    await admin.post("/api/events", json={"title": "Trip", "startDate": "2026-10-20"})

    r = await reader.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"})
    assert [o["title"] for o in r.json()] == ["Trip"]
    assert (await reader.post("/api/events", json={"title": "x", "startDate": "2026-10-20"})).status_code == 403


async def test_calendar_is_per_family(make_user):
    a = await make_user("a@example.com")
    b = await make_user("b@example.com")
    await create_family(a, "A")
    await create_family(b, "B")
    await a.post("/api/events", json={"title": "Secret", "startDate": "2026-10-20"})
    assert (await b.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"})).json() == []


async def test_ics_feed(make_user, anon):
    admin = await make_user("admin@example.com")
    await create_family(admin, "The Sharmas")
    assert (await admin.get("/api/calendar/feed")).json() == {"active": False, "createdAt": None}

    await admin.post("/api/events", json={"title": "Ana", "kind": "birthday", "startDate": "1990-10-05"})
    await admin.post("/api/todos", json={"title": "Pay rent", "dueDate": "2026-10-10"})
    await admin.post("/api/todos", json={"title": "Done already", "dueDate": "2026-10-10", "done": True})
    await admin.post(
        "/api/purchases",
        json={"itemName": "Fridge", "boughtDate": "2024-10-12", "hasWarranty": True, "warrantyExpiryDate": "2026-10-12"},
    )

    r = await admin.post("/api/calendar/feed")
    assert r.status_code == 201
    path = r.json()["path"]
    assert path.startswith("/api/calendar/feed/") and path.endswith(".ics")
    assert (await admin.get("/api/calendar/feed")).json()["active"] is True

    # Calendar apps fetch without a session cookie.
    r = await anon.get(path)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    ics = r.text
    assert "X-WR-CALNAME:Family Hub · The Sharmas" in ics
    assert "SUMMARY:🎂 Ana" in ics and "RRULE:FREQ=YEARLY" in ics
    assert "SUMMARY:To-do: Pay rent" in ics and "Done already" not in ics
    assert "SUMMARY:Warranty ends: Fridge" in ics and "TRIGGER:-P6DT15H" in ics
    assert "SUMMARY:Bought: Fridge" in ics

    # A new link replaces the old one.
    new_path = (await admin.post("/api/calendar/feed")).json()["path"]
    assert (await anon.get(path)).status_code == 404
    assert (await anon.get(new_path)).status_code == 200

    assert (await admin.delete("/api/calendar/feed")).status_code == 204
    assert (await anon.get(new_path)).status_code == 404
    assert (await anon.get("/api/calendar/feed/not-a-token.ics")).status_code == 404


async def test_feed_stops_when_member_leaves(make_user, anon):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)
    await add_member(admin, bob, "bob@example.com", "editor")
    path = (await bob.post("/api/calendar/feed")).json()["path"]
    assert (await anon.get(path)).status_code == 200

    await admin.delete("/api/members/bob@example.com")
    assert (await anon.get(path)).status_code == 404
