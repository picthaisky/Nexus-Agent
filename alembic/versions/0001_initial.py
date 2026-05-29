"""initial schema — inference_calls + audit_log

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-29 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inference_calls",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("request_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("principal", sa.String(length=64), nullable=False, server_default="anonymous"),
        sa.Column("provider", sa.String(length=64), nullable=False, index=True),
        sa.Column("model", sa.String(length=128), nullable=False, index=True),
        sa.Column("tokens_in", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tokens_out", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Float(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ok", index=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("request_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("principal", sa.String(length=64), nullable=False, index=True),
        sa.Column("action", sa.String(length=128), nullable=False, index=True),
        sa.Column("target", sa.String(length=255), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("inference_calls")
