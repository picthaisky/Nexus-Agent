"""RAG (Retrieval-Augmented Generation) Agent.

Retrieves relevant document chunks from the VectorStore and augments the
LLM prompt with the retrieved context before generating an answer.
"""
from __future__ import annotations

import logging
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole
from nexus_agent.core.vector_store import vector_store

logger = logging.getLogger(__name__)


class RAGAgent(BaseAgent):
    """Answer questions by retrieving relevant context from the document store."""

    role = AgentRole.RAG_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt="")
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        question  = payload.get("question", payload.get("query", ""))
        top_k     = int(payload.get("top_k", 5))
        doc_filter = payload.get("doc_id")

        logger.info("RAGAgent searching for: %s", question[:80])

        # 1. Retrieve relevant chunks
        chunks = vector_store.search(question, top_k=top_k)
        if doc_filter:
            chunks = [c for c in chunks if c["doc_id"] == doc_filter]

        if not chunks:
            return {
                "question":    question,
                "answer_md":   "ไม่พบเอกสารที่เกี่ยวข้องใน Knowledge Base\n\nลอง **upload ไฟล์** ก่อนถามคำถาม",
                "sources":     [],
                "chunks_used": 0,
            }

        # 2. Build context
        context_parts = []
        for i, chunk in enumerate(chunks, 1):
            title  = chunk.get("title") or chunk.get("source") or f"Doc {chunk['doc_id'][:8]}"
            context_parts.append(f"[{i}] **{title}** (chunk {chunk['chunk_idx']})\n{chunk['text']}")
        context = "\n\n---\n\n".join(context_parts)

        # 3. Generate answer
        if self.engine:
            try:
                system_prompt = (
                    "You are a helpful Knowledge Base assistant. "
                    "Answer the question using ONLY the context provided below. "
                    "If the answer is not in the context, say so clearly. "
                    "Cite sources by their number [1], [2], etc. "
                    "Format your response in Markdown."
                )
                user_msg = f"Context:\n{context}\n\n---\n\nQuestion: {question}"
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_msg},
                    ],
                    temperature=0.1,
                    max_tokens=2048,
                )
                answer_md = resp.content
            except Exception as exc:
                logger.warning("RAGAgent LLM failed: %s", exc)
                answer_md = f"## Retrieved Context\n\n{context}\n\n> ⚠️ LLM unavailable — showing raw retrieval results."
        else:
            answer_md = f"## Retrieved Context\n\n{context}\n\n> ⚠️ Configure an LLM provider for AI-generated answers."

        sources = [
            {
                "index":  i,
                "doc_id": c["doc_id"],
                "title":  c.get("title") or c.get("source") or c["doc_id"][:12],
                "chunk":  c["chunk_idx"],
                "score":  round(c["score"], 4),
            }
            for i, c in enumerate(chunks, 1)
        ]

        return {
            "question":    question,
            "answer_md":   answer_md,
            "sources":     sources,
            "chunks_used": len(chunks),
        }
