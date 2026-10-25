"""Server tables from PRD section 9.2 (P-044, P-049)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.mysql import CHAR, DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TABLE_ARGS, Base


def new_public_id() -> str:
    """Random, not sequential; lowercase, so MySQL's case-insensitive collation is safe."""
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id"),
        CheckConstraint("provider IN ('github', 'google', 'dev')", name="provider"),
        TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(CHAR(36), unique=True, default=new_public_id)
    provider: Mapped[str] = mapped_column(String(16))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (TABLE_ARGS,)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(CHAR(36), unique=True, default=new_public_id)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (TABLE_ARGS,)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(CHAR(36), unique=True, default=new_public_id)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("projects.id", ondelete="CASCADE")
    )
    # Not unique: a rename on another device must not fail a save.
    path: Mapped[str] = mapped_column(String(1024))
    # The next version's number; never decremented, so numbers aren't reused (P-062).
    next_number: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class Blob(Base):
    """Content-addressed bytes in Blob Storage; shared across users, so nothing cascades here."""

    __tablename__ = "blobs"
    __table_args__ = (TABLE_ARGS,)

    hash: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    size: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class Version(Base):
    __tablename__ = "versions"
    __table_args__ = (UniqueConstraint("document_id", "number"), TABLE_ARGS)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(CHAR(36), unique=True, default=new_public_id)
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("documents.id", ondelete="CASCADE")
    )
    # SET NULL: deleting a version never fails or cascades down the history.
    parent_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("versions.id", ondelete="SET NULL")
    )
    number: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(
        CHAR(64), ForeignKey("blobs.hash", ondelete="RESTRICT")
    )
    message: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class LoginSession(Base):
    """A signed-in browser (P-059). Named so it can't be confused with SQLAlchemy's Session."""

    __tablename__ = "sessions"
    __table_args__ = (TABLE_ARGS,)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # SHA-256 of the cookie token; the token itself is never stored.
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6))


class UserBlob(Base):
    """Which user may see which blob (P-061); blobs themselves are shared and deduplicated."""

    __tablename__ = "user_blobs"
    __table_args__ = (TABLE_ARGS,)

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    hash: Mapped[str] = mapped_column(
        CHAR(64), ForeignKey("blobs.hash", ondelete="RESTRICT"), primary_key=True, index=True
    )
    # Per owner: the same bytes can be one user's Markdown and another's SVG (P-074).
    content_type: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)")
    )


class VersionImage(Base):
    """An image a version's document uses, at its project-relative path (P-060).

    No unique key on (version_id, path): 1024 utf8mb4 characters exceed InnoDB's index limit,
    so the API rejects duplicate paths instead.
    """

    __tablename__ = "version_images"
    __table_args__ = (TABLE_ARGS,)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("versions.id", ondelete="CASCADE")
    )
    path: Mapped[str] = mapped_column(String(1024))
    hash: Mapped[str] = mapped_column(CHAR(64), ForeignKey("blobs.hash", ondelete="RESTRICT"))
