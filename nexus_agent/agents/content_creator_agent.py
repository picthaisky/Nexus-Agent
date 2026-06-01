"""Content Creator Agent — real LLM-powered content generation."""
from __future__ import annotations

import logging
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, ContentCreationResult

logger = logging.getLogger(__name__)

CONTENT_CREATOR_SYSTEM_PROMPT = """You are the Content Creator Agent for Nexus-Agent.
You are an expert copywriter, SEO specialist, and content strategist.

When given a topic or prompt:
1. Write engaging, well-structured content in Markdown
2. Adapt tone to the platform (professional for articles, catchy for social media)
3. Include relevant sections: headline, intro, body, CTA
4. Provide both a social media version and a long-form article outline

Respond in Markdown format. Use Thai if the request is in Thai."""


class ContentCreatorAgent(BaseAgent):
    """Content creator agent backed by LLM inference."""

    role = AgentRole.CONTENT_CREATOR_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=CONTENT_CREATOR_SYSTEM_PROMPT)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> ContentCreationResult:
        topic = payload.get("topic", "")
        platform = payload.get("platform", "general")
        if not topic:
            raise ValueError("ContentCreatorAgent requires a 'topic' in the payload.")

        logger.info("ContentCreatorAgent drafting content for: %s", topic[:80])

        content_md, metadata = self._generate(topic, platform)
        return ContentCreationResult(topic=topic, content_md=content_md, metadata=metadata)

    def _generate(self, topic: str, platform: str) -> tuple[str, dict]:
        user_msg = f"Platform: {platform}\nTopic: {topic}"

        if self.engine is not None:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                    temperature=0.7,
                )
                word_count = len(resp.content.split())
                return resp.content, {
                    "word_count": word_count,
                    "platform": platform,
                    "provider": resp.provider,
                    "tokens_in": resp.tokens_in,
                    "tokens_out": resp.tokens_out,
                }
            except Exception as exc:
                logger.warning("ContentCreatorAgent LLM call failed: %s", exc)

        # Fallback template
        content_md = (
            f"## {topic}\n\n"
            f"> ⚠️ ระบบยังไม่ได้รับการตั้งค่า LLM Provider\n\n"
            f"**[Social Media]**\n🚀 {topic} — สิ่งที่คุณต้องรู้! #Innovation\n\n"
            f"**[Article Outline]**\n"
            f"1. บทนำ: {topic} คืออะไร?\n"
            f"2. ประโยชน์หลัก\n"
            f"3. วิธีเริ่มต้น\n"
            f"4. สรุปและ Call-to-Action"
        )
        return content_md, {"word_count": len(content_md.split()), "platform": platform, "status": "fallback"}
