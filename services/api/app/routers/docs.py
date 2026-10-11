"""Shared documents: folders, file uploads with version history, a trash, and an audit log.

Every member can read and download; changing anything needs `docs:write`.

File bytes never go through the JSON routes. Uploading is three steps:
  1. POST /docs/uploads          -> an upload id plus a URL to PUT the bytes to
  2. PUT <url>                   -> S3 (presigned) or /docs/uploads/{id}/content (local storage)
  3. POST /docs                  -> creates the document (or POST /docs/{id}/versions to replace its file)
Step 3 checks the stored size, so a document never points at a missing or partial file.
"""

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import PureWindowsPath
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..deps import Db, Member, require
from ..models import DocAuditEvent, DocFolder, Document, DocumentVersion, PurchasedItem, utcnow
from ..schemas import (
    DocAuditEventOut,
    DocFolderIn,
    DocFolderOut,
    DocFolderPatch,
    DocumentCreateIn,
    DocumentFileOut,
    DocumentIn,
    DocumentOut,
    DocumentPatch,
    DownloadOut,
    ReplaceFileIn,
    UploadIn,
    UploadTicketOut,
)
from ..storage import (
    FileTooLarge,
    LocalStorage,
    Storage,
    can_inline,
    clean_content_type,
    content_disposition,
    get_storage,
    object_key,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/docs", tags=["docs"])

Reader = Annotated[Member, Depends(require("docs", "read"))]
Writer = Annotated[Member, Depends(require("docs", "write"))]
Store = Annotated[Storage, Depends(get_storage)]

# Uploads not turned into a document within this time are discarded.
PENDING_TTL = timedelta(days=1)
AUDIT_LIMIT = 200

_FIELD_NAMES = {
    "title": "title",
    "notes": "notes",
    "folder_id": "folder",
    "expiry_date": "expiry date",
    "purchase_id": "linked purchase",
}


def _not_found(what: str = "Document") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")


def _unprocessable(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, msg)


def _clean_filename(name: str) -> str:
    # Browsers send a bare name, but strip any path (either separator) and control characters anyway.
    base = PureWindowsPath(name.replace("/", "\\")).name
    return re.sub(r"[\x00-\x1f\x7f]", "", base).strip()[:255] or "file"


def _audit(db: AsyncSession, member: Member, doc: Document, action: str, detail: str = "", keep_link: bool = True) -> None:
    db.add(
        DocAuditEvent(
            family_id=member.family.id,
            document_id=doc.id if keep_link else None,
            document_title=doc.title,
            action=action,
            actor_email=member.user.email,
            detail=detail[:300],
        )
    )


async def _get_folder(db: AsyncSession, member: Member, folder_id: uuid.UUID) -> DocFolder | None:
    folder = await db.get(DocFolder, folder_id)
    return folder if folder is not None and folder.family_id == member.family.id else None


async def _get_doc(db: AsyncSession, member: Member, doc_id: uuid.UUID, trashed: bool | None = False) -> Document:
    """`trashed`: False = must not be in the trash, True = must be, None = either."""
    doc = await db.get(Document, doc_id)
    if doc is None or doc.family_id != member.family.id:
        raise _not_found()
    if trashed is not None and (doc.deleted_at is not None) != trashed:
        msg = "That document isn't in the trash." if trashed else "That document is in the trash. Restore it first."
        raise HTTPException(status.HTTP_409_CONFLICT, msg)
    return doc


async def _check_refs(db: AsyncSession, member: Member, folder_id: uuid.UUID | None, purchase_id: uuid.UUID | None) -> None:
    if folder_id is not None and await _get_folder(db, member, folder_id) is None:
        raise _unprocessable("That folder doesn't exist.")
    if purchase_id is not None:
        purchase = await db.get(PurchasedItem, purchase_id)
        if purchase is None or purchase.family_id != member.family.id:
            raise _unprocessable("That purchase doesn't exist.")


async def _pending_upload(db: AsyncSession, member: Member, upload_id: uuid.UUID) -> DocumentVersion:
    v = await db.get(DocumentVersion, upload_id)
    if (
        v is None
        or v.family_id != member.family.id
        or not v.pending
        or v.uploaded_by_id != member.user.id
        or v.uploaded_at < datetime.now(UTC) - PENDING_TTL
    ):
        raise _not_found("Upload")
    return v


async def _take_upload(db: AsyncSession, member: Member, storage: Storage, upload_id: uuid.UUID) -> DocumentVersion:
    """A finished upload, checked against what was declared. The caller attaches it to a document."""
    v = await _pending_upload(db, member, upload_id)
    size = await storage.stored_size(v.storage_key)
    if size is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The file hasn't finished uploading. Please try again.")
    if size != v.size or size > get_settings().docs_max_upload_bytes:
        await storage.delete([v.storage_key])
        raise _unprocessable("The upload was incomplete or changed size. Please upload the file again.")
    return v


async def _forget_stale_uploads(db: AsyncSession, storage: Storage, family_id: uuid.UUID) -> None:
    stale = (
        await db.scalars(
            select(DocumentVersion).where(
                DocumentVersion.family_id == family_id,
                DocumentVersion.pending.is_(True),
                DocumentVersion.uploaded_at < datetime.now(UTC) - PENDING_TTL,
            )
        )
    ).all()
    if not stale:
        return
    try:
        await storage.delete([v.storage_key for v in stale])
    except Exception:  # Best effort: the rows go anyway, and S3 versioning expires leftovers.
        log.exception("Couldn't delete stale uploads")
    await db.execute(delete(DocumentVersion).where(DocumentVersion.id.in_([v.id for v in stale])))


# --- Folders ------------------------------------------------------------------------


async def _check_folder(db: AsyncSession, member: Member, data: DocFolderIn, folder_id: uuid.UUID | None = None) -> None:
    if data.parent_id is not None:
        node = await _get_folder(db, member, data.parent_id)
        if node is None:
            raise _unprocessable("That folder doesn't exist.")
        # Walk up from the new parent: meeting the folder itself would make a loop.
        while node is not None:
            if node.id == folder_id:
                raise _unprocessable("A folder can't go inside itself.")
            node = await db.get(DocFolder, node.parent_id) if node.parent_id else None
    clash = select(DocFolder.id).where(
        DocFolder.family_id == member.family.id,
        DocFolder.parent_id.is_not_distinct_from(data.parent_id),
        func.lower(DocFolder.name) == data.name.lower(),
    )
    if folder_id is not None:
        clash = clash.where(DocFolder.id != folder_id)
    if await db.scalar(clash):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There\'s already a folder called "{data.name}" here.')


