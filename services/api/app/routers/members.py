from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..deps import AdminMember, CurrentMember, Db
from ..models import CustomRole, Invite, Membership, User
from ..roles import ADMIN_ROLE_ID, BUILT_IN_ROLES, EDITOR_ROLE, READER_ROLE
from ..schemas import ChangeRoleIn, InviteIn, MemberOut, RoleIn, RoleOut

router = APIRouter(tags=["members"])


def _member_out(m: Membership) -> MemberOut:
    return MemberOut(
        email=m.user.email,
        display_name=m.user.display_name,
        role_id=m.role_id,
        status="active",
        invited_at=m.invited_at,
        invited_by=m.invited_by,
    )


def _invite_out(i: Invite) -> MemberOut:
    return MemberOut(email=i.email, role_id=i.role_id, status="invited", invited_at=i.created_at, invited_by=i.invited_by)


async def _check_assignable(db: Db, family_id, role_id: str) -> None:
    if role_id == ADMIN_ROLE_ID:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "There is only one admin: the family's creator.")
    if role_id not in BUILT_IN_ROLES and await db.get(CustomRole, (family_id, role_id)) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'Role "{role_id}" does not exist.')


async def _lookup(db: Db, family_id, email: str) -> Membership | Invite | None:
    membership = await db.scalar(
        select(Membership).join(User, Membership.user_id == User.id).where(
            Membership.family_id == family_id, User.email == email.lower()
        )
    )
    if membership:
        return membership
    invite = await db.scalar(select(Invite).where(Invite.family_id == family_id, Invite.email == email.lower()))
    return invite


async def _find(db: Db, family_id, email: str) -> Membership | Invite:
    target = await _lookup(db, family_id, email)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{email} is not a member of this family.")
    return target


# --- Members ---------------------------------------------------------------------


@router.get("/members", response_model=list[MemberOut])
async def list_members(member: CurrentMember, db: Db) -> list[MemberOut]:
    """Everyone in the family, admin included (to-dos need it for assignees)."""
    fid = member.family.id
    memberships = (await db.scalars(select(Membership).where(Membership.family_id == fid).order_by(Membership.joined_at))).all()
    invites = (await db.scalars(select(Invite).where(Invite.family_id == fid).order_by(Invite.created_at))).all()
    return [*map(_member_out, memberships), *map(_invite_out, invites)]


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def invite_member(body: InviteIn, admin: AdminMember, db: Db) -> MemberOut:
    fid = admin.family.id
    await _check_assignable(db, fid, body.role_id)
    existing = await _lookup(db, fid, body.email)
    if existing is not None:
        verb = "already a member" if isinstance(existing, Membership) else "already invited"
        raise HTTPException(status.HTTP_409_CONFLICT, f"{body.email} is {verb}.")
    invite = Invite(family_id=fid, email=body.email, role_id=body.role_id, invited_by=admin.user.email)
    db.add(invite)
    await db.commit()
    return _invite_out(invite)


@router.patch("/members/{email}", response_model=MemberOut)
async def change_member_role(email: str, body: ChangeRoleIn, admin: AdminMember, db: Db) -> MemberOut:
    target = await _find(db, admin.family.id, email)
    if target.role_id == ADMIN_ROLE_ID:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The admin's role can't be changed.")
    await _check_assignable(db, admin.family.id, body.role_id)
    target.role_id = body.role_id
    await db.commit()
    return _member_out(target) if isinstance(target, Membership) else _invite_out(target)


@router.delete("/members/{email}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(email: str, admin: AdminMember, db: Db) -> None:
    target = await _find(db, admin.family.id, email)
    if target.role_id == ADMIN_ROLE_ID:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The admin can't be removed.")
    await db.delete(target)
    await db.commit()


# --- Roles -------------------------------------------------------------------------


def _role_out(r: CustomRole) -> RoleOut:
    return RoleOut(id=r.id, name=r.name, built_in=False, description=r.description, folders=r.folders)


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(member: CurrentMember, db: Db) -> list:
    """Assignable roles: the built-ins except admin, then this family's custom roles."""
    custom = (await db.scalars(select(CustomRole).where(CustomRole.family_id == member.family.id).order_by(CustomRole.name))).all()
    return [EDITOR_ROLE, READER_ROLE, *map(_role_out, custom)]


@router.put("/roles/{role_id}", response_model=RoleOut)
async def save_custom_role(role_id: str, body: RoleIn, admin: AdminMember, db: Db) -> RoleOut:
    if role_id != body.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Role id in the URL and body don't match.")
    role = await db.get(CustomRole, (admin.family.id, role_id))
    if role is None:
        role = CustomRole(family_id=admin.family.id, id=role_id)
        db.add(role)
    role.name = body.name
    role.description = body.description
    role.folders = body.folders
    await db.commit()
    return _role_out(role)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_role(role_id: str, admin: AdminMember, db: Db) -> None:
    fid = admin.family.id
    role = await db.get(CustomRole, (fid, role_id))
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f'Role "{role_id}" does not exist.')
    in_use = (
        await db.scalar(select(func.count()).where(Membership.family_id == fid, Membership.role_id == role_id))
        or 0
    ) + (await db.scalar(select(func.count()).where(Invite.family_id == fid, Invite.role_id == role_id)) or 0)
    if in_use:
        raise HTTPException(status.HTTP_409_CONFLICT, f'Role "{role.name}" is still assigned to {in_use} member(s).')
    await db.delete(role)
    await db.commit()
