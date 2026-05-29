"""Prometheus metrics + ``/metrics`` exposition.

We register a tiny set of high-signal metrics here:

* ``nexus_http_requests_total``     — counter labelled by method, route, status.
* ``nexus_http_request_duration_seconds`` — histogram of request latency.
* ``nexus_inference_tokens_total``  — counter labelled by provider + direction.
* ``nexus_inference_cost_usd_total`` — counter labelled by provider + model.
* ``nexus_inference_errors_total``  — counter labelled by provider + reason.

The middleware automatically observes every HTTP request; inference metrics
are updated by :func:`record_inference_call`.
"""

from __future__ import annotations

import time
from typing import Awaitable, Callable

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response

HTTP_REQUESTS = Counter(
    "nexus_http_requests_total",
    "Total HTTP requests",
    labelnames=("method", "route", "status"),
)
HTTP_LATENCY = Histogram(
    "nexus_http_request_duration_seconds",
    "HTTP request latency in seconds",
    labelnames=("method", "route"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)
INFERENCE_TOKENS = Counter(
    "nexus_inference_tokens_total",
    "Total LLM tokens processed",
    labelnames=("provider", "model", "direction"),
)
INFERENCE_COST = Counter(
    "nexus_inference_cost_usd_total",
    "Cumulative LLM cost in USD",
    labelnames=("provider", "model"),
)
INFERENCE_ERRORS = Counter(
    "nexus_inference_errors_total",
    "LLM call failures",
    labelnames=("provider", "reason"),
)
INFERENCE_LATENCY = Histogram(
    "nexus_inference_latency_seconds",
    "End-to-end inference latency",
    labelnames=("provider", "model"),
    buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
)


def record_inference_call(
    *,
    provider: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_seconds: float,
    error: str | None = None,
) -> None:
    if error:
        INFERENCE_ERRORS.labels(provider=provider, reason=error).inc()
        return
    INFERENCE_TOKENS.labels(provider=provider, model=model, direction="in").inc(tokens_in)
    INFERENCE_TOKENS.labels(provider=provider, model=model, direction="out").inc(tokens_out)
    INFERENCE_COST.labels(provider=provider, model=model).inc(cost_usd)
    INFERENCE_LATENCY.labels(provider=provider, model=model).observe(latency_seconds)


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path) if route else request.url.path
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            elapsed = time.perf_counter() - start
            HTTP_LATENCY.labels(method=request.method, route=route_path).observe(elapsed)
            HTTP_REQUESTS.labels(
                method=request.method, route=route_path, status=str(status_code)
            ).inc()


async def metrics_endpoint(_: Request) -> Response:
    """ASGI handler returning the Prometheus exposition format."""

    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