@router.get("/folders", response_model=list[DocFolderOut])
async def list_folders(member: Reader, db: Db):
    return (
        await db.scalars(
            select(DocFolder).where(DocFolder.family_id == member.family.id).order_by(func.lower(DocFolder.name))
        )
    ).all()


@router.post("/folders", response_model=DocFolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(body: DocFolderIn, member: Writer, db: Db):
    await _check_folder(db, member, body)
    folder = DocFolder(
        **body.model_dump(by_alias=False), family_id=member.family.id, created_by_id=member.user.id, created_by=member.user
    )
    db.add(folder)
    await db.commit()
    return folder


@router.patch("/folders/{folder_id}", response_model=DocFolderOut)
async def update_folder(folder_id: uuid.UUID, body: DocFolderPatch, member: Writer, db: Db):
    folder = await _get_folder(db, member, folder_id)
    if folder is None:
        raise _not_found("Folder")
    current = DocFolderIn.model_validate(folder, from_attributes=True).model_dump(by_alias=False)
    try:
        data = DocFolderIn.model_validate({**current, **body.model_dump(by_alias=False, exclude_unset=True)})
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False)) from e
    await _check_folder(db, member, data, folder_id)
    folder.name, folder.parent_id = data.name, data.parent_id
    await db.commit()
    return folder


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, member: Writer, db: Db) -> None:
    folder = await _get_folder(db, member, folder_id)
    if folder is None:
        raise _not_found("Folder")
    has_subfolders = await db.scalar(select(DocFolder.id).where(DocFolder.parent_id == folder_id).limit(1))
    has_docs = await db.scalar(
        select(Document.id).where(Document.folder_id == folder_id, Document.deleted_at.is_(None)).limit(1)
    )
    if has_subfolders or has_docs:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only empty folders can be deleted. Move or delete what's inside first.")
    # Trashed documents in it move to the top level (foreign key ON DELETE SET NULL).
    await db.delete(folder)
    await db.commit()


# --- Uploads ------------------------------------------------------------------------


