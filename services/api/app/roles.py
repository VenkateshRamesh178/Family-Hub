"""Server-side mirror of packages/core/src/roles.ts. Keep the two in sync.

The API is where permissions are actually enforced; the TypeScript `can()` only
decides what the UI shows.
"""

from typing import Literal

FOLDER_KEYS = ("meta", "lists", "docs", "chat", "audit", "snapshots")

Access = Literal["reader", "writer"]
Resource = Literal["family", "members", "roles", "lists", "calendar", "docs", "chat"]
Action = Literal["read", "write"]

ADMIN_ROLE_ID = "admin"
EDITOR_ROLE_ID = "editor"
READER_ROLE_ID = "reader"


def _role(id: str, name: str, description: str, writable: set[str]) -> dict:
    return {
        "id": id,
        "name": name,
        "builtIn": True,
        "description": description,
        "folders": {k: ("writer" if k in writable else "reader") for k in FOLDER_KEYS},
    }


ADMIN_ROLE = _role(ADMIN_ROLE_ID, "Admin", "Created the family. Full access.", set(FOLDER_KEYS))
EDITOR_ROLE = _role(
    EDITOR_ROLE_ID,
    "Editor",
    "Can read and change shared data.",
    {"lists", "docs", "chat", "audit", "snapshots"},
)
READER_ROLE = _role(READER_ROLE_ID, "Reader", "Read-only, but can chat.", {"chat", "audit"})

BUILT_IN_ROLES = {r["id"]: r for r in (ADMIN_ROLE, EDITOR_ROLE, READER_ROLE)}

# The calendar is family planning data, like the lists, so it shares their permission.
_RESOURCE_FOLDER: dict[str, str] = {"lists": "lists", "calendar": "lists", "docs": "docs", "chat": "chat"}


def can(folders: dict[str, str], role_id: str, resource: Resource, action: Action) -> bool:
    if role_id == ADMIN_ROLE_ID:
        return True
    if action == "read":
        return True
    folder = _RESOURCE_FOLDER.get(resource)
    # family / members / roles are admin-only to change.
    if folder is None:
        return False
    return folders.get(folder) == "writer"
