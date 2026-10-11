from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from ..config import get_settings
from ..deps import CurrentUser, Db
from ..models import AuthSession, User
from ..schemas import IdentityOut, SignInIn, SignUpIn
from ..security import hash_password, hash_token, new_session_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


async def _start_session(db: Db, response: Response, user: User) -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    token, token_hash = new_session_token()
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now))
    db.add(AuthSession(token_hash=token_hash, user_id=user.id, expires_at=now + timedelta(days=settings.session_days)))
    await db.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/signup", response_model=IdentityOut, status_code=status.HTTP_201_CREATED)
async def sign_up(body: SignUpIn, db: Db, response: Response) -> User:
    if await db.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")
    user = User(email=body.email, display_name=body.display_name, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    await _start_session(db, response, user)
    return user


@router.post("/signin", response_model=IdentityOut)
async def sign_in(body: SignInIn, db: Db, response: Response) -> User:
    user = await db.scalar(select(User).where(User.email == body.email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    await _start_session(db, response, user)
    return user


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(request: Request, db: Db, response: Response) -> None:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        await db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        await db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me", response_model=IdentityOut)
async def me(user: CurrentUser) -> User:
    return user
