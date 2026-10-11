import urllib.parse
from pathlib import Path

import boto3
import httpx
import pytest
from botocore.config import Config

from app.main import app
from app.storage import LocalStorage, S3Storage, content_disposition, get_storage

from .conftest import add_member, create_family

PDF = b"%PDF-1.4 receipt"


@pytest.fixture
def storage(tmp_path: Path):
    local = LocalStorage(tmp_path)
    app.dependency_overrides[get_storage] = lambda: local
    yield local
    app.dependency_overrides.pop(get_storage, None)


async def upload(client: httpx.AsyncClient, data: bytes = PDF, filename: str = "receipt.pdf", content_type: str = "application/pdf") -> str:
    r = await client.post("/api/docs/uploads", json={"filename": filename, "contentType": content_type, "size": len(data)})
    assert r.status_code == 201, r.text
    ticket = r.json()
    r = await client.put(ticket["url"], content=data, headers=ticket["headers"])
    assert r.status_code == 204, r.text
    return ticket["uploadId"]


async def create_doc(client: httpx.AsyncClient, data: bytes = PDF, filename: str = "receipt.pdf", **fields) -> dict:
    r = await client.post("/api/docs", json={"uploadId": await upload(client, data, filename), **fields})
    assert r.status_code == 201, r.text
    return r.json()


async def fetch(client: httpx.AsyncClient, doc_id: str, **params) -> httpx.Response:
    r = await client.get(f"/api/docs/{doc_id}/download", params=params)
    assert r.status_code == 200, r.text
    return await client.get(r.json()["url"])


