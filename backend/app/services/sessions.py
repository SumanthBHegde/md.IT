"""Server-side sessions (P-059): the cookie holds a random token, MySQL its SHA-256."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import LoginSession, User


def utcnow() -> datetime:
    """Naive UTC, the way MySQL stores DATETIME(6) here (P-049)."""
    return datetime.now(UTC).replace(tzinfo=None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User, days: int) -> str:
    """Start a session for `user` and return the raw token for the cookie."""
    now = utcnow()
    db.execute(
        delete(LoginSession).where(LoginSession.user_id == user.id, LoginSession.expires_at <= now)
    )
    token = secrets.token_urlsafe(32)
    db.add(
        LoginSession(
            user_id=user.id, token_hash=hash_token(token), expires_at=now + timedelta(days=days)
        )
    )
    db.commit()
    return token


def user_for_token(db: Session, token: str) -> User | None:
    """The signed-in user, or None for an unknown or expired token (expired rows are removed)."""
    row = db.scalars(
        select(LoginSession).where(LoginSession.token_hash == hash_token(token))
    ).one_or_none()
    if row is None:
        return None
    if row.expires_at <= utcnow():
        db.delete(row)
        db.commit()
        return None
    return db.get(User, row.user_id)


def end_session(db: Session, token: str) -> None:
    db.execute(delete(LoginSession).where(LoginSession.token_hash == hash_token(token)))
    db.commit()
