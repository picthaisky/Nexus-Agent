"""Security Audit Agent — OWASP Top 10 vulnerability scanner and security reviewer."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, SecurityAuditReport, SecurityFinding

logger = logging.getLogger(__name__)

_SYSTEM = """You are a Senior Application Security Engineer specialising in OWASP Top 10,
penetration testing, code security review, and security hardening.

Given code, architecture, or system description, identify:
1. Security vulnerabilities mapped to CWE IDs and OWASP categories
2. Risk severity: critical / high / medium / low / info
3. Specific remediation steps for each finding
4. Overall risk score (0-100, higher = more risk) and pass/fail

Respond ONLY with valid JSON:
{
  "summary_md": "## Security Audit Report\n...",
  "risk_score": 45,
  "pass_audit": false,
  "findings": [
    {
      "severity": "high",
      "cwe_id": "CWE-89",
      "owasp": "A03:2021 Injection",
      "title": "SQL Injection in search endpoint",
      "description": "User input is directly concatenated into SQL query",
      "location": "src/api/search.py:42",
      "remediation": "Use parameterised queries: cursor.execute('SELECT * FROM t WHERE id = %s', (user_id,))"
    }
  ]
}"""


class SecurityAuditAgent(BaseAgent):
    role = AgentRole.SECURITY_AUDITOR

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> SecurityAuditReport:
        target = payload.get("target", payload.get("code", payload.get("task", "")))
        scope = payload.get("scope", "application code")
        logger.info("SecurityAuditAgent scanning: %s", str(target)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Scope: {scope}\n\nAudit target:\n{target}"},
                    ],
                    temperature=0.1, max_tokens=3000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    findings = [SecurityFinding(**f) for f in data.get("findings", [])]
                    risk = int(data.get("risk_score", 50))
                    return SecurityAuditReport(
                        target=str(target)[:200],
                        summary_md=data.get("summary_md", ""),
                        findings=findings,
                        risk_score=risk,
                        pass_audit=bool(data.get("pass_audit", risk < 30)),
                        metadata={"provider": resp.provider, "scope": scope},
                    )
            except Exception as exc:
                logger.warning("SecurityAuditAgent LLM failed: %s", exc)

        return SecurityAuditReport(
            target=str(target)[:200],
            summary_md=f"## Security Audit\n\n> ⚠️ LLM unavailable — manual audit required.\n\nTarget: `{str(target)[:100]}`",
            findings=[SecurityFinding(severity="info", cwe_id="N/A", owasp="N/A",
                                       title="Manual review required",
                                       description="LLM provider not configured",
                                       location="N/A", remediation="Configure an LLM provider")],
            risk_score=50, pass_audit=False,
        )
