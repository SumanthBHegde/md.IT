"""Who is signed in: the session cookie and the current_user dependency (P-059)."""

from typing import Annotated

from fastapi import Depends, Request, Response

from app.config import Settings
from app.db.models import User
from app.db.session import DbSession
from app.errors import ApiError
from app.services.sessions import user_for_token

SESSION_COOKIE = "mdit_session"
COOKIE_PATH = "/api"


def current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    user = user_for_token(db, token) if token else None
    if user is None:
        raise ApiError(401, "unauthenticated", "Sign in to continue.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        path=COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path=COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
