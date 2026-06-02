"""Database Architect Agent — designs schemas, migrations, and query optimizations."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, DatabaseSchemaResult, DBTable

logger = logging.getLogger(__name__)

_SYSTEM = """You are an expert Database Architect with deep knowledge of PostgreSQL, MySQL, SQLite,
normalization, indexing strategies, and database migrations.

Given requirements, design:
1. Normalized table schemas (3NF or better)
2. Primary/Foreign keys and indexes
3. Relationships (1:1, 1:N, M:N)
4. Migration SQL (CREATE TABLE statements)
5. ER diagram in Mermaid syntax

Respond ONLY with valid JSON:
{
  "summary_md": "## Database Design\n...",
  "migration_sql": "CREATE TABLE invoices (...);",
  "er_diagram_md": "```mermaid\nerDiagram\n...\n```",
  "tables": [
    {
      "name": "invoices",
      "columns": ["id SERIAL PRIMARY KEY", "customer_id INT NOT NULL REFERENCES customers(id)", "total NUMERIC(12,2)"],
      "indexes": ["CREATE INDEX idx_invoices_customer ON invoices(customer_id)"],
      "relationships": ["customer_id -> customers.id (N:1)"]
    }
  ]
}"""


class DatabaseArchitectAgent(BaseAgent):
    role = AgentRole.DATABASE_ARCHITECT

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> DatabaseSchemaResult:
        task = payload.get("task", payload.get("requirements", ""))
        db_type = payload.get("db_type", "PostgreSQL")
        logger.info("DatabaseArchitectAgent designing for: %s", str(task)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Database: {db_type}\n\nRequirements:\n{task}"},
                    ],
                    temperature=0.1, max_tokens=3000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    tables = [DBTable(**t) for t in data.get("tables", [])]
                    return DatabaseSchemaResult(
                        task=str(task)[:200],
                        summary_md=data.get("summary_md", ""),
                        tables=tables,
                        migration_sql=data.get("migration_sql", ""),
                        er_diagram_md=data.get("er_diagram_md", ""),
                        metadata={"provider": resp.provider, "db_type": db_type},
                    )
            except Exception as exc:
                logger.warning("DatabaseArchitectAgent LLM failed: %s", exc)

        return DatabaseSchemaResult(
            task=str(task)[:200],
            summary_md=f"## Database Design\n\n> ⚠️ LLM unavailable.\n\nRequirements: `{str(task)[:100]}`",
            migration_sql="-- Configure LLM provider to generate migration SQL",
            er_diagram_md="```mermaid\nerDiagram\n    Entity1 {\n        int id PK\n    }\n```",
        )
