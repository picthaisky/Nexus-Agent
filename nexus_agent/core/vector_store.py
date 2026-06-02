"""Vector Store backed by SQLite FTS5 (no external vector DB required).

Provides semantic-style full-text search for documents, code snippets, and
task results. Documents are split into chunks, stored in an FTS5 table, and
retrieved via ranked full-text queries.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DATA_DIR    = Path(os.environ.get("NEXUS_DATA_DIR", str(Path(__file__).resolve().parents[2])))
_DEFAULT_DB  = _DATA_DIR / "nexus_vector_store.db"
CHUNK_SIZE   = 800    # characters per chunk
CHUNK_OVERLAP = 200   # overlap between consecutive chunks


class VectorStore:
    """SQLite FTS5-backed document store with chunk-level retrieval."""

    def __init__(self, db_path: str | Path = _DEFAULT_DB) -> None:
        self.db_path = str(db_path)
        self._init_db()

    # ── Schema ────────────────────────────────────────────────────────────────

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS documents (
                    doc_id       TEXT PRIMARY KEY,
                    title        TEXT NOT NULL DEFAULT '',
                    source       TEXT NOT NULL DEFAULT '',
                    content_type TEXT NOT NULL DEFAULT 'text',
                    metadata     TEXT NOT NULL DEFAULT '{}',
                    created_at   TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    chunk_id  TEXT PRIMARY KEY,
                    doc_id    TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
                    chunk_idx INTEGER NOT NULL,
                    text      TEXT NOT NULL
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    text,
                    content='chunks',
                    content_rowid='rowid'
                );

                CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
                    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
                    INSERT INTO chunks_fts(chunks_fts, rowid, text)
                        VALUES ('delete', old.rowid, old.text);
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
                    INSERT INTO chunks_fts(chunks_fts, rowid, text)
                        VALUES ('delete', old.rowid, old.text);
                    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
                END;
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── Chunking ──────────────────────────────────────────────────────────────

    @staticmethod
    def _chunk_text(text: str) -> List[str]:
        """Split text into overlapping chunks."""
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + CHUNK_SIZE
            chunks.append(text[start:end])
            start += CHUNK_SIZE - CHUNK_OVERLAP
        return [c.strip() for c in chunks if c.strip()]

    # ── Write ─────────────────────────────────────────────────────────────────

    def add_document(
        self,
        doc_id: str,
        text: str,
        title: str = "",
        source: str = "",
        content_type: str = "text",
        metadata: dict | None = None,
    ) -> int:
        """Index a document. Returns the number of chunks created."""
        now = datetime.now(timezone.utc).isoformat()
        chunks = self._chunk_text(text)

        with self._conn() as conn:
            conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
            conn.execute(
                "INSERT INTO documents (doc_id,title,source,content_type,metadata,created_at)"
                " VALUES (?,?,?,?,?,?)"
                " ON CONFLICT(doc_id) DO UPDATE SET title=excluded.title,"
                "  source=excluded.source, content_type=excluded.content_type,"
                "  metadata=excluded.metadata",
                (doc_id, title, source, content_type, json.dumps(metadata or {}), now),
            )
            for idx, chunk_text in enumerate(chunks):
                chunk_id = hashlib.sha1(f"{doc_id}:{idx}".encode()).hexdigest()
                conn.execute(
                    "INSERT OR REPLACE INTO chunks (chunk_id,doc_id,chunk_idx,text)"
                    " VALUES (?,?,?,?)",
                    (chunk_id, doc_id, idx, chunk_text),
                )
        return len(chunks)

    def delete_document(self, doc_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
        return r.rowcount > 0

    # ── Search ────────────────────────────────────────────────────────────────

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Full-text search returning ranked chunks with document metadata."""
        if not query.strip():
            return []

        # Clean query for FTS5 (remove special chars that break FTS syntax)
        safe_query = re.sub(r'["\'\(\)\[\]\*\+\-]', ' ', query).strip()
        if not safe_query:
            return []

        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT c.chunk_id, c.doc_id, c.chunk_idx, c.text,
                              d.title, d.source, d.content_type, d.metadata,
                              bm25(chunks_fts) AS score
                       FROM chunks_fts
                       JOIN chunks c ON chunks_fts.rowid = c.rowid
                       JOIN documents d ON c.doc_id = d.doc_id
                       WHERE chunks_fts MATCH ?
                       ORDER BY score
                       LIMIT ?""",
                    (safe_query, top_k),
                ).fetchall()
        except sqlite3.OperationalError as exc:
            logger.warning("FTS search failed for query %r: %s", query, exc)
            return []

        results = []
        for row in rows:
            try:
                meta = json.loads(row["metadata"] or "{}")
            except Exception:
                meta = {}
            results.append({
                "chunk_id":    row["chunk_id"],
                "doc_id":      row["doc_id"],
                "chunk_idx":   row["chunk_idx"],
                "text":        row["text"],
                "title":       row["title"],
                "source":      row["source"],
                "content_type":row["content_type"],
                "metadata":    meta,
                "score":       float(row["score"]),
            })
        return results

    # ── List ──────────────────────────────────────────────────────────────────

    def list_documents(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT d.*, COUNT(c.chunk_id) AS chunk_count"
                " FROM documents d LEFT JOIN chunks c ON d.doc_id = c.doc_id"
                " GROUP BY d.doc_id ORDER BY d.created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            try:
                d["metadata"] = json.loads(d.get("metadata") or "{}")
            except Exception:
                d["metadata"] = {}
            result.append(d)
        return result

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT d.*, COUNT(c.chunk_id) AS chunk_count"
                " FROM documents d LEFT JOIN chunks c ON d.doc_id=c.doc_id"
                " WHERE d.doc_id=? GROUP BY d.doc_id",
                (doc_id,),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["metadata"] = json.loads(d.get("metadata") or "{}")
        except Exception:
            d["metadata"] = {}
        return d

    def stats(self) -> Dict[str, int]:
        with self._conn() as conn:
            docs   = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        return {"documents": docs, "chunks": chunks}


# Module-level singleton
vector_store = VectorStore()
