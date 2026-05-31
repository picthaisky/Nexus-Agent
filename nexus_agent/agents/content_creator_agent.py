"""Content Creator Agent.

Role: Expert Copywriter and Content Strategist.
Responsibility: Create standard-length articles and social media posts based on topics and keywords.
"""

from __future__ import annotations

import logging
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, ContentCreationResult

logger = logging.getLogger(__name__)

CONTENT_CREATOR_SYSTEM_PROMPT = """You are the Content Creator Agent for Nexus-Agent.
Your role is to act as an expert copywriter, SEO specialist, and social media manager.
You are given a topic or prompt.
Your responsibility is to write engaging, well-structured content (such as standard-length articles or social media posts) in Markdown format.
Ensure the tone matches the requested platform (e.g., professional for articles, catchy for social media).
"""

class ContentCreatorAgent(BaseAgent):
    """Executes content creation and returns a ContentCreationResult."""

    role = AgentRole.CONTENT_CREATOR_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=CONTENT_CREATOR_SYSTEM_PROMPT)

    def run(self, payload: dict[str, Any]) -> ContentCreationResult:
        """Execute a content creation task and return the drafted content."""
        topic = payload.get("topic", "")
        if not topic:
            raise ValueError("ContentCreatorAgent requires a 'topic' in the payload.")
            
        logger.info(f"ContentCreatorAgent drafting content for: {topic[:50]}...")
        
        # In a real implementation, this agent would use an InferenceEngine 
        # (like GPT-4 or Claude) to generate the actual content based on the prompt.
        # For now, we simulate the output.
        
        content_md = f"### Content Draft: {topic}\\n\\n**[Social Media Post]**\\nExciting news about {topic}! 🚀 Check out our latest insights on how this changes everything. #Innovation #Future\\n\\n**[Article Outline]**\\n1. Introduction to {topic}\\n2. Key Benefits\\n3. How to get started\\n4. Conclusion"
        metadata = {"word_count": len(content_md.split()), "tone": "engaging"}
            
        return ContentCreationResult(
            topic=topic,
            content_md=content_md,
            metadata=metadata
        )