@router.post("/uploads", response_model=UploadTicketOut, status_code=status.HTTP_201_CREATED)
async def create_upload(body: UploadIn, member: Writer, db: Db, storage: Store) -> UploadTicketOut:
    settings = get_settings()
    if body.size > settings.docs_max_upload_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"Files can be up to {settings.docs_max_upload_mb} MB.")
    await _forget_stale_uploads(db, storage, member.family.id)

    version_id = uuid.uuid4()
    content_type = clean_content_type(body.content_type)
    version = DocumentVersion(
        id=version_id,
        family_id=member.family.id,
        storage_key=object_key(member.family.id, version_id),
        filename=_clean_filename(body.filename),
        content_type=content_type,
        size=body.size,
        uploaded_by_id=member.user.id,
        uploaded_by=member.user,
    )
    db.add(version)
    await db.commit()
    target = storage.upload_target(version_id, version.storage_key, content_type)
    return UploadTicketOut(
        upload_id=version_id,
        url=target.url,
        headers=target.headers,
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.docs_link_seconds),
    )


@router.put("/uploads/{upload_id}/content", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def upload_content(upload_id: uuid.UUID, request: Request, member: Writer, db: Db, storage: Store) -> None:
    """Local storage only: receives the bytes that would otherwise go to S3."""
    if not isinstance(storage, LocalStorage):
        raise _not_found("Upload")
    version = await _pending_upload(db, member, upload_id)
    try:
        await storage.write(version.storage_key, request.stream(), max_bytes=version.size)
    except FileTooLarge:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The file is bigger than declared.") from None


# --- Downloads ----------------------------------------------------------------------


@router.get("/files/{version_id}", include_in_schema=False)
async def local_file(version_id: uuid.UUID, member: Reader, db: Db, storage: Store, inline: bool = False) -> FileResponse:
    """Local storage only: serves a stored file (S3 downloads use presigned URLs instead)."""
    v = await db.get(DocumentVersion, version_id)
    if not isinstance(storage, LocalStorage) or v is None or v.family_id != member.family.id or v.pending:
        raise _not_found("File")
    path = storage.path(v.storage_key)
    if not path.is_file():
        raise _not_found("File")
    inline = inline and can_inline(v.content_type)
    return FileResponse(
        path,
        media_type=v.content_type if inline else "application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(v.filename, inline),
            "X-Content-Type-Options": "nosniff",
            # Even if something slips through as inline, it can't run script in the app's origin.
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )


# --- Audit log ----------------------------------------------------------------------


@router.get("/audit", response_model=list[DocAuditEventOut])
async def audit_log(
    member: Reader,
    db: Db,
    document_id: Annotated[uuid.UUID | None, Query(alias="documentId")] = None,
):
    """The latest events, newest first: for one document, or the whole family."""
    q = select(DocAuditEvent).where(DocAuditEvent.family_id == member.family.id)
    if document_id is not None:
        q = q.where(DocAuditEvent.document_id == document_id)
    return (await db.scalars(q.order_by(DocAuditEvent.at.desc()).limit(AUDIT_LIMIT))).all()


# --- Documents ----------------------------------------------------------------------


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    member: Reader,
    db: Db,
    trash: bool = False,
    purchase_id: Annotated[uuid.UUID | None, Query(alias="purchaseId")] = None,
):
    q = select(Document).where(Document.family_id == member.family.id)
    if trash:
        q = q.where(Document.deleted_at.is_not(None)).order_by(Document.deleted_at.desc())
    else:
        q = q.where(Document.deleted_at.is_(None)).order_by(func.lower(Document.title), Document.created_at)
    if purchase_id is not None:
        q = q.where(Document.purchase_id == purchase_id)
    return (await db.scalars(q)).all()


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def create_document(body: DocumentCreateIn, member: Writer, db: Db, storage: Store):
    await _check_refs(db, member, body.folder_id, body.purchase_id)
    version = await _take_upload(db, member, storage, body.upload_id)

    stem = version.filename.rsplit(".", 1)[0] if "." in version.filename.lstrip(".") else version.filename
    doc = Document(
        id=uuid.uuid4(),
        family_id=member.family.id,
        created_by_id=member.user.id,
        created_by=member.user,
        title=(body.title or stem)[:200],
        notes=body.notes,
        folder_id=body.folder_id,
        expiry_date=body.expiry_date,
        purchase_id=body.purchase_id,
    )
    db.add(doc)
    await db.flush()  # The version can only point at the document once it exists.
    version.document_id = doc.id
    version.pending = False
    doc.current_version = version
    _audit(db, member, doc, "upload", version.filename)
    await db.commit()
    return doc


