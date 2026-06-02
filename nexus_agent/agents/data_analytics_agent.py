"""Data Analytics Agent — analyzes datasets and generates insights and visualizations."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, DataAnalyticsReport

logger = logging.getLogger(__name__)

_SYSTEM = """You are a Senior Data Analyst with expertise in statistics, data visualization,
business intelligence, and machine learning fundamentals.

Given data, a dataset description, or an analytics question:
1. Identify key patterns and anomalies
2. Generate actionable insights
3. Propose chart/visualization specs (Vega-Lite compatible)
4. Give data-driven recommendations

Respond ONLY with valid JSON:
{
  "summary_md": "## Analytics Report\n...",
  "insights": ["Revenue grew 23% MoM", "Top segment: SME at 45%"],
  "chart_specs": [
    {
      "title": "Monthly Revenue Trend",
      "type": "line",
      "description": "Shows revenue over the last 12 months",
      "x_field": "month",
      "y_field": "revenue"
    }
  ],
  "recommendations": ["Focus on SME retention", "Investigate Q3 drop"]
}"""


class DataAnalyticsAgent(BaseAgent):
    role = AgentRole.DATA_ANALYST

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> DataAnalyticsReport:
        task = payload.get("task", payload.get("data", payload.get("question", "")))
        logger.info("DataAnalyticsAgent analyzing: %s", str(task)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Analyze the following data/question:\n\n{task}"},
                    ],
                    temperature=0.3, max_tokens=2500,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    return DataAnalyticsReport(
                        task=str(task)[:200],
                        summary_md=data.get("summary_md", ""),
                        insights=data.get("insights", []),
                        chart_specs=data.get("chart_specs", []),
                        recommendations=data.get("recommendations", []),
                        metadata={"provider": resp.provider},
                    )
            except Exception as exc:
                logger.warning("DataAnalyticsAgent LLM failed: %s", exc)

        return DataAnalyticsReport(
            task=str(task)[:200],
            summary_md=f"## Analytics Report\n\n> ⚠️ LLM unavailable.\n\nData submitted: `{str(task)[:150]}`",
            insights=["Configure LLM provider for AI-powered insights"],
            recommendations=["Set up OpenAI/Claude/Gemini API key"],
        )
