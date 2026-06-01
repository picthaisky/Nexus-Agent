"""Finance and Accounting Agent — real LLM-powered analysis."""
from __future__ import annotations

import logging
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, FinanceAnalysisResult

logger = logging.getLogger(__name__)

FINANCE_AGENT_SYSTEM_PROMPT = """You are the Finance and Accounting Agent for Nexus-Agent.
Your role is a senior financial analyst and expert accountant.
You analyze financial data, compute metrics, and produce clear professional reports.

When given a task:
1. Break down what financial entities are involved (revenue, cost, profit, tax, etc.)
2. Identify key calculations needed
3. Present findings in structured Markdown with tables where appropriate
4. Include actionable recommendations

Always respond in well-formatted Markdown. Use Thai language if the request is in Thai."""


class FinanceAgent(BaseAgent):
    """Financial analyst agent backed by LLM inference."""

    role = AgentRole.FINANCE_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=FINANCE_AGENT_SYSTEM_PROMPT)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> FinanceAnalysisResult:
        task = payload.get("task", "")
        if not task:
            raise ValueError("FinanceAgent requires a 'task' in the payload.")

        logger.info("FinanceAgent executing task: %s", task[:80])

        analysis_md, metrics = self._analyze(task)
        return FinanceAnalysisResult(task=task, analysis_md=analysis_md, metrics=metrics)

    def _analyze(self, task: str) -> tuple[str, dict]:
        if self.engine is not None:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {"role": "user", "content": task},
                    ],
                    temperature=0.2,
                )
                return resp.content, {
                    "status": "success",
                    "provider": resp.provider,
                    "tokens_in": resp.tokens_in,
                    "tokens_out": resp.tokens_out,
                }
            except Exception as exc:
                logger.warning("FinanceAgent LLM call failed: %s", exc)

        # Fallback: structured template
        analysis_md = (
            f"## รายงานการวิเคราะห์ทางการเงิน\n\n"
            f"**งาน:** {task}\n\n"
            f"### สรุปเบื้องต้น\n"
            f"ระบบยังไม่ได้รับการตั้งค่า LLM Provider — กรุณาตั้งค่า OPENAI_API_KEY, "
            f"ANTHROPIC_API_KEY หรือ GEMINI_API_KEY เพื่อให้ agent วิเคราะห์ข้อมูลได้จริง\n\n"
            f"### รายการที่ต้องดำเนินการ\n"
            f"- [ ] ตรวจสอบข้อมูลนำเข้า\n"
            f"- [ ] คำนวณตัวชี้วัดหลัก\n"
            f"- [ ] จัดทำรายงานสรุป"
        )
        return analysis_md, {"status": "fallback", "confidence": 0.0}
