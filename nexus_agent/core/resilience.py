"""Reliability helpers — retry + circuit breaker for outbound calls.

Wraps any callable (typically an LLM adapter call) with:

* ``tenacity`` exponential-backoff retries for transient errors.
* ``pybreaker`` circuit-breaker that trips after N consecutive failures and
  blocks calls for a configurable cool-down before half-opening.

Each named "service" gets its own breaker so that an outage in (say) Gemini
does not affect OpenAI.
"""

from __future__ import annotations

import logging
from typing import Callable, TypeVar

import pybreaker
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    wait_random,
)

from nexus_agent.core.settings import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")

_breakers: dict[str, pybreaker.CircuitBreaker] = {}


class TransientError(Exception):
    """Raised by adapters to opt-in to retries."""


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, (TransientError, TimeoutError, ConnectionError, OSError)):
        return True
    name = exc.__class__.__name__.lower()
    msg  = str(exc).lower()
    # HTTP 429 / quota exceeded — treat as transient so tenacity retries with backoff.
    # Gemini free tier returns 429 after 15 req/min; the error message contains the
    # retry delay in seconds.  We mark it retryable so the exponential backoff kicks in.
    if (
        "429" in msg
        or "rate limit" in msg
        or "quota" in msg
        or "too many requests" in msg
        or "generativelanguage" in msg          # Gemini quota string
        or "resource_exhausted" in msg.replace(" ", "_")
    ):
        return True
    return "timeout" in name or "connection" in name


def get_breaker(name: str) -> pybreaker.CircuitBreaker:
    """Return (and lazily create) a circuit breaker for ``name``."""

    if name not in _breakers:
        settings = get_settings()
        _breakers[name] = pybreaker.CircuitBreaker(
            fail_max=settings.circuit_breaker_threshold,
            reset_timeout=settings.circuit_breaker_reset_seconds,
            name=name,
        )
    return _breakers[name]


def resilient_call(
    service: str,
    func: Callable[..., T],
    /,
    *args,
    **kwargs,
) -> T:
    """Invoke ``func`` with retries + per-service circuit breaker."""

    settings = get_settings()
    breaker = get_breaker(service)

    @retry(
        reraise=True,
        retry=retry_if_exception_type(
            (TransientError, TimeoutError, ConnectionError, OSError)
        ),
        stop=stop_after_attempt(max(1, settings.inference_max_retries)),
        # max=60 ensures the backoff is long enough to clear Gemini's 429
        # retry window (~35 s).  Previously max=10 meant retries fired too soon
        # and exhausted the quota even faster.
        wait=wait_exponential(multiplier=2, min=2, max=60) + wait_random(0, 5),
    )
    def _attempt() -> T:
        try:
            return breaker.call(func, *args, **kwargs)
        except pybreaker.CircuitBreakerError:
            logger.warning("circuit_open", extra={"service": service})
            raise
        except Exception as exc:
            if _retryable(exc):
                logger.info(
                    "retryable_error",
                    extra={"service": service, "error": exc.__class__.__name__},
                )
                raise TransientError(str(exc)) from exc
            raise

    return _attempt()
