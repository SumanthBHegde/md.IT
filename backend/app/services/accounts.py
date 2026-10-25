"""Accounts: finding or creating the user behind a sign-in."""

from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import User


class Identity(NamedTuple):
    provider: str  # "github" | "google" | "dev"
    provider_user_id: str
    email: str | None


def _find(db: Session, identity: Identity) -> User | None:
    return db.scalars(
        select(User).where(
            User.provider == identity.provider,
            User.provider_user_id == identity.provider_user_id,
        )
    ).one_or_none()


def upsert_user(db: Session, identity: Identity) -> User:
    """The user for this identity, created on first sign-in; the email follows the provider."""
    user = _find(db, identity)
    if user is None:
        user = User(
            provider=identity.provider,
            provider_user_id=identity.provider_user_id,
            email=identity.email,
        )
        db.add(user)
        try:
            db.commit()
            return user
        except IntegrityError:
            # Two first sign-ins at once: the other one created the row.
            db.rollback()
            user = _find(db, identity)
            if user is None:
                raise
    if user.email != identity.email:
        user.email = identity.email
        db.commit()
    return user
