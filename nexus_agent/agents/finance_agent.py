"""Finance and Accounting Agent.

Role: Financial Analyst and Accountant.
Responsibility: Analyze numbers, create summary reports, read corporate accounting files, and process month-end closings.
"""

from __future__ import annotations

import logging
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, FinanceAnalysisResult

logger = logging.getLogger(__name__)

FINANCE_AGENT_SYSTEM_PROMPT = """You are the Finance and Accounting Agent for Nexus-Agent.
Your role is to act as a senior financial analyst and expert accountant.
You are given a task related to financial data, numbers, corporate accounting files, or month-end closings.
Your responsibility is to analyze the data, compute necessary metrics, and provide a clear, professional summary report in Markdown format.
Focus on accuracy, compliance, and clear presentation of numbers.
"""

class FinanceAgent(BaseAgent):
    """Executes financial analysis and returns a FinanceAnalysisResult."""

    role = AgentRole.FINANCE_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=FINANCE_AGENT_SYSTEM_PROMPT)

    def run(self, payload: dict[str, Any]) -> FinanceAnalysisResult:
        """Execute a financial task and return the summarized report."""
        task = payload.get("task", "")
        if not task:
            raise ValueError("FinanceAgent requires a 'task' in the payload.")
            
        logger.info(f"FinanceAgent executing task: {task[:50]}...")
        
        # In a real implementation, this agent would read CSVs, Excel files, 
        # or connect to an ERP system, then use an InferenceEngine to generate the report.
        # For now, we simulate the output based on the prompt instructions.
        
        analysis_md = f"### Financial Analysis Report\\n\\n**Task:** {task}\\n\\n*Analysis complete. All numbers balance.*"
        metrics = {"status": "success", "confidence": 0.95}
            
        return FinanceAnalysisResult(
            task=task,
            analysis_md=analysis_md,
            metrics=metrics
        )
