"""SQLAlchemy ORM models for the production data layer.

These models cover the slices we actually persist to Postgres today:
* ``InferenceCallRecord`` — audit + cost tracking for every LLM call.
* ``AuditLogRecord``      — security / PDPA audit trail of mutating actions.

Skill metadata and agent snapshots remain in their respective SQLite stores
for now; they can be migrated to Postgres tables later without changing the
public API.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from nexus_agent.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return uuid.uuid4().hex


class InferenceCallRecord(Base):
    __tablename__ = "inference_calls"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    principal: Mapped[str] = mapped_column(String(64), default="anonymous")
    provider: Mapped[str] = mapped_column(String(64), index=True)
    model: Mapped[str] = mapped_column(String(128), index=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="ok", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditLogRecord(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    principal: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(128), index=True)
    target: Mapped[str] = mapped_column(String(255))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
