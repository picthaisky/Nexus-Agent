"""Search Agent (Agentspace).

Role: Professional Data Research Assistant.
Responsibility: Process a user query, perform a web search, and return a summarized result with sources.
"""

from __future__ import annotations

import logging
from typing import Any
from duckduckgo_search import DDGS

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, AgentspaceSearchResult

logger = logging.getLogger(__name__)

SEARCH_AGENT_SYSTEM_PROMPT = """You are the Search Agent for Nexus-Agent (Agentspace).
Your role is to act as a professional data research assistant.
You are given a query and you must search for the most relevant and up-to-date information.
Provide a clear, concise, and structured summary of your findings in Markdown format.
"""

class SearchAgent(BaseAgent):
    """Executes a search using DuckDuckGo and returns an AgentspaceSearchResult."""

    role = AgentRole.SEARCH_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=SEARCH_AGENT_SYSTEM_PROMPT)

    def run(self, payload: dict[str, Any]) -> AgentspaceSearchResult:
        """Execute a search query and return the summarized results."""
        query = payload.get("query", "")
        if not query:
            raise ValueError("SearchAgent requires a 'query' in the payload.")
            
        logger.info(f"SearchAgent executing query: {query}")
        
        results = []
        sources = []
        
        try:
            with DDGS() as ddgs:
                ddgs_gen = ddgs.text(query, max_results=5)
                for r in ddgs_gen:
                    results.append(f"Source: {r.get('title')}\nLink: {r.get('href')}\nSnippet: {r.get('body')}\n")
                    sources.append({"title": r.get('title', ''), "url": r.get('href', '')})
        except Exception as e:
            logger.error(f"Search failed: {e}")
            results.append(f"Error executing search: {e}")

        # In a real implementation, we would use the InferenceEngine to summarize `results`.
        # For simplicity and speed, we will just format the snippets.
        if not results:
            summary_md = "No results found for your query."
        else:
            summary_md = "### Search Results\\n\\n" + "\\n\\n".join(results)
            
        return AgentspaceSearchResult(
            query=query,
            summary_md=summary_md,
            sources=sources
        )
