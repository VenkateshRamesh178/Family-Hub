from .conftest import add_member, create_family


async def test_shopping_crud_and_clear_checked(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    milk = (await admin.post("/api/shopping", json={"name": "  Milk ", "quantity": 2, "unit": "L"})).json()
    assert (milk["name"], milk["quantity"], milk["unit"], milk["checked"]) == ("Milk", 2.0, "L", False)
    assert milk["createdBy"] == "admin@example.com"
    eggs = (await admin.post("/api/shopping", json={"name": "Eggs", "unit": ""})).json()
    assert eggs["unit"] is None and eggs["quantity"] is None

    r = await admin.patch(f"/api/shopping/{milk['id']}", json={"checked": True})
    assert r.json()["checked"] is True and r.json()["quantity"] == 2.0

    # Unchecked first.
    assert [i["name"] for i in (await admin.get("/api/shopping")).json()] == ["Eggs", "Milk"]

    assert (await admin.delete("/api/shopping/checked")).status_code == 204
    assert [i["name"] for i in (await admin.get("/api/shopping")).json()] == ["Eggs"]

    assert (await admin.patch(f"/api/shopping/{eggs['id']}", json={"name": ""})).status_code == 422
    assert (await admin.delete(f"/api/shopping/{eggs['id']}")).status_code == 204
    assert (await admin.get("/api/shopping")).json() == []


async def test_todos_assignee_must_be_in_family(make_user):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)
    await add_member(admin, bob, "bob@example.com", "editor")

    r = await admin.post("/api/todos", json={"title": "Book dentist", "dueDate": "2026-11-01", "assigneeEmail": "Bob@example.com"})
    assert r.status_code == 201
    todo = r.json()
    assert (todo["assigneeEmail"], todo["dueDate"], todo["done"]) == ("bob@example.com", "2026-11-01", False)

    r = await admin.post("/api/todos", json={"title": "x", "assigneeEmail": "stranger@example.com"})
    assert r.status_code == 422

    r = await bob.patch(f"/api/todos/{todo['id']}", json={"done": True, "assigneeEmail": None})
    assert (r.json()["done"], r.json()["assigneeEmail"]) == (True, None)


async def test_todo_order(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)
    for title, due in [("later", "2026-12-01"), ("no date", None), ("soon", "2026-10-05")]:
        await admin.post("/api/todos", json={"title": title, "dueDate": due})
    done = (await admin.post("/api/todos", json={"title": "finished", "dueDate": "2026-01-01", "done": True})).json()
    assert done["done"] is True
    assert [t["title"] for t in (await admin.get("/api/todos")).json()] == ["soon", "later", "no date", "finished"]


async def test_purchases_warranty_rules(make_user):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    base = {"itemName": "Fridge", "boughtDate": "2026-03-10"}
    r = await admin.post("/api/purchases", json={**base, "hasWarranty": True})
    assert r.status_code == 422
    assert "Warranty expiry date is required" in r.json()["detail"]

    r = await admin.post("/api/purchases", json={**base, "purchaseLink": "javascript:alert(1)"})
    assert r.status_code == 422
    r = await admin.post("/api/purchases", json={**base, "purchaseLink": "  "})
    assert (r.status_code, r.json()["purchaseLink"]) == (201, None)
    await admin.delete(f"/api/purchases/{r.json()['id']}")

    r = await admin.post(
        "/api/purchases",
        json={**base, "specifications": "LG 260L", "purchaseLink": "https://shop.example/fridge", "hasWarranty": True, "warrantyExpiryDate": "2028-03-10"},
    )
    assert r.status_code == 201
    fridge = r.json()
    assert fridge["warrantyExpiryDate"] == "2028-03-10"

    # Patches are validated against the merged item.
    r = await admin.patch(f"/api/purchases/{fridge['id']}", json={"warrantyExpiryDate": None})
    assert r.status_code == 422
    r = await admin.patch(f"/api/purchases/{fridge['id']}", json={"hasWarranty": False})
    assert (r.json()["hasWarranty"], r.json()["warrantyExpiryDate"]) == (False, None)

    tv = (await admin.post("/api/purchases", json={"itemName": "TV", "boughtDate": "2026-08-01"})).json()
    assert [p["itemName"] for p in (await admin.get("/api/purchases")).json()] == [tv["itemName"], "Fridge"]


async def test_families_are_isolated(make_user):
    a = await make_user("a@example.com")
    b = await make_user("b@example.com")
    await create_family(a, "A family")
    await create_family(b, "B family")

    item = (await a.post("/api/shopping", json={"name": "Secret"})).json()
    assert (await b.get("/api/shopping")).json() == []
    assert (await b.patch(f"/api/shopping/{item['id']}", json={"checked": True})).status_code == 404
    assert (await b.delete(f"/api/shopping/{item['id']}")).status_code == 404
    assert (await b.post("/api/todos", json={"title": "x", "assigneeEmail": "a@example.com"})).status_code == 422


async def test_readers_can_read_but_not_write(make_user):
    admin = await make_user("admin@example.com")
    reader = await make_user("r@example.com")
    await create_family(admin)
    await add_member(admin, reader, "r@example.com", "reader")
    item = (await admin.post("/api/purchases", json={"itemName": "Sofa", "boughtDate": "2026-01-01"})).json()

    assert len((await reader.get("/api/purchases")).json()) == 1
    assert (await reader.patch(f"/api/purchases/{item['id']}", json={"itemName": "x"})).status_code == 403
    assert (await reader.delete(f"/api/purchases/{item['id']}")).status_code == 403
    assert (await reader.delete("/api/shopping/checked")).status_code == 403
