import os

# Point the app at the test database before anything imports app.db (the engine is built at import).
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://familyhub:familyhub@localhost:5432/familyhub_test"
)

from collections.abc import AsyncIterator, Awaitable, Callable  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


# Database fixtures are opt-in (through make_user / anon), so pure unit tests run without Postgres.


@pytest.fixture(scope="session")
async def schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture
async def clean_tables(schema: None) -> None:
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))


ClientFactory = Callable[..., Awaitable[httpx.AsyncClient]]


@pytest.fixture
async def make_user(clean_tables: None) -> AsyncIterator[ClientFactory]:
    """Returns `await make_user("a@x.com")`: a client signed up (and signed in) as that user."""
    clients: list[httpx.AsyncClient] = []

    async def factory(email: str, name: str | None = None) -> httpx.AsyncClient:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        clients.append(client)
        r = await client.post(
            "/api/auth/signup", json={"displayName": name or email.split("@")[0], "email": email, "password": "password123"}
        )
        assert r.status_code == 201, r.text
        return client

    yield factory
    for c in clients:
        await c.aclose()


@pytest.fixture
async def anon(clean_tables: None) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def create_family(client: httpx.AsyncClient, name: str = "The Testers") -> dict:
    r = await client.post("/api/family", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


async def add_member(admin: httpx.AsyncClient, member: httpx.AsyncClient, email: str, role_id: str) -> dict:
    """Invite `email` with `role_id` and accept the invite as `member`."""
    r = await admin.post("/api/members", json={"email": email, "roleId": role_id})
    assert r.status_code == 201, r.text
    invites = (await member.get("/api/invites/mine")).json()
    r = await member.post("/api/family/join", json={"code": invites[0]["code"]})
    assert r.status_code == 200, r.text
    return r.json()
