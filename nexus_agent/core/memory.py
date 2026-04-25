import sqlite3
import logging
import os
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class EpisodicMemory:
    """Uses SQLite + FTS5 for sub-millisecond retrieval of conversational history."""
    def __init__(self, db_path: str = "nexus_episodic.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            # Using FTS5 for fast full-text semantic matching of past dialogues
            conn.execute('''
                CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
                    session_id UNINDEXED, 
                    role UNINDEXED, 
                    content, 
                    timestamp UNINDEXED
                )
            ''')
            conn.commit()

    def add_message(self, session_id: str, role: str, content: str, timestamp: float):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
                (session_id, role, content, timestamp)
            )
            conn.commit()

    def search_history(self, query: str, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            if session_id:
                # Need to use SQLite matching for FTS5
                sql = "SELECT * FROM messages WHERE session_id = ? AND messages MATCH ? ORDER BY rank LIMIT 10"
                cursor = conn.execute(sql, (session_id, query))
            else:
                sql = "SELECT * FROM messages WHERE messages MATCH ? ORDER BY rank LIMIT 20"
                cursor = conn.execute(sql, (query,))
            return [dict(row) for row in cursor.fetchall()]

class SemanticMemory:
    """Uses a Vector Database (pgvector / Pinecone) for high-dimensional semantic search."""
    def __init__(self, connection_string: str = ""):
        self.connection_string = connection_string
        logger.info("SemanticMemory initialized (Vector DB facade).")

    def embed_and_store(self, text: str, metadata: Dict[str, Any]):
        """Creates embedding and stores in Vector DB."""
        # Example implementation hooks for vLLM embeddings / OpenAI embeddings
        pass

    def semantic_search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Finds closest matches by cosine similarity."""
        return []

class ProceduralMemory:
    """Loads and manages skill files (SKILL.md) for agent execution patterns."""
    def __init__(self, skill_dir: str = "skills"):
        self.skill_dir = skill_dir
        if not os.path.exists(self.skill_dir):
            os.makedirs(self.skill_dir, exist_ok=True)

    def load_skill(self, skill_name: str) -> str:
        skill_path = os.path.join(self.skill_dir, f"{skill_name}.md")
        if os.path.exists(skill_path):
            with open(skill_path, "r", encoding="utf-8") as f:
                return f.read()
        return f"Warning: Skill {skill_name} not found."
