"""Pydantic models for post-call analysis (F08).

Defines the structured output schema for LLM analysis of call transcripts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CallAnalysis(BaseModel):
    """Structured analysis result for a completed sales call.

    Attributes:
        summary: One-paragraph summary of the call.
        customer_requirements: List of requirements/needs expressed by the customer.
        objections: List of objections raised by the customer.
        next_steps: List of agreed or recommended next actions.
        status: Call outcome status from the 6-value enum (precedence ordered).
    """

    summary: str = Field(..., description="Brief summary of the call")
    customer_requirements: list[str] = Field(
        default_factory=list, description="Customer's stated requirements"
    )
    objections: list[str] = Field(
        default_factory=list, description="Objections raised by the customer"
    )
    next_steps: list[str] = Field(
        default_factory=list, description="Agreed or recommended next steps"
    )
    status: Literal[
        "Converted",
        "Interested",
        "Follow-up Required",
        "Not Interested",
        "Demo Requested",
        "No Response",
    ] = Field(..., description="Call outcome status")

    model_config = {
        "extra": "forbid",
        "use_enum_values": True,
    }


# Status precedence for validation (higher index = higher precedence)
STATUS_PRECEDENCE = [
    "No Response",
    "Interested",
    "Follow-up Required",
    "Not Interested",
    "Demo Requested",
    "Converted",
]


def get_status_precedence(status: str) -> int:
    """Return precedence index for a status (higher = more important)."""
    try:
        return STATUS_PRECEDENCE.index(status)
    except ValueError:
        return -1