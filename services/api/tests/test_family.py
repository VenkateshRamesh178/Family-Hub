from .conftest import add_member, create_family

CUSTOM_LISTS_ONLY = {
    "id": "custom-shopper",
    "name": "Shopper",
    "folders": {"meta": "writer", "lists": "writer", "docs": "reader", "chat": "writer", "audit": "writer", "snapshots": "reader"},
}


async def test_create_family_makes_creator_admin(make_user):
    admin = await make_user("admin@example.com", "Admin")
    assert (await admin.get("/api/family")).json() is None

    session = await create_family(admin, "The Sharmas")
    assert session["family"]["name"] == "The Sharmas"
    assert session["family"]["ownerEmail"] == "admin@example.com"
    assert session["isAdmin"] is True
    assert session["role"]["id"] == "admin"
    assert (await admin.get("/api/family")).json() == session

    assert (await admin.post("/api/family", json={"name": "Second"})).status_code == 409


async def test_invite_and_join(make_user):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com", "Bob")
    await create_family(admin, "The Sharmas")

    r = await admin.post("/api/members", json={"email": "Bob@Example.com", "roleId": "reader"})
    assert r.status_code == 201
    assert r.json()["status"] == "invited"
    assert (await admin.post("/api/members", json={"email": "bob@example.com", "roleId": "reader"})).status_code == 409

    invites = (await bob.get("/api/invites/mine")).json()
    assert [(i["familyName"], i["roleName"], i["invitedBy"]) for i in invites] == [("The Sharmas", "Reader", "admin@example.com")]

    session = (await bob.post("/api/family/join", json={"code": invites[0]["code"]})).json()
    assert session["role"]["id"] == "reader"
    assert session["isAdmin"] is False
    assert (await bob.get("/api/invites/mine")).json() == []

    members = (await admin.get("/api/members")).json()
    assert [(m["email"], m["roleId"], m["status"]) for m in members] == [
        ("admin@example.com", "admin", "active"),
        ("bob@example.com", "reader", "active"),
    ]


async def test_invite_is_only_for_the_invited_email(make_user):
    admin = await make_user("admin@example.com")
    await make_user("bob@example.com")
    eve = await make_user("eve@example.com")
    await create_family(admin)
    await admin.post("/api/members", json={"email": "bob@example.com", "roleId": "editor"})
    bob_invite = (await admin.get("/api/members")).json()  # sanity: invite exists
    assert bob_invite[-1]["status"] == "invited"

    # Eve can't see Bob's invite and can't guess her way in.
    assert (await eve.get("/api/invites/mine")).json() == []
    r = await eve.post("/api/family/join", json={"code": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404


async def test_non_admin_cannot_manage_members(make_user):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)
    await add_member(admin, bob, "bob@example.com", "editor")

    assert (await bob.get("/api/members")).status_code == 200
    assert (await bob.post("/api/members", json={"email": "x@example.com", "roleId": "reader"})).status_code == 403
    assert (await bob.delete("/api/members/admin@example.com")).status_code == 403
    assert (await bob.put("/api/roles/custom-shopper", json=CUSTOM_LISTS_ONLY)).status_code == 403


async def test_admin_cannot_be_demoted_or_removed(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)
    assert (await admin.patch("/api/members/admin@example.com", json={"roleId": "reader"})).status_code == 422
    assert (await admin.delete("/api/members/admin@example.com")).status_code == 422
    assert (await admin.post("/api/members", json={"email": "x@example.com", "roleId": "admin"})).status_code == 422


async def test_role_change_and_removal_take_effect(make_user):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)
    await add_member(admin, bob, "bob@example.com", "reader")

    item = {"name": "Milk"}
    assert (await bob.post("/api/shopping", json=item)).status_code == 403

    assert (await admin.patch("/api/members/bob@example.com", json={"roleId": "editor"})).status_code == 200
    assert (await bob.post("/api/shopping", json=item)).status_code == 201

    assert (await admin.delete("/api/members/bob@example.com")).status_code == 204
    assert (await bob.get("/api/family")).json() is None
    assert (await bob.get("/api/shopping")).status_code == 403


async def test_custom_roles(make_user):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)

    r = await admin.put("/api/roles/custom-shopper", json=CUSTOM_LISTS_ONLY)
    assert r.status_code == 200
    # _meta is forced to view-only: only the admin manages members and roles.
    assert r.json()["folders"]["meta"] == "reader"
    assert [role["id"] for role in (await admin.get("/api/roles")).json()] == ["editor", "reader", "custom-shopper"]

    await add_member(admin, bob, "bob@example.com", "custom-shopper")
    assert (await bob.post("/api/shopping", json={"name": "Eggs"})).status_code == 201
    assert (await bob.post("/api/members", json={"email": "x@example.com", "roleId": "reader"})).status_code == 403

    r = await admin.delete("/api/roles/custom-shopper")
    assert r.status_code == 409
    assert "still assigned to 1" in r.json()["detail"]

    await admin.patch("/api/members/bob@example.com", json={"roleId": "reader"})
    assert (await admin.delete("/api/roles/custom-shopper")).status_code == 204
    assert (await admin.patch("/api/members/bob@example.com", json={"roleId": "custom-shopper"})).status_code == 422
