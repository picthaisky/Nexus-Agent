"""API Integration Agent — generates API client code, validates endpoints,
and handles authentication strategies for external REST/GraphQL APIs."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole

logger = logging.getLogger(__name__)

_SYSTEM = """You are an expert API Integration Engineer. Given an API description, OpenAPI spec, or task:

1. Generate clean, production-ready API client code (Python + TypeScript)
2. Handle authentication (Bearer, API Key, OAuth2, Basic)
3. Add error handling, retries, and rate-limit awareness
4. Provide example request/response payloads
5. Identify potential issues (CORS, pagination, auth expiry)

Respond ONLY with valid JSON:
{
  "summary_md": "## API Integration\\n...",
  "python_client": "import httpx\\n...",
  "typescript_client": "const response = await fetch(...)\\n...",
  "example_requests": [{"method": "GET", "url": "/api/v1/...", "headers": {}, "body": null}],
  "auth_strategy": "bearer_token",
  "issues": ["CORS must be enabled on the API server", "Token expires every 3600s"]
}"""


class APIIntegrationAgent(BaseAgent):
    role = AgentRole.API_INTEGRATION

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        task        = payload.get("task", payload.get("api_spec", ""))
        test_url    = payload.get("test_url", "")
        auth_type   = payload.get("auth_type", "bearer_token")

        logger.info("APIIntegrationAgent generating client for: %s", str(task)[:80])

        # Optional: probe the endpoint if a URL is given
        probe_result: dict[str, Any] = {}
        if test_url:
            try:
                resp = httpx.head(test_url, timeout=5.0, follow_redirects=True)
                probe_result = {
                    "status": resp.status_code,
                    "headers": dict(resp.headers),
                    "reachable": True,
                }
            except Exception as exc:
                probe_result = {"reachable": False, "error": str(exc)}

        if self.engine:
            try:
                user_content = f"Auth type: {auth_type}\nTask/Spec:\n{task}"
                if probe_result:
                    user_content += f"\n\nEndpoint probe: {json.dumps(probe_result)}"
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user",   "content": user_content},
                    ],
                    temperature=0.1, max_tokens=4000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    if probe_result:
                        data["probe_result"] = probe_result
                    data["metadata"] = {"provider": resp.provider, "tokens_in": resp.tokens_in}
                    return data
            except Exception as exc:
                logger.warning("APIIntegrationAgent LLM failed: %s", exc)

        python_template = f"""import httpx

BASE_URL = "https://api.example.com"
HEADERS  = {{"Authorization": "Bearer YOUR_TOKEN", "Content-Type": "application/json"}}

def get_resource(resource_id: str) -> dict:
    resp = httpx.get(f"{{BASE_URL}}/resource/{{resource_id}}", headers=HEADERS, timeout=30.0)
    resp.raise_for_status()
    return resp.json()
"""
        return {
            "summary_md":       f"## API Integration\n\n> ⚠️ LLM unavailable — providing template.\n\nTask: `{str(task)[:100]}`",
            "python_client":    python_template,
            "typescript_client":"const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });\nconst data = await response.json();",
            "example_requests": [],
            "auth_strategy":    auth_type,
            "issues":           ["Configure an LLM provider for AI-generated integration code"],
            "probe_result":     probe_result,
        }
