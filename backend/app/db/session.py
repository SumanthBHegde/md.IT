"""Database engine and per-request sessions."""

from collections.abc import Iterator
from typing import Any

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.config import DatabaseSettings, database_url


def create_db_engine(settings: DatabaseSettings, *, io_timeout: int = 30, **pool: Any) -> Engine:
    """Lazy: nothing connects until first use. Stored times are UTC (P-049).

    `io_timeout` bounds every read and write, so a database that accepts connections but
    never answers can't block a request (or a health check) forever.
    """
    return create_engine(
        database_url(settings),
        pool_pre_ping=True,
        pool_recycle=3600,
        connect_args={
            "connect_timeout": 2,
            "read_timeout": io_timeout,
            "write_timeout": io_timeout,
            "init_command": "SET time_zone = '+00:00'",
        },
        **pool,
    )


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency: one session per request, closed afterwards."""
    with Session(request.app.state.engine) as session:
        yield session
