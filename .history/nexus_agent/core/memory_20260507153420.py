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
    """Loads and manages skill/playbook rules using SQLite for advanced tracking."""
    def __init__(self, db_path: str = "nexus_playbook.db", skill_dir: str = "skills"):
        self.db_path = db_path
        self.skill_dir = skill_dir
        os.makedirs(self.skill_dir, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS playbook (
                    rule_id TEXT PRIMARY KEY,
                    name TEXT,
                    content TEXT,
                    maturity TEXT DEFAULT 'candidate',
                    score REAL DEFAULT 5.0,
                    helpful_count INTEGER DEFAULT 0,
                    harmful_count INTEGER DEFAULT 0,
                    is_antipattern BOOLEAN DEFAULT 0,
                    last_validated REAL
                )
            ''')
            # FTS table for semantic/keyword search
            conn.execute('''
                CREATE VIRTUAL TABLE IF NOT EXISTS playbook_fts USING fts5(
                    rule_id UNINDEXED,
                    name,
                    content
                )
            ''')
            conn.commit()

    def add_rule(self, rule_id: str, name: str, content: str) -> None:
        import time
        with sqlite3.connect(self.db_path) as conn:
            # Upsert into playbook
            conn.execute('''
                INSERT INTO playbook (rule_id, name, content, last_validated)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(rule_id) DO UPDATE SET
                    name=excluded.name,
                    content=excluded.content,
                    last_validated=excluded.last_validated
            ''', (rule_id, name, content, time.time()))
            
            # Upsert into FTS
            conn.execute('DELETE FROM playbook_fts WHERE rule_id = ?', (rule_id,))
            conn.execute('INSERT INTO playbook_fts (rule_id, name, content) VALUES (?, ?, ?)',
                         (rule_id, name, content))
            conn.commit()
        logger.info(f"Added/Updated rule {rule_id} in Playbook")

    def record_feedback(self, rule_id: str, is_helpful: bool) -> None:
        import time
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('SELECT score, helpful_count, harmful_count, is_antipattern FROM playbook WHERE rule_id = ?', (rule_id,))
            row = cursor.fetchone()
            if not row:
                return
            
            score, helpful, harmful, is_antipattern = row
            
            if is_helpful:
                helpful += 1
                score = min(10.0, score + 1.0)
            else:
                harmful += 1
                # Harmful marks are penalized 4x more heavily
                score = max(0.0, score - 4.0)
                
            # If score drops below 2.0 and has harmful marks, it becomes an anti-pattern
            if score <= 2.0 and harmful >= 2:
                is_antipattern = 1
                
            # Determine maturity
            maturity = 'candidate'
            if score >= 7.0 and helpful >= 3:
                maturity = 'established'
            if score >= 9.0 and helpful >= 10:
                maturity = 'proven'
                
            conn.execute('''
                UPDATE playbook 
                SET score=?, helpful_count=?, harmful_count=?, is_antipattern=?, maturity=?, last_validated=?
                WHERE rule_id=?
            ''', (score, helpful, harmful, is_antipattern, maturity, time.time(), rule_id))
            conn.commit()

    def search_playbook(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        import time
        results = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            # FTS Match (we process the query to remove symbols that break FTS5)
            safe_query = "".join(c if c.isalnum() else " " for c in query)
            # Create prefix matching tokens
            fts_query = " OR ".join([f"{w}*" for w in safe_query.split() if len(w) > 2])
            
            if not fts_query:
                # If no valid words, just return top rules
                sql = 'SELECT * FROM playbook ORDER BY score DESC LIMIT ?'
                cursor = conn.execute(sql, (limit,))
            else:
                sql = '''
                    SELECT p.* FROM playbook p
                    JOIN playbook_fts f ON p.rule_id = f.rule_id
                    WHERE playbook_fts MATCH ?
                '''
                cursor = conn.execute(sql, (fts_query,))
                
            rows = cursor.fetchall()
            
            current_time = time.time()
            for row in rows:
                r = dict(row)
                # Dynamic Decay: Half-life of 90 days (7776000 seconds)
                # Every 90 days, confidence score decays towards 5.0
                last_validated = r.get('last_validated') or current_time
                days_passed = (current_time - last_validated) / 86400
                decay_factor = 0.5 ** (days_passed / 90.0)
                
                # Apply decay (pulling it towards 5.0)
                effective_score = 5.0 + (r['score'] - 5.0) * decay_factor
                r['effective_score'] = effective_score
                results.append(r)
                
        # Sort by effective score
        results.sort(key=lambda x: x['effective_score'], reverse=True)
        return results[:limit]
