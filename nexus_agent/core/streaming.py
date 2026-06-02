"""Streaming LLM inference — yields text tokens as a Server-Sent Events generator.

Supports:
* OpenAI / OpenAI-compatible (vLLM, LM Studio) via ``stream=True``
* Anthropic Claude via ``client.messages.stream()``
* Google Gemini via ``model.generate_content(..., stream=True)``

Usage (FastAPI endpoint)::

    from fastapi.responses import StreamingResponse
    from nexus_agent.core.streaming import stream_inference

    @app.post("/inference/stream")
    async def stream(req: InferenceRequest):
        return StreamingResponse(
            stream_inference(req.messages, provider=req.provider),
            media_type="text/event-stream",
        )
"""
from __future__ import annotations

import json
import logging
import os
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

_SSE_DONE = "data: [DONE]\n\n"


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_openai(
    messages: list[dict],
    *,
    api_key: str,
    base_url: str = "https://api.openai.com/v1",
    model: str = "gpt-4o-mini",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    provider_name: str = "openai",
) -> AsyncGenerator[str, None]:
    """Stream tokens from OpenAI or any OpenAI-compatible endpoint."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        async with client.chat.completions.stream(
            model=model,
            messages=messages,   # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        ) as stream:
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield _sse({"token": delta, "provider": provider_name})
    except Exception as exc:
        logger.error("OpenAI stream error: %s", exc)
        yield _sse({"error": str(exc)})
    finally:
        yield _SSE_DONE


async def stream_anthropic(
    messages: list[dict],
    *,
    api_key: str,
    model: str = "claude-3-5-sonnet-20241022",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    system: str = "",
) -> AsyncGenerator[str, None]:
    """Stream tokens from Anthropic Claude."""
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)

        chat = [m for m in messages if m.get("role") != "system"]
        sys_parts = [m["content"] for m in messages if m.get("role") == "system"]
        system_msg = system or "\n".join(sys_parts)

        async with client.messages.stream(
            model=model,
            system=system_msg or anthropic.NOT_GIVEN,   # type: ignore[arg-type]
            messages=chat,  # type: ignore[arg-type]
            max_tokens=max_tokens,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield _sse({"token": text, "provider": "claude"})
    except Exception as exc:
        logger.error("Anthropic stream error: %s", exc)
        yield _sse({"error": str(exc)})
    finally:
        yield _SSE_DONE


async def stream_gemini(
    messages: list[dict],
    *,
    api_key: str,
    model: str = "gemini-1.5-flash",
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Google Gemini."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        gmodel = genai.GenerativeModel(model)

        history: list[dict] = []
        last_user_msg = ""
        for m in messages:
            role    = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                last_user_msg = f"[System]\n{content}\n\n"
            elif role == "user":
                history.append({"role": "user", "parts": [last_user_msg + content]})
                last_user_msg = ""
            else:
                history.append({"role": "model", "parts": [content]})

        response = gmodel.generate_content(
            history,
            stream=True,
            generation_config={"temperature": temperature, "max_output_tokens": max_tokens},
        )
        for chunk in response:
            text = getattr(chunk, "text", "")
            if text:
                yield _sse({"token": text, "provider": "gemini"})
    except Exception as exc:
        logger.error("Gemini stream error: %s", exc)
        yield _sse({"error": str(exc)})
    finally:
        yield _SSE_DONE


async def stream_inference(
    messages: list[dict],
    *,
    provider: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    system: str = "",
) -> AsyncGenerator[str, None]:
    """Auto-select the first available provider and stream the response.

    Provider priority matches InferenceEngine fallback order:
    vLLM (local) → OpenAI → Claude → Gemini
    """
    openai_key   = os.environ.get("OPENAI_API_KEY", "")
    claude_key   = os.environ.get("ANTHROPIC_API_KEY", "")
    gemini_key   = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
    vllm_enabled = os.environ.get("VLLM_ENABLED", "false").lower() in ("1","true","yes")

    target = (provider or "").lower()

    if target in ("", "openai") and openai_key:
        async for chunk in stream_openai(
            messages, api_key=openai_key,
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=temperature, max_tokens=max_tokens,
        ):
            yield chunk
    elif target in ("", "claude") and claude_key:
        async for chunk in stream_anthropic(
            messages, api_key=claude_key,
            model=os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"),
            temperature=temperature, max_tokens=max_tokens, system=system,
        ):
            yield chunk
    elif target in ("", "gemini") and gemini_key:
        async for chunk in stream_gemini(
            messages, api_key=gemini_key,
            model=os.environ.get("GEMINI_MODEL", "gemini-1.5-flash"),
            temperature=temperature, max_tokens=max_tokens,
        ):
            yield chunk
    elif target == "local" and vllm_enabled:
        async for chunk in stream_openai(
            messages,
            api_key=os.environ.get("VLLM_API_KEY", "EMPTY"),
            base_url=os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1"),
            model=os.environ.get("VLLM_MODEL_NAME", "meta-llama/Meta-Llama-3-8B-Instruct"),
            temperature=temperature, max_tokens=max_tokens, provider_name="local",
        ):
            yield chunk
    else:
        yield _sse({"error": "No LLM provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."})
        yield _SSE_DONE
