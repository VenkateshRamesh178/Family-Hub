"""Where document files are kept: a local folder (development) or an S3 bucket.

Every stored file is one version of one document, under a key the server picks:
`families/{familyId}/docs/{versionId}`. Keys never contain user input, and a
version is never overwritten, so "replace" and "restore" work the same on both
backends. (The S3 bucket also keeps object versions for 30 days as a safety net.)

The browser always moves the bytes itself, via the URLs returned here: presigned
S3 URLs, or API routes that stream to and from the local folder.
"""

import re
import urllib.parse
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from fastapi.concurrency import run_in_threadpool

from .config import Settings, get_settings

# Shown in the browser rather than downloaded. Anything else (HTML, SVG, ...) is
# always an attachment, so an uploaded file can never run script in the app's origin.
INLINE_TYPES = frozenset(
    {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}
)
_MIME = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")


def clean_content_type(value: str | None) -> str:
    v = (value or "").split(";")[0].strip().lower()
    return v if _MIME.match(v) else "application/octet-stream"


def can_inline(content_type: str) -> bool:
    return content_type in INLINE_TYPES


def content_disposition(filename: str, inline: bool) -> str:
    """RFC 6266: an ASCII fallback plus the exact UTF-8 name."""
    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', "_", filename).strip() or "download"
    kind = "inline" if inline else "attachment"
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(filename, safe='')}"


def object_key(family_id: uuid.UUID, version_id: uuid.UUID) -> str:
    return f"families/{family_id}/docs/{version_id}"


@dataclass
class UploadTarget:
    url: str
    # Headers the browser must send with the PUT (S3 signs the content type).
    headers: dict[str, str] = field(default_factory=dict)


class Storage(Protocol):
    kind: str

    def upload_target(self, version_id: uuid.UUID, key: str, content_type: str) -> UploadTarget: ...

    def download_url(self, version_id: uuid.UUID, key: str, filename: str, content_type: str, inline: bool) -> str: ...

    async def stored_size(self, key: str) -> int | None:
        """Size of the stored object, or None if nothing was uploaded."""
        ...

    async def delete(self, keys: list[str]) -> None: ...


class FileTooLarge(Exception):
    pass


class LocalStorage:
    """Files under one folder; the API streams them in and out (routes in routers/docs.py)."""

    kind = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise ValueError("Key escapes the storage folder.")
        return p

    def upload_target(self, version_id: uuid.UUID, key: str, content_type: str) -> UploadTarget:
        return UploadTarget(url=f"/api/docs/uploads/{version_id}/content", headers={"Content-Type": content_type})

    def download_url(self, version_id: uuid.UUID, key: str, filename: str, content_type: str, inline: bool) -> str:
        return f"/api/docs/files/{version_id}" + ("?inline=true" if inline else "")

    async def write(self, key: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
        """Store the request body, stopping as soon as it passes `max_bytes`."""
        dest = self.path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        size = 0
        try:
            with part.open("wb") as f:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > max_bytes:
                        raise FileTooLarge
                    f.write(chunk)
            part.replace(dest)
        finally:
            part.unlink(missing_ok=True)
        return size

    async def stored_size(self, key: str) -> int | None:
        p = self.path(key)
        return p.stat().st_size if p.is_file() else None

    async def delete(self, keys: list[str]) -> None:
        for key in keys:
            self.path(key).unlink(missing_ok=True)


class S3Storage:
    """Presigned URLs, so file bytes go between the browser and S3 without passing through the API."""

    kind = "s3"

    def __init__(self, bucket: str, region: str | None, link_seconds: int, client=None, profile: str | None = None) -> None:
        self.bucket = bucket
        self.link_seconds = link_seconds
        if client is None:
            import boto3
            from botocore.config import Config

            session = boto3.Session(profile_name=profile, region_name=region)
            # Regional, virtual-hosted URLs: a global endpoint would redirect, and redirects break CORS.
            client = session.client(
                "s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
            )
        self.client = client

    def upload_target(self, version_id: uuid.UUID, key: str, content_type: str) -> UploadTarget:
        url = self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=self.link_seconds,
        )
        return UploadTarget(url=url, headers={"Content-Type": content_type})

    def download_url(self, version_id: uuid.UUID, key: str, filename: str, content_type: str, inline: bool) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentDisposition": content_disposition(filename, inline),
                "ResponseContentType": content_type if inline else "application/octet-stream",
            },
            ExpiresIn=self.link_seconds,
        )

    async def stored_size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            head = await run_in_threadpool(self.client.head_object, Bucket=self.bucket, Key=key)
        except ClientError as e:
            # Without bucket-wide ListBucket (the app role only lists families/*), S3 answers
            # a missing key with 403 rather than 404.
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "403"):
                return None
            raise
        return int(head["ContentLength"])

    async def delete(self, keys: list[str]) -> None:
        for i in range(0, len(keys), 1000):
            batch = [{"Key": k} for k in keys[i : i + 1000]]
            await run_in_threadpool(
                self.client.delete_objects, Bucket=self.bucket, Delete={"Objects": batch, "Quiet": True}
            )


def build_storage(settings: Settings) -> Storage:
    if settings.docs_storage == "s3":
        if not settings.docs_s3_bucket:
            raise RuntimeError("DOCS_S3_BUCKET must be set when DOCS_STORAGE=s3.")
        return S3Storage(
            settings.docs_s3_bucket, settings.docs_s3_region, settings.docs_link_seconds, profile=settings.docs_s3_profile
        )
    return LocalStorage(Path(settings.docs_local_dir))


@lru_cache
def get_storage() -> Storage:
    """FastAPI dependency. Tests override it with a LocalStorage in a temp folder."""
    return build_storage(get_settings())
