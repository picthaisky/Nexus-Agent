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
    msg = str(exc).lower()

    # ── PERMANENT billing / account errors ────────────────────────────────────
    # These will never succeed on retry with the same key — fall through to
    # the next provider immediately (do NOT retry same provider).
    _PERMANENT = (
        "insufficient_quota",
        "billing_hard_limit_reached",
        "account has been suspended",
        "account suspended",
        "no payment method",
        "payment required",
        "exceeded your current quota",  # OpenAI billing message
        "you have no api keys",
    )
    if any(k in msg for k in _PERMANENT):
        return False

    # ── Transient infrastructure errors ──────────────────────────────────────
    if isinstance(exc, (TransientError, TimeoutError, ConnectionError, OSError)):
        return True

    name = exc.__class__.__name__.lower()

    # HTTP 429 RATE-LIMIT (different from billing quota) — retryable with backoff
    # Gemini free tier: "quota exceeded for metric: …free_tier_requests, limit: 15"
    # OpenAI rate limit: "rate limit reached for …"
    if (
        ("429" in msg and "insufficient_quota" not in msg)
        or "rate limit" in msg
        or "too many requests" in msg
        or "generativelanguage" in msg          # Gemini rate-limit quota string
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
