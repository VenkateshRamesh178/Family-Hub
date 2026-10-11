async def test_sign_up_sign_out_sign_in(anon, make_user):
    client = await make_user("Ana@Example.com", "Ana")
    me = (await client.get("/api/auth/me")).json()
    assert me == {"email": "ana@example.com", "displayName": "Ana"}

    assert (await client.post("/api/auth/signout")).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401

    r = await anon.post("/api/auth/signin", json={"email": "ana@example.com", "password": "wrong-password"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Email or password is incorrect."

    r = await anon.post("/api/auth/signin", json={"email": "ANA@example.com", "password": "password123"})
    assert r.status_code == 200
    assert (await anon.get("/api/auth/me")).json()["email"] == "ana@example.com"


async def test_unknown_email_gets_same_error(anon):
    r = await anon.post("/api/auth/signin", json={"email": "nobody@example.com", "password": "password123"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Email or password is incorrect."


async def test_duplicate_email_rejected(anon, make_user):
    await make_user("ana@example.com")
    r = await anon.post("/api/auth/signup", json={"displayName": "A", "email": "ANA@example.com", "password": "password123"})
    assert r.status_code == 409


async def test_validation_errors_are_readable(anon):
    r = await anon.post("/api/auth/signup", json={"displayName": "A", "email": "a@example.com", "password": "short"})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("password:")


async def test_everything_else_needs_a_session(anon):
    for path in ("/api/family", "/api/members", "/api/shopping", "/api/todos", "/api/purchases"):
        assert (await anon.get(path)).status_code == 401, path
