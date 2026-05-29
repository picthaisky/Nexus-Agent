"""PDPA-friendly audit log helper.

Writes one row per mutating action to the ``audit_log`` table.  Never logs
request bodies — only the action verb, target identifier, principal hint, and
the request id so the entry can be cross-referenced with structured logs.
"""

from __future__ import annotations

import logging
from typing import Any

from nexus_agent.core.database import session_scope
from nexus_agent.core.db_models import AuditLogRecord

logger = logging.getLogger(__name__)


def record_audit(
    *,
    action: str,
    target: str,
    principal: str = "anonymous",
    request_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    """Persist an audit entry; swallows storage errors to avoid breaking the request."""

    try:
        with session_scope() as db:
            db.add(
                AuditLogRecord(
                    action=action,
                    target=target[:255],
                    principal=principal[:64],
                    request_id=request_id[:64],
                    metadata_=metadata or {},
                )
            )
    except Exception as exc:  # pragma: no cover — best-effort
        logger.warning("audit_write_failed", extra={"error": str(exc), "action": action})
