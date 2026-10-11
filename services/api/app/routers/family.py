from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, Db, find_membership, resolve_role
from ..models import Family, Invite, Membership, User
from ..roles import ADMIN_ROLE_ID
from ..schemas import CreateFamilyIn, JoinFamilyIn, PendingInviteOut, SessionOut

router = APIRouter(tags=["family"])


def session_out(user: User, membership: Membership, role: dict) -> SessionOut:
    family = membership.family
    return SessionOut.model_validate(
        {
            "family": {
                "family_id": family.id,
                "name": family.name,
                "owner_email": family.owner.email,
                "created_at": family.created_at,
            },
            "me": user,
            "role": role,
            "is_admin": membership.role_id == ADMIN_ROLE_ID,
        }
    )


async def _session_for(db: Db, user: User) -> SessionOut | None:
    membership = await find_membership(db, user)
    if membership is None:
        return None
    return session_out(user, membership, await resolve_role(db, membership.family_id, membership.role_id))


@router.get("/family", response_model=SessionOut | None)
async def get_family(user: CurrentUser, db: Db) -> SessionOut | None:
    return await _session_for(db, user)


@router.post("/family", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_family(body: CreateFamilyIn, user: CurrentUser, db: Db) -> SessionOut:
    if await find_membership(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "You are already in a family.")
    family = Family(name=body.name, owner_id=user.id, owner=user)
    db.add(family)
    await db.flush()
    db.add(
        Membership(
            family_id=family.id,
            user_id=user.id,
            role_id=ADMIN_ROLE_ID,
            invited_by=user.email,
            invited_at=datetime.now(UTC),
        )
    )
    await db.commit()
    session = await _session_for(db, user)
    assert session is not None
    return session


@router.get("/invites/mine", response_model=list[PendingInviteOut])
async def my_invites(user: CurrentUser, db: Db) -> list[PendingInviteOut]:
    invites = (await db.scalars(select(Invite).where(Invite.email == user.email).order_by(Invite.created_at))).all()
    out = []
    for inv in invites:
        role = await resolve_role(db, inv.family_id, inv.role_id)
        out.append(
            PendingInviteOut(code=inv.id, family_name=inv.family.name, invited_by=inv.invited_by, role_name=role["name"])
        )
    return out


@router.post("/family/join", response_model=SessionOut)
async def join_family(body: JoinFamilyIn, user: CurrentUser, db: Db) -> SessionOut:
    invite = await db.get(Invite, body.code)
    # Only the invited email may use the invite.
    if invite is None or invite.email != user.email:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite doesn't exist or isn't for your account.")
    if await find_membership(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "You are already in a family.")
    db.add(
        Membership(
            family_id=invite.family_id,
            user_id=user.id,
            role_id=invite.role_id,
            invited_by=invite.invited_by,
            invited_at=invite.created_at,
        )
    )
    await db.delete(invite)
    await db.commit()
    session = await _session_for(db, user)
    assert session is not None
    return session
