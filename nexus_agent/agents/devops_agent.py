"""DevOps Agent — generates Dockerfiles, CI/CD pipelines, and deployment configs."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, DevOpsReport

logger = logging.getLogger(__name__)

_SYSTEM = """You are a Senior DevOps Engineer expert in Docker, Kubernetes, GitHub Actions, CI/CD pipelines,
infrastructure-as-code, and cloud deployments (AWS/GCP/Azure).

Given a task or project description, generate:
1. Dockerfile (multi-stage if applicable)
2. docker-compose.yml
3. GitHub Actions workflow (.github/workflows/deploy.yml)
4. Deployment commands and checklist

Respond ONLY with valid JSON:
{
  "summary_md": "## DevOps Configuration\n...",
  "commands": ["docker build -t app:latest .", "docker-compose up -d"],
  "artifacts": {
    "Dockerfile": "FROM python:3.12-slim\\n...",
    "docker-compose.yml": "version: '3.9'\\n...",
    ".github/workflows/deploy.yml": "name: Deploy\\non: push:\\n..."
  }
}"""


class DevOpsAgent(BaseAgent):
    role = AgentRole.DEVOPS_AGENT

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> DevOpsReport:
        task = payload.get("task", payload.get("project", ""))
        stack = payload.get("stack", "Python/FastAPI")
        logger.info("DevOpsAgent generating config for: %s", str(task)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Tech stack: {stack}\n\nTask:\n{task}"},
                    ],
                    temperature=0.1, max_tokens=4000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    return DevOpsReport(
                        task=str(task)[:200],
                        summary_md=data.get("summary_md", ""),
                        artifacts=data.get("artifacts", {}),
                        commands=data.get("commands", []),
                        metadata={"provider": resp.provider, "stack": stack},
                    )
            except Exception as exc:
                logger.warning("DevOpsAgent LLM failed: %s", exc)

        dockerfile = f"FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nCMD [\"python\", \"-m\", \"uvicorn\", \"main:app\", \"--host\", \"0.0.0.0\"]"
        return DevOpsReport(
            task=str(task)[:200],
            summary_md=f"## DevOps Config\n\n> ⚠️ LLM unavailable — providing template config.\n\nStack: `{stack}`",
            artifacts={"Dockerfile": dockerfile},
            commands=["docker build -t app:latest .", "docker run -p 8080:8080 app:latest"],
        )
