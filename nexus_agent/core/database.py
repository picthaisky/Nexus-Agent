"""SQLAlchemy engine and session factory.

Provides a single ``engine`` and ``SessionLocal`` plus FastAPI dependency
``get_db`` for transactional request scope.  Designed for Postgres in
production but transparently falls back to SQLite when ``DATABASE_URL`` is
empty (useful for unit tests).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from nexus_agent.core.settings import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _build_engine() -> Engine:
    settings = get_settings()
    url = settings.database_url or "sqlite:///./nexus_local.db"
    connect_args = {}
    engine_kwargs = {
        "pool_pre_ping": True,
        "echo": False,
    }
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    else:
        engine_kwargs.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_recycle=1800,
        )
    logger.info("database_engine_created", extra={"dialect": url.split(":", 1)[0]})
    return create_engine(url, connect_args=connect_args, **engine_kwargs)


engine: Engine = _build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a transactional session."""

    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Context-manager flavour for background workers / scripts."""

    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
