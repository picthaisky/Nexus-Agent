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


async def _try_stream(gen: AsyncGenerator[str, None]) -> tuple[bool, str, list[str]]:
    """Consume the first SSE event to detect errors before committing to a provider.

    Returns (has_error, error_message, buffered_chunks).
    If the first data event carries {"error": ...}, we treat this provider as failed.
    """
    buffered: list[str] = []
    try:
        async for raw in gen:
            buffered.append(raw)
            line = raw.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload in ("[DONE]", ""):
                continue
            try:
                import json as _json
                obj = _json.loads(payload)
                if "error" in obj:
                    return True, obj["error"], buffered
            except Exception:
                pass
            # First real token — provider is working
            return False, "", buffered
    except Exception as exc:
        return True, str(exc), buffered
    return False, "", buffered


async def stream_inference(
    messages: list[dict],
    *,
    provider: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    system: str = "",
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens with automatic provider fallback.

    Tries providers in priority order (vLLM → OpenAI → Claude → Gemini).
    If the first event from a provider is an error (e.g. 429 insufficient_quota),
    the next provider is tried automatically — exactly like the non-streaming
    InferenceEngine fallback chain.
    """
    openai_key   = os.environ.get("OPENAI_API_KEY", "")
    claude_key   = os.environ.get("ANTHROPIC_API_KEY", "")
    gemini_key   = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
    vllm_enabled = os.environ.get("VLLM_ENABLED", "false").lower() in ("1","true","yes")

    target = (provider or "").lower()

    # ── Build ordered candidate list ──────────────────────────────────────────
    candidates: list[tuple[str, AsyncGenerator[str, None]]] = []

    if target == "local" and vllm_enabled:
        candidates.append(("local", stream_openai(
            messages,
            api_key=os.environ.get("VLLM_API_KEY", "EMPTY"),
            base_url=os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1"),
            model=os.environ.get("VLLM_MODEL_NAME", "meta-llama/Meta-Llama-3-8B-Instruct"),
            temperature=temperature, max_tokens=max_tokens, provider_name="local",
        )))
    else:
        if vllm_enabled and not target:
            candidates.append(("local", stream_openai(
                messages,
                api_key=os.environ.get("VLLM_API_KEY", "EMPTY"),
                base_url=os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1"),
                model=os.environ.get("VLLM_MODEL_NAME", "meta-llama/Meta-Llama-3-8B-Instruct"),
                temperature=temperature, max_tokens=max_tokens, provider_name="local",
            )))
        if openai_key and target in ("", "openai"):
            candidates.append(("openai", stream_openai(
                messages, api_key=openai_key,
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                temperature=temperature, max_tokens=max_tokens,
            )))
        if claude_key and target in ("", "claude"):
            candidates.append(("claude", stream_anthropic(
                messages, api_key=claude_key,
                model=os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"),
                temperature=temperature, max_tokens=max_tokens, system=system,
            )))
        if gemini_key and target in ("", "gemini"):
            candidates.append(("gemini", stream_gemini(
                messages, api_key=gemini_key,
                model=os.environ.get("GEMINI_MODEL", "gemini-1.5-flash"),
                temperature=temperature, max_tokens=max_tokens,
            )))

    if not candidates:
        yield _sse({"error": "No LLM provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."})
        yield _SSE_DONE
        return

    # ── Try each candidate; fall back on error ───────────────────────────────
    last_error = "Unknown error"
    for pname, gen in candidates:
        has_err, err_msg, buffered = await _try_stream(gen)
        if has_err:
            last_error = err_msg
            logger.warning("stream_inference: provider %s failed (%s), trying next", pname, err_msg[:80])
            continue

        # Replay buffered chunks + stream the rest of the generator
        yield _sse({"provider_used": pname})  # tell client which provider is active
        for chunk in buffered:
            yield chunk
        # The generator was already partially consumed above; it will continue from
        # where _try_stream left off only if the async gen supports resumption.
        # Since Python async generators are stateful, we just yield remaining chunks.
        try:
            async for chunk in gen:
                yield chunk
        except Exception as exc:
            logger.error("stream_inference: mid-stream error from %s: %s", pname, exc)
        return  # Done

    # All providers failed
    yield _sse({
        "error": f"All providers failed. Last error: {last_error}",
        "providers_tried": [c[0] for c in candidates],
    })
    yield _SSE_DONE
