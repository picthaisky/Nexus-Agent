"""Approximate USD cost table for the LLM providers we support.

Pricing is best-effort and intentionally conservative — update from the vendor
docs when new models ship.  All numbers are USD per 1000 tokens.
"""

from __future__ import annotations

from dataclasses import dataclass

# (input USD per 1k tokens, output USD per 1k tokens)
_PRICING: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o": (0.005, 0.015),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4-turbo": (0.01, 0.03),
    "gpt-3.5-turbo": (0.0005, 0.0015),
    # Anthropic
    "claude-3-5-sonnet-20240620": (0.003, 0.015),
    "claude-3-opus-20240229": (0.015, 0.075),
    "claude-3-haiku-20240307": (0.00025, 0.00125),
    # Google Gemini
    "gemini-1.5-pro": (0.00125, 0.005),
    "gemini-1.5-flash": (0.000075, 0.0003),
    # Local — free
    "local": (0.0, 0.0),
}


@dataclass(frozen=True)
class CostEstimate:
    input_usd: float
    output_usd: float

    @property
    def total_usd(self) -> float:
        return self.input_usd + self.output_usd


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> CostEstimate:
    """Return a best-effort cost estimate for the call.  Unknown models cost $0."""

    # Allow partial-prefix matching for variants such as ``claude-3-5-sonnet-20240620``.
    key = model
    if key not in _PRICING:
        for pricing_key in _PRICING:
            if pricing_key != "local" and model.startswith(pricing_key):
                key = pricing_key
                break

    in_price, out_price = _PRICING.get(key, (0.0, 0.0))
    return CostEstimate(
        input_usd=(tokens_in / 1000.0) * in_price,
        output_usd=(tokens_out / 1000.0) * out_price,
    )