async def test_upload_replace_and_restore_version(make_user, storage):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    doc = await create_doc(admin, filename="Passport scan.pdf", expiryDate="2030-05-01")
    assert (doc["title"], doc["expiryDate"], doc["deletedAt"]) == ("Passport scan", "2030-05-01", None)
    assert doc["file"]["filename"] == "Passport scan.pdf"
    assert (doc["file"]["size"], doc["file"]["contentType"], doc["file"]["uploadedBy"]) == (len(PDF), "application/pdf", "admin@example.com")
    first_version = doc["file"]["id"]
    assert (await fetch(admin, doc["id"])).content == PDF

    r = await admin.post(f"/api/docs/{doc['id']}/versions", json={"uploadId": await upload(admin, b"%PDF new", "renewed.pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["file"]["filename"] == "renewed.pdf"
    assert (await fetch(admin, doc["id"])).content == b"%PDF new"
    # Earlier versions stay downloadable.
    assert (await fetch(admin, doc["id"], versionId=first_version)).content == PDF

    versions = (await admin.get(f"/api/docs/{doc['id']}/versions")).json()
    assert [v["filename"] for v in versions] == ["renewed.pdf", "Passport scan.pdf"]

    r = await admin.post(f"/api/docs/{doc['id']}/versions/{first_version}/restore")
    assert r.json()["file"]["id"] == first_version
    assert (await fetch(admin, doc["id"])).content == PDF

    r = await admin.patch(f"/api/docs/{doc['id']}", json={"title": "Ana's passport", "expiryDate": None})
    assert (r.json()["title"], r.json()["expiryDate"]) == ("Ana's passport", None)
    assert (await admin.patch(f"/api/docs/{doc['id']}", json={"title": " "})).status_code == 422

    # Newest first, though events in the same clock tick may come in either order.
    events = (await admin.get("/api/docs/audit", params={"documentId": doc["id"]})).json()
    actions = [(e["action"], e["detail"]) for e in events]
    assert sorted(a for a, _ in actions) == sorted(
        ["update", "download", "restore_version", "download", "download", "replace", "download", "upload"]
    )
    assert ("update", "Changed title, expiry date") in actions
    assert ("download", "Passport scan.pdf (earlier version)") in actions
    assert [e["at"] for e in events] == sorted((e["at"] for e in events), reverse=True)


async def test_upload_is_checked(make_user, storage):
    admin = await make_user("admin@example.com")
    bob = await make_user("bob@example.com")
    await create_family(admin)
    await add_member(admin, bob, "bob@example.com", "editor")

    r = await admin.post("/api/docs/uploads", json={"filename": "huge.bin", "size": 26 * 1024 * 1024})
    assert r.status_code == 413

    ticket = (await admin.post("/api/docs/uploads", json={"filename": "a.txt", "contentType": "text/plain", "size": 3})).json()
    # Nothing uploaded yet.
    assert (await admin.post("/api/docs", json={"uploadId": ticket["uploadId"]})).status_code == 409
    # More bytes than declared.
    assert (await admin.put(ticket["url"], content=b"abcdef")).status_code == 413
    # Someone else's upload.
    assert (await bob.put(ticket["url"], content=b"abc")).status_code == 404
    assert (await admin.put(ticket["url"], content=b"abc")).status_code == 204
    assert (await bob.post("/api/docs", json={"uploadId": ticket["uploadId"]})).status_code == 404

    doc = (await admin.post("/api/docs", json={"uploadId": ticket["uploadId"], "title": "Notes"})).json()
    # An upload can only be used once.
    assert (await admin.post("/api/docs", json={"uploadId": ticket["uploadId"]})).status_code == 404
    assert (await admin.post(f"/api/docs/{doc['id']}/versions", json={"uploadId": ticket["uploadId"]})).status_code == 404

    # Fewer bytes than declared.
    ticket = (await admin.post("/api/docs/uploads", json={"filename": "b.txt", "size": 10})).json()
    await admin.put(ticket["url"], content=b"short")
    assert (await admin.post("/api/docs", json={"uploadId": ticket["uploadId"]})).status_code == 422

    # Paths and odd content types are cleaned up.
    ticket = (await admin.post("/api/docs/uploads", json={"filename": "C:\\Users\\x\\..\\evil.html", "contentType": "text/html; charset=x", "size": 2})).json()
    assert ticket["headers"] == {"Content-Type": "text/html"}
    await admin.put(ticket["url"], content=b"<b")
    doc = (await admin.post("/api/docs", json={"uploadId": ticket["uploadId"]})).json()
    assert (doc["title"], doc["file"]["filename"]) == ("evil", "evil.html")


async def test_only_safe_types_open_inline(make_user, storage):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    pdf = await create_doc(admin)
    r = await fetch(admin, pdf["id"], inline="true")
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline;")

    page = (await admin.post("/api/docs", json={"uploadId": await upload(admin, b"<script>", "page.html", "text/html")})).json()
    r = await fetch(admin, page["id"], inline="true")
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"].startswith("attachment;")
    assert r.headers["content-security-policy"] == "sandbox"
    assert r.headers["x-content-type-options"] == "nosniff"


async def test_folders(make_user, storage):
    admin = await make_user("admin@example.com")
    await create_family(admin)

    ids = {}
    for name in ("Home", "Insurance"):
        r = await admin.post("/api/docs/folders", json={"name": name})
        assert r.status_code == 201
        ids[name] = r.json()["id"]
    r = await admin.post("/api/docs/folders", json={"name": "Car", "parentId": ids["Insurance"]})
    car = r.json()
    assert car["parentId"] == ids["Insurance"]

    assert (await admin.post("/api/docs/folders", json={"name": "home"})).status_code == 409
    # Same name is fine somewhere else.
    assert (await admin.post("/api/docs/folders", json={"name": "Home", "parentId": ids["Insurance"]})).status_code == 201
    # No loops.
    r = await admin.patch(f"/api/docs/folders/{ids['Insurance']}", json={"parentId": car["id"]})
    assert r.status_code == 422
    assert (await admin.patch(f"/api/docs/folders/{car['id']}", json={"parentId": car["id"]})).status_code == 422
    r = await admin.patch(f"/api/docs/folders/{car['id']}", json={"name": "Vehicles", "parentId": None})
    assert (r.json()["name"], r.json()["parentId"]) == ("Vehicles", None)

    assert [f["name"] for f in (await admin.get("/api/docs/folders")).json()] == ["Home", "Home", "Insurance", "Vehicles"]

    doc = await create_doc(admin, folderId=car["id"])
    assert doc["folderId"] == car["id"]
    assert (await admin.delete(f"/api/docs/folders/{car['id']}")).status_code == 409
    await admin.delete(f"/api/docs/{doc['id']}")
    # Trashed documents don't block deleting; they move to the top level.
    assert (await admin.delete(f"/api/docs/folders/{car['id']}")).status_code == 204
    trashed = (await admin.get("/api/docs", params={"trash": "true"})).json()
    assert trashed[0]["folderId"] is None
    assert (await admin.delete(f"/api/docs/folders/{ids['Insurance']}")).status_code == 409  # has a subfolder


async def test_trash_restore_and_purge(make_user, storage):
    admin = await make_user("admin@example.com")
    await create_family(admin)
    doc = await create_doc(admin)
    await admin.post(f"/api/docs/{doc['id']}/versions", json={"uploadId": await upload(admin, b"v2")})
    assert len(list(storage.root.rglob("*"))) > 0

    assert (await admin.delete(f"/api/docs/{doc['id']}")).status_code == 204
    assert (await admin.get("/api/docs")).json() == []
    assert [d["id"] for d in (await admin.get("/api/docs", params={"trash": "true"})).json()] == [doc["id"]]
    assert (await admin.patch(f"/api/docs/{doc['id']}", json={"title": "x"})).status_code == 409

    r = await admin.post(f"/api/docs/{doc['id']}/restore")
    assert (r.status_code, r.json()["deletedAt"]) == (200, None)
    assert (await admin.post(f"/api/docs/{doc['id']}/restore")).status_code == 409

    assert (await admin.delete(f"/api/docs/{doc['id']}", params={"permanent": "true"})).status_code == 204
    assert (await admin.get(f"/api/docs/{doc['id']}/versions")).status_code == 404
    assert [p for p in storage.root.rglob("*") if p.is_file()] == []

    # The audit log outlives the document.
    events = (await admin.get("/api/docs/audit")).json()
    assert {"upload", "replace", "trash", "restore", "purge"} <= {e["action"] for e in events}
    assert {e["documentTitle"] for e in events} == {"receipt"}
    assert all(e["documentId"] is None for e in events)


async def test_readers_and_other_families(make_user, storage):
    admin = await make_user("admin@example.com")
    reader = await make_user("r@example.com")
    outsider = await make_user("o@example.com")
    await create_family(admin)
    await add_member(admin, reader, "r@example.com", "reader")
    await create_family(outsider, "Other family")
    doc = await create_doc(admin)

    assert [d["id"] for d in (await reader.get("/api/docs")).json()] == [doc["id"]]
    assert (await fetch(reader, doc["id"])).content == PDF
    assert (await reader.post("/api/docs/uploads", json={"filename": "a", "size": 1})).status_code == 403
    assert (await reader.patch(f"/api/docs/{doc['id']}", json={"title": "x"})).status_code == 403
    assert (await reader.delete(f"/api/docs/{doc['id']}")).status_code == 403
    assert (await reader.post("/api/docs/folders", json={"name": "x"})).status_code == 403

    assert (await outsider.get("/api/docs")).json() == []
    assert (await outsider.get(f"/api/docs/{doc['id']}/download")).status_code == 404
    assert (await outsider.get(f"/api/docs/files/{doc['file']['id']}")).status_code == 404
    assert (await outsider.get(f"/api/docs/{doc['id']}/versions")).status_code == 404
    assert (await outsider.delete(f"/api/docs/{doc['id']}", params={"permanent": "true"})).status_code == 404
    assert (await outsider.get("/api/docs/audit")).json() == []
    folder = (await admin.post("/api/docs/folders", json={"name": "Private"})).json()
    assert (await outsider.post("/api/docs", json={"uploadId": await upload(outsider), "folderId": folder["id"]})).status_code == 422


async def test_purchase_attachments_and_calendar(make_user, storage):
    admin = await make_user("admin@example.com")
    outsider = await make_user("o@example.com")
    await create_family(admin)
    await create_family(outsider, "Other family")
    fridge = (await admin.post("/api/purchases", json={"itemName": "Fridge", "boughtDate": "2026-03-10"})).json()

    receipt = await create_doc(admin, purchaseId=fridge["id"])
    await create_doc(admin, filename="unrelated.pdf")
    attached = (await admin.get("/api/docs", params={"purchaseId": fridge["id"]})).json()
    assert [d["id"] for d in attached] == [receipt["id"]]
    r = await outsider.post("/api/docs", json={"uploadId": await upload(outsider), "purchaseId": fridge["id"]})
    assert r.status_code == 422

    # Deleting the purchase keeps its documents.
    await admin.delete(f"/api/purchases/{fridge['id']}")
    docs = (await admin.get("/api/docs")).json()
    assert {d["title"]: d["purchaseId"] for d in docs} == {"receipt": None, "unrelated": None}

    licence = await create_doc(admin, filename="licence.pdf", expiryDate="2026-11-20", notes="Renew online")
    cal = (await admin.get("/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"})).json()
    assert [(o["kind"], o["sourceType"], o["title"], o["date"]) for o in cal] == [("document", "document", "licence", "2026-11-20")]

    path = (await admin.post("/api/calendar/feed")).json()["path"]
    ics = (await admin.get(path)).text
    assert "SUMMARY:Expires: licence" in ics and "DESCRIPTION:Renew online" in ics

    await admin.delete(f"/api/docs/{licence['id']}")
    assert (await admin.get("/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"})).json() == []
    assert "Expires: licence" not in (await admin.get(path)).text


def test_s3_presigned_urls():
    client = boto3.Session(aws_access_key_id="AKIDEXAMPLE", aws_secret_access_key="secret", region_name="ap-southeast-2").client(
        "s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
    )
    s3 = S3Storage("family-hub-documents-test", "ap-southeast-2", 300, client=client)

    put = s3.upload_target(None, "families/f/docs/v", "application/pdf")  # type: ignore[arg-type]
    url = urllib.parse.urlsplit(put.url)
    query = urllib.parse.parse_qs(url.query)
    assert url.netloc == "family-hub-documents-test.s3.ap-southeast-2.amazonaws.com"
    assert url.path == "/families/f/docs/v"
    assert "content-type" in query["X-Amz-SignedHeaders"][0]
    assert query["X-Amz-Expires"] == ["300"]
    assert put.headers == {"Content-Type": "application/pdf"}

    get = urllib.parse.parse_qs(urllib.parse.urlsplit(s3.download_url(None, "k", "Rëceipt 1.pdf", "application/pdf", False)).query)  # type: ignore[arg-type]
    assert get["response-content-disposition"] == [content_disposition("Rëceipt 1.pdf", False)]
    assert get["response-content-type"] == ["application/octet-stream"]


def test_content_disposition():
    assert content_disposition("Rëceipt 1.pdf", True) == "inline; filename=\"R_ceipt 1.pdf\"; filename*=UTF-8''R%C3%ABceipt%201.pdf"
    assert content_disposition('a"b.txt', False).startswith('attachment; filename="a_b.txt"')
