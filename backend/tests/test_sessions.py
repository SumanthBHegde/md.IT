"""Server-side sessions (P-059), on real MySQL."""

import hashlib
from datetime import timedelta

import pytest
from sqlalchemy import Engine, func, select, update
from sqlalchemy.orm import Session

from app.db.models import LoginSession, User
from app.services.accounts import Identity, upsert_user
from app.services.sessions import (
    create_session,
    end_session,
    hash_token,
    user_for_token,
    utcnow,
)

pytestmark = pytest.mark.integration


def make_user(db: Session, name: str = "alice") -> User:
    return upsert_user(db, Identity("dev", name, None))


def expire_all(db: Session) -> None:
    db.execute(update(LoginSession).values(expires_at=utcnow() - timedelta(seconds=1)))
    db.commit()


def session_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(LoginSession)) or 0


def test_token_is_stored_hashed(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        token = create_session(db, make_user(db), days=30)
        row = db.scalars(select(LoginSession)).one()
        assert row.token_hash == hashlib.sha256(token.encode()).hexdigest() == hash_token(token)
        assert token not in row.token_hash
        assert len(token) >= 43  # 32 random bytes, base64url


def test_session_expires_after_the_given_days(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        create_session(db, make_user(db), days=7)
        row = db.scalars(select(LoginSession)).one()
        assert abs(row.expires_at - (utcnow() + timedelta(days=7))) < timedelta(minutes=1)


def test_user_for_token_finds_the_user(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        user = make_user(db)
        token = create_session(db, user, days=30)
        found = user_for_token(db, token)
        assert found is not None and found.id == user.id


def test_unknown_token_gives_none(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        assert user_for_token(db, "not-a-token") is None


def test_expired_session_is_rejected_and_deleted(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        token = create_session(db, make_user(db), days=30)
        expire_all(db)
        assert user_for_token(db, token) is None
        assert session_count(db) == 0


def test_new_login_removes_expired_sessions(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        user = make_user(db)
        create_session(db, user, days=30)
        expire_all(db)
        fresh = create_session(db, user, days=30)
        assert session_count(db) == 1
        assert user_for_token(db, fresh) is not None


def test_end_session_removes_only_that_session(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        user = make_user(db)
        first = create_session(db, user, days=30)
        second = create_session(db, user, days=30)
        end_session(db, first)
        assert user_for_token(db, first) is None
        assert user_for_token(db, second) is not None


def test_upsert_user_reuses_and_updates_email(clean_db: Engine) -> None:
    with Session(clean_db) as db:
        first = upsert_user(db, Identity("github", "42", "old@example.com"))
        again = upsert_user(db, Identity("github", "42", "new@example.com"))
        assert again.id == first.id
        assert again.email == "new@example.com"
        assert db.scalar(select(func.count()).select_from(User)) == 1
