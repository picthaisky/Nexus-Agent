"""Multi-provider LLM Inference Engine.

Supports OpenAI, Anthropic (Claude), Google Gemini, Azure OpenAI, vLLM /
LM Studio / Ollama (any OpenAI-compatible local server) and arbitrary
custom OpenAI-compatible endpoints — selected per call or per fallback chain.

Design goals
------------
* **Provider abstraction** — a single :meth:`InferenceEngine.generate` API
  that returns a string regardless of backend.
* **Pluggable fallback chain** — try a primary provider, then optional
  fallbacks in order. Local vLLM remains the default first choice.
* **Optional dependencies** — ``anthropic`` and ``google-generativeai`` are
  imported lazily; the engine works even when only ``openai`` is installed.
* **Token accounting** — the engine returns ``InferenceResult`` containing
  ``tokens_in`` / ``tokens_out`` / ``model`` / ``provider`` so the
  observability layer can record per-agent cost.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from openai import OpenAI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass
class InferenceResult:
    """Normalised response from any provider."""

    content: str
    provider: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    raw: Any = None


class ProviderConfig(BaseModel):
    """Configuration for one provider entry in the fallback chain."""

    name: str = Field(..., description="Logical identifier, e.g. 'local', 'openai', 'claude', 'gemini'.")
    provider: str = Field(..., description="Backend type: 'openai_compatible' | 'anthropic' | 'gemini'.")
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: str = ""
    enabled: bool = True
    extra: Dict[str, Any] = Field(default_factory=dict)


class InferenceConfig(BaseModel):
    """Top-level inference configuration.

    ``providers`` is the ordered fallback chain. The legacy ``local_*`` /
    ``cloud_*`` fields are retained for backward compatibility with existing
    callers that construct ``InferenceConfig()`` with no arguments — they are
    used to synthesise the default provider chain when ``providers`` is empty.
    """

    # Legacy fields (still honoured)
    local_base_url: str = "http://localhost:8000/v1"
    local_api_key: str = "EMPTY"
    local_model: str = "meta-llama/Meta-Llama-3-8B-Instruct"
    cloud_base_url: str = "https://api.openai.com/v1"
    cloud_api_key: Optional[str] = None
    cloud_model: str = "gpt-4o-mini"
    use_cloud_fallback: bool = True

    # New: explicit provider chain
    providers: List[ProviderConfig] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------


class _BaseAdapter:
    name: str = "base"

    def __init__(self, cfg: ProviderConfig) -> None:
        self.cfg = cfg

    def generate(
        self,
        messages: Sequence[Dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> InferenceResult:  # pragma: no cover - abstract
        raise NotImplementedError


class OpenAICompatibleAdapter(_BaseAdapter):
    """Adapter for OpenAI, Azure OpenAI, vLLM, Ollama, LM Studio, etc."""

    name = "openai_compatible"

    def __init__(self, cfg: ProviderConfig) -> None:
        super().__init__(cfg)
        self._client = OpenAI(
            base_url=cfg.base_url or "https://api.openai.com/v1",
            api_key=cfg.api_key or "EMPTY",
        )

    def generate(
        self,
        messages: Sequence[Dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> InferenceResult:
        resp = self._client.chat.completions.create(
            model=self.cfg.model,
            messages=list(messages),  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        return InferenceResult(
            content=content,
            provider=self.cfg.name,
            model=self.cfg.model,
            tokens_in=getattr(usage, "prompt_tokens", 0) or 0,
            tokens_out=getattr(usage, "completion_tokens", 0) or 0,
            raw=resp,
        )


class AnthropicAdapter(_BaseAdapter):
    """Adapter for Anthropic Claude (claude-3-*)."""

    name = "anthropic"

    def __init__(self, cfg: ProviderConfig) -> None:
        super().__init__(cfg)
        try:
            import anthropic  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "The 'anthropic' package is required for Claude support. "
                "Install with: pip install anthropic"
            ) from exc
        self._anthropic = anthropic
        self._client = anthropic.Anthropic(
            api_key=cfg.api_key or os.environ.get("ANTHROPIC_API_KEY", ""),
            base_url=cfg.base_url or None,
        )

    @staticmethod
    def _split_messages(messages: Sequence[Dict[str, str]]) -> tuple[str, list[dict]]:
        system_parts: list[str] = []
        chat: list[dict] = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                system_parts.append(content)
            else:
                # Anthropic only accepts user/assistant roles.
                chat.append({"role": "user" if role == "user" else "assistant", "content": content})
        return "\n\n".join(system_parts), chat

    def generate(
        self,
        messages: Sequence[Dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> InferenceResult:
        system, chat = self._split_messages(messages)
        resp = self._client.messages.create(
            model=self.cfg.model,
            system=system or None,
            messages=chat,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text_blocks = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        content = "".join(text_blocks)
        usage = getattr(resp, "usage", None)
        return InferenceResult(
            content=content,
            provider=self.cfg.name,
            model=self.cfg.model,
            tokens_in=getattr(usage, "input_tokens", 0) or 0,
            tokens_out=getattr(usage, "output_tokens", 0) or 0,
            raw=resp,
        )


class GeminiAdapter(_BaseAdapter):
    """Adapter for Google Gemini (gemini-1.5-*)."""

    name = "gemini"

    def __init__(self, cfg: ProviderConfig) -> None:
        super().__init__(cfg)
        try:
            import google.generativeai as genai  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "The 'google-generativeai' package is required for Gemini. "
                "Install with: pip install google-generativeai"
            ) from exc
        self._genai = genai
        api_key = cfg.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get(
            "GOOGLE_API_KEY", ""
        )
        if api_key:
            genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(cfg.model)

    @staticmethod
    def _convert_messages(messages: Sequence[Dict[str, str]]) -> tuple[str, list[dict]]:
        system_parts: list[str] = []
        history: list[dict] = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                system_parts.append(content)
            else:
                gem_role = "user" if role == "user" else "model"
                history.append({"role": gem_role, "parts": [content]})
        return "\n\n".join(system_parts), history

    def generate(
        self,
        messages: Sequence[Dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> InferenceResult:
        system, history = self._convert_messages(messages)
        # Prepend system as the first user turn if non-empty (Gemini-friendly).
        if system:
            history = [{"role": "user", "parts": [f"[System]\n{system}"]}] + history
        resp = self._model.generate_content(
            history,
            generation_config={"temperature": temperature, "max_output_tokens": max_tokens},
        )
        content = getattr(resp, "text", "") or ""
        meta = getattr(resp, "usage_metadata", None)
        return InferenceResult(
            content=content,
            provider=self.cfg.name,
            model=self.cfg.model,
            tokens_in=getattr(meta, "prompt_token_count", 0) or 0,
            tokens_out=getattr(meta, "candidates_token_count", 0) or 0,
            raw=resp,
        )


ADAPTER_REGISTRY: Dict[str, type[_BaseAdapter]] = {
    "openai_compatible": OpenAICompatibleAdapter,
    "openai": OpenAICompatibleAdapter,
    "azure": OpenAICompatibleAdapter,
    "vllm": OpenAICompatibleAdapter,
    "ollama": OpenAICompatibleAdapter,
    "lmstudio": OpenAICompatibleAdapter,
    "anthropic": AnthropicAdapter,
    "claude": AnthropicAdapter,
    "gemini": GeminiAdapter,
    "google": GeminiAdapter,
}


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


def _providers_from_env() -> List[ProviderConfig]:
    """Build a default provider chain from environment variables."""
    chain: list[ProviderConfig] = []

    # Local (vLLM / Ollama / LM Studio)
    if os.environ.get("VLLM_ENABLED", "false").lower() in {"1", "true", "yes"}:
        chain.append(ProviderConfig(
            name="local",
            provider="openai_compatible",
            base_url=os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1"),
            api_key=os.environ.get("VLLM_API_KEY", "EMPTY"),
            model=os.environ.get("VLLM_MODEL_NAME", "meta-llama/Meta-Llama-3-8B-Instruct"),
        ))

    if os.environ.get("OPENAI_API_KEY"):
        chain.append(ProviderConfig(
            name="openai",
            provider="openai_compatible",
            base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            api_key=os.environ.get("OPENAI_API_KEY"),
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        ))

    if os.environ.get("ANTHROPIC_API_KEY"):
        chain.append(ProviderConfig(
            name="claude",
            provider="anthropic",
            api_key=os.environ.get("ANTHROPIC_API_KEY"),
            model=os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620"),
        ))

    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        chain.append(ProviderConfig(
            name="gemini",
            provider="gemini",
            api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"),
            model=os.environ.get("GEMINI_MODEL", "gemini-1.5-flash"),
        ))

    return chain


class InferenceEngine:
    """Unified entrypoint for multi-provider LLM inference.

    Tries each provider in :attr:`config.providers` order until one succeeds.
    """

    def __init__(self, config: InferenceConfig | None = None) -> None:
        self.config = config or InferenceConfig()
        self._adapters: list[_BaseAdapter] = []
        self._build_adapters()

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def _build_adapters(self) -> None:
        providers = list(self.config.providers)
        if not providers:
            providers = _providers_from_env()
        if not providers:
            # Legacy fallback: synthesise local + optional cloud from old fields.
            providers.append(ProviderConfig(
                name="local",
                provider="openai_compatible",
                base_url=self.config.local_base_url,
                api_key=self.config.local_api_key,
                model=self.config.local_model,
            ))
            cloud_key = self.config.cloud_api_key or os.environ.get("OPENAI_API_KEY")
            if self.config.use_cloud_fallback and cloud_key:
                providers.append(ProviderConfig(
                    name="openai",
                    provider="openai_compatible",
                    base_url=self.config.cloud_base_url,
                    api_key=cloud_key,
                    model=self.config.cloud_model,
                ))

        for p in providers:
            if not p.enabled:
                continue
            adapter_cls = ADAPTER_REGISTRY.get(p.provider)
            if adapter_cls is None:
                logger.warning("Unknown provider type %r — skipping.", p.provider)
                continue
            try:
                self._adapters.append(adapter_cls(p))
                logger.info("Inference provider ready: %s (%s / %s)", p.name, p.provider, p.model)
            except Exception as exc:
                logger.warning("Failed to initialise provider %s: %s", p.name, exc)

        if not self._adapters:
            logger.warning("No inference providers configured; generate() will raise.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def providers(self) -> list[str]:
        """Return the ordered names of active providers."""
        return [a.cfg.name for a in self._adapters]

    def list_providers(self) -> list[dict]:
        """Return JSON-friendly info for ``/inference/providers`` endpoint."""
        return [
            {
                "name": a.cfg.name,
                "provider": a.cfg.provider,
                "model": a.cfg.model,
                "base_url": a.cfg.base_url,
            }
            for a in self._adapters
        ]

    def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        *,
        provider: Optional[str] = None,
    ) -> str:
        """Generate a completion; returns the string content (legacy API)."""
        return self.generate_detailed(
            messages, temperature=temperature, max_tokens=max_tokens, provider=provider
        ).content

    def generate_detailed(
        self,
        messages: Sequence[Dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        provider: Optional[str] = None,
    ) -> InferenceResult:
        """Generate a completion and return the full :class:`InferenceResult`.

        If ``provider`` is given, only that provider is used (no fallback).
        Otherwise the configured chain is tried in order.
        """
        if not self._adapters:
            raise RuntimeError("No inference providers configured.")

        chain: list[_BaseAdapter]
        if provider:
            chain = [a for a in self._adapters if a.cfg.name == provider]
            if not chain:
                raise ValueError(f"Provider '{provider}' is not configured.")
        else:
            chain = self._adapters

        last_exc: Optional[Exception] = None
        for adapter in chain:
            try:
                from nexus_agent.core.resilience import resilient_call

                return resilient_call(
                    f"llm:{adapter.cfg.name}",
                    adapter.generate,
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                logger.error("Provider %s failed: %s", adapter.cfg.name, exc)
                last_exc = exc
                continue
        raise RuntimeError(
            f"All providers failed. Last error: {last_exc}"
        ) from last_exc
