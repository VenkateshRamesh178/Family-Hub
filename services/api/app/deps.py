from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import AuthSession, CustomRole, Family, Membership, User
from .roles import ADMIN_ROLE_ID, BUILT_IN_ROLES, READER_ROLE, Action, Resource, can
from .security import hash_token

Db = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: Db) -> User:
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        session = await db.get(AuthSession, hash_token(token))
        if session and session.expires_at > datetime.now(UTC):
            return session.user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")


CurrentUser = Annotated[User, Depends(current_user)]


async def resolve_role(db: AsyncSession, family_id, role_id: str) -> dict:
    if role_id in BUILT_IN_ROLES:
        return BUILT_IN_ROLES[role_id]
    custom = await db.get(CustomRole, (family_id, role_id))
    if custom is None:
        # Shouldn't happen (roles in use can't be deleted), but fail closed.
        return READER_ROLE
    return {
        "id": custom.id,
        "name": custom.name,
        "builtIn": False,
        "description": custom.description,
        "folders": custom.folders,
    }


@dataclass
class Member:
    """The signed-in user, in the context of their family."""

    user: User
    membership: Membership
    role: dict

    @property
    def family(self) -> Family:
        return self.membership.family

    @property
    def is_admin(self) -> bool:
        return self.membership.role_id == ADMIN_ROLE_ID

    def can(self, resource: Resource, action: Action) -> bool:
        return can(self.role["folders"], self.membership.role_id, resource, action)


async def find_membership(db: AsyncSession, user: User) -> Membership | None:
    return await db.scalar(select(Membership).where(Membership.user_id == user.id))


async def current_member(user: CurrentUser, db: Db) -> Member:
    membership = await find_membership(db, user)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in a family yet.")
    role = await resolve_role(db, membership.family_id, membership.role_id)
    return Member(user=user, membership=membership, role=role)


CurrentMember = Annotated[Member, Depends(current_member)]


def require(resource: Resource, action: Action):
    """Dependency factory: the signed-in member must be allowed `action` on `resource`."""

    async def check(member: CurrentMember) -> Member:
        if not member.can(resource, action):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this.")
        return member

    return check


AdminMember = Annotated[Member, Depends(require("members", "write"))]
