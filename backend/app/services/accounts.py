"""Accounts: the user behind a sign-in, and deleting everything they stored (spec 5a 7.4)."""

import logging

from azure.core.exceptions import AzureError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Blob, User, UserBlob
from app.services.oauth import Identity
from app.storage.blobs import BlobStore

__all__ = ["Identity", "delete_account", "sweep_blob", "upsert_user"]

log = logging.getLogger(__name__)


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


def sweep_blob(db: Session, store: BlobStore, hash: str) -> bool:
    """Remove a blob nobody owns any more; True when it was removed.

    The row is locked first, so a concurrent upload of the same bytes waits, then fails its
    ownership foreign key and stores the object afresh (spec 6.5 step 6).
    """
    try:
        if db.scalar(select(Blob.hash).where(Blob.hash == hash).with_for_update()) is None:
            return False
        owned = db.scalar(
            select(UserBlob.user_id).where(UserBlob.hash == hash).limit(1).with_for_update()
        )
        if owned is not None:
            return False
        # The row first (InnoDB checks foreign keys now), the object only if that worked.
        db.execute(delete(Blob).where(Blob.hash == hash))
        try:
            store.delete(hash)
        except AzureError:
            log.warning("Could not delete blob %s; left for cleanup", hash)
            return False
        db.commit()
        return True
    except IntegrityError:
        log.warning("Blob %s is still referenced; left for cleanup", hash)
        return False
    finally:
        db.rollback()  # ends the transaction (and its locks) on every path that didn't commit


def delete_account(db: Session, store: BlobStore, user: User) -> None:
    """Delete the user (cascading sessions, projects, documents, versions, version images and
    ownership), then every blob of theirs that no one else owns (PRD 6.1)."""
    hashes = list(db.scalars(select(UserBlob.hash).where(UserBlob.user_id == user.id)))
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
    for hash in hashes:
        sweep_blob(db, store, hash)