@router.patch("/{doc_id}", response_model=DocumentOut)
async def update_document(doc_id: uuid.UUID, body: DocumentPatch, member: Writer, db: Db):
    doc = await _get_doc(db, member, doc_id)
    current = DocumentIn.model_validate(doc, from_attributes=True).model_dump(by_alias=False)
    try:
        data = DocumentIn.model_validate({**current, **body.model_dump(by_alias=False, exclude_unset=True)})
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False)) from e
    await _check_refs(db, member, data.folder_id, data.purchase_id)

    changed = [k for k, v in data.model_dump(by_alias=False).items() if getattr(doc, k) != v]
    for key in changed:
        setattr(doc, key, getattr(data, key))
    if changed:
        _audit(db, member, doc, "update", "Changed " + ", ".join(_FIELD_NAMES[k] for k in changed))
    await db.commit()
    return doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(doc_id: uuid.UUID, member: Writer, db: Db, storage: Store, permanent: bool = False) -> None:
    """Moves the document to the trash, or with `permanent=true` deletes it and every version of its file."""
    if not permanent:
        doc = await _get_doc(db, member, doc_id)
        doc.deleted_at = utcnow()
        _audit(db, member, doc, "trash")
        await db.commit()
        return

    doc = await _get_doc(db, member, doc_id, trashed=None)
    keys = list(await db.scalars(select(DocumentVersion.storage_key).where(DocumentVersion.document_id == doc.id)))
    _audit(db, member, doc, "purge", f"{len(keys)} file version(s) deleted", keep_link=False)
    # Versions go with it (ON DELETE CASCADE); earlier audit events keep the title.
    await db.execute(delete(Document).where(Document.id == doc.id))
    await db.commit()
    try:
        await storage.delete(keys)
    except Exception:
        log.exception("Couldn't delete stored files for document %s", doc_id)


@router.post("/{doc_id}/restore", response_model=DocumentOut)
async def restore_document(doc_id: uuid.UUID, member: Writer, db: Db):
    """Takes a document out of the trash."""
    doc = await _get_doc(db, member, doc_id, trashed=True)
    doc.deleted_at = None
    _audit(db, member, doc, "restore")
    await db.commit()
    return doc


@router.get("/{doc_id}/versions", response_model=list[DocumentFileOut])
async def list_versions(doc_id: uuid.UUID, member: Reader, db: Db):
    """Every uploaded version of the file, newest first."""
    doc = await _get_doc(db, member, doc_id, trashed=None)
    return (
        await db.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == doc.id, DocumentVersion.pending.is_(False))
            .order_by(DocumentVersion.uploaded_at.desc())
        )
    ).all()


@router.post("/{doc_id}/versions", response_model=DocumentOut)
async def replace_file(doc_id: uuid.UUID, body: ReplaceFileIn, member: Writer, db: Db, storage: Store):
    """Uploads a new version of the file. Earlier versions are kept and can be restored."""
    doc = await _get_doc(db, member, doc_id)
    version = await _take_upload(db, member, storage, body.upload_id)
    version.document_id = doc.id
    version.pending = False
    doc.current_version = version
    doc.updated_at = utcnow()
    _audit(db, member, doc, "replace", version.filename)
    await db.commit()
    return doc


@router.post("/{doc_id}/versions/{version_id}/restore", response_model=DocumentOut)
async def restore_version(doc_id: uuid.UUID, version_id: uuid.UUID, member: Writer, db: Db):
    """Makes an earlier version the current one again. Nothing is deleted."""
    doc = await _get_doc(db, member, doc_id)
    version = await db.get(DocumentVersion, version_id)
    if version is None or version.document_id != doc.id or version.pending:
        raise _not_found("Version")
    if doc.current_version_id != version.id:
        doc.current_version = version
        doc.updated_at = utcnow()
        _audit(db, member, doc, "restore_version", f"{version.filename}, uploaded {version.uploaded_at:%Y-%m-%d %H:%M} UTC")
        await db.commit()
    return doc


@router.get("/{doc_id}/download", response_model=DownloadOut)
async def download(
    doc_id: uuid.UUID,
    member: Reader,
    db: Db,
    storage: Store,
    version_id: Annotated[uuid.UUID | None, Query(alias="versionId")] = None,
    inline: bool = False,
) -> DownloadOut:
    """A short-lived link to the file (the current version unless `versionId` is given).

    `inline=true` opens PDFs, images and plain text in the browser; everything else downloads.
    """
    doc = await _get_doc(db, member, doc_id, trashed=None)
    version = doc.current_version if version_id is None else await db.get(DocumentVersion, version_id)
    if version is None or version.document_id != doc.id or version.pending:
        raise _not_found("File")
    inline = inline and can_inline(version.content_type)
    url = storage.download_url(version.id, version.storage_key, version.filename, version.content_type, inline)
    earlier = "" if version.id == doc.current_version_id else " (earlier version)"
    _audit(db, member, doc, "download", f"{version.filename}{earlier}")
    await db.commit()
    return DownloadOut(url=url)
