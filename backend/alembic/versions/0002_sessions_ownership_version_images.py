"""Sessions, blob ownership, version images and the version counter (Phase 5a).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_OPTIONS = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def created_at() -> sa.Column[mysql.DATETIME]:
    return sa.Column(
        "created_at",
        mysql.DATETIME(fsp=6),
        server_default=sa.text("CURRENT_TIMESTAMP(6)"),
        nullable=False,
    )


def upgrade() -> None:
    op.drop_constraint(op.f("ck_users_provider"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_provider"), "users", "provider IN ('github', 'google', 'dev')"
    )
    op.add_column(
        "documents",
        sa.Column("next_number", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("token_hash", mysql.CHAR(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        created_at(),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sessions_token_hash")),
        **TABLE_OPTIONS,
    )
    op.create_table(
        "user_blobs",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("hash", mysql.CHAR(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        created_at(),
        sa.ForeignKeyConstraint(
            ["hash"], ["blobs.hash"], name=op.f("fk_user_blobs_hash_blobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_blobs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "hash", name=op.f("pk_user_blobs")),
        **TABLE_OPTIONS,
    )
    op.create_index(op.f("ix_user_blobs_hash"), "user_blobs", ["hash"])
    op.create_table(
        "version_images",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("version_id", sa.BigInteger(), nullable=False),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("hash", mysql.CHAR(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["hash"],
            ["blobs.hash"],
            name=op.f("fk_version_images_hash_blobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["version_id"],
            ["versions.id"],
            name=op.f("fk_version_images_version_id_versions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_version_images")),
        **TABLE_OPTIONS,
    )


def downgrade() -> None:
    # 0001's CHECK can't hold `dev` users, so they (and, by cascade, their projects) go first;
    # otherwise the CHECK restore fails after the tables below are already dropped.
    op.execute("DELETE FROM users WHERE provider = 'dev'")
    op.drop_table("version_images")
    op.drop_table("user_blobs")
    op.drop_table("sessions")
    op.drop_column("documents", "next_number")
    op.drop_constraint(op.f("ck_users_provider"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_provider"), "users", "provider IN ('github', 'google')"
    )
