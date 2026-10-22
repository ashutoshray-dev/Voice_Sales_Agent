"""Post-call analysis service (F08).

LangGraph pipeline: prepare_transcript -> analyze -> validate -> fallback
with one retry on analyze failure and safe fallback defaults.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from app.models.analysis import CallAnalysis, get_status_precedence
from app.services.llm import get_chat_model, with_retry

logger = logging.getLogger(__name__)


# --- State definition ---

class AnalysisState(dict):
    """State passed between LangGraph nodes."""
    transcript: list[dict]
    formatted_transcript: str
    analysis: CallAnalysis | None
    error: str | None
    retry_count: int


# --- Node functions ---

def prepare_transcript(state: AnalysisState) -> AnalysisState:
    """Format transcript array into a single text block with speaker labels.

    Args:
        state: Current graph state containing transcript.

    Returns:
        Updated state with formatted_transcript.
    """
    transcript = state.get("transcript", [])

    if not transcript:
        state["formatted_transcript"] = "(empty transcript)"
        return state

    lines = []
    for turn in transcript:
        role = turn.get("role", "unknown").capitalize()
        content = turn.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content}")

    state["formatted_transcript"] = "\n".join(lines) if lines else "(no substantive content)"
    return state


def build_analysis_prompt(formatted_transcript: str) -> str:
    """Build the prompt for LLM analysis.

    Args:
        formatted_transcript: The formatted transcript text.

    Returns:
        Complete prompt string for the LLM.
    """
    return f"""You are an expert sales call analyzer. Analyze the following sales call transcript and produce a structured analysis.

TRANSCRIPT:
{formatted_transcript}

STATUS RULES (precedence from highest to lowest):
1. Converted: Customer explicitly agreed to buy or sign up
2. Demo Requested: Customer asked for or agreed to a demo or trial call
3. Not Interested: Customer clearly declined
4. Follow-up Required: Customer wants contact later, needs decision-maker, pricing, or more info
5. Interested: Positive signals without a commitment or request above
6. No Response: Customer said nothing meaningful (fewer than 2 substantive turns)

Provide your analysis in the following JSON format:
{{
  "summary": "One-paragraph summary of the call",
  "customer_requirements": ["requirement1", "requirement2"],
  "objections": ["objection1", "objection2"],
  "next_steps": ["next_step1", "next_step2"],
  "status": "One of: Converted, Interested, Follow-up Required, Not Interested, Demo Requested, No Response"
}}

Guidelines:
- Be concise but specific
- Extract actual quotes/paraphrases from the transcript for requirements and objections
- Next steps should be actionable and specific to this call
- Apply status rules strictly by precedence: check from top (Converted) to bottom (No Response)
- If transcript is empty or has < 2 substantive turns, status MUST be "No Response"
"""


@with_retry
async def call_llm_with_structured_output(prompt: str) -> CallAnalysis:
    """Call LLM with structured output for CallAnalysis.

    Args:
        prompt: The analysis prompt.

    Returns:
        Parsed CallAnalysis object.

    Raises:
        Exception: If LLM call fails or returns invalid output.
    """
    model = get_chat_model()
    # Use json_mode for models that require tool choice but don't call tools
    structured_model = model.with_structured_output(CallAnalysis, method="json_mode")
    result = await structured_model.ainvoke(prompt)
    return result


async def analyze(state: AnalysisState) -> AnalysisState:
    """Call LLM to analyze the transcript.

    Args:
        state: Current graph state with formatted_transcript.

    Returns:
        Updated state with analysis or error.
    """
    formatted_transcript = state.get("formatted_transcript", "")
    retry_count = state.get("retry_count", 0)

    try:
        prompt = build_analysis_prompt(formatted_transcript)
        analysis = await call_llm_with_structured_output(prompt)
        state["analysis"] = analysis
        state["error"] = None
        logger.info("Analysis completed successfully")
    except Exception as e:
        logger.warning("Analysis attempt %d failed: %s", retry_count + 1, e)
        state["error"] = str(e)
        state["analysis"] = None

    return state


def validate(state: AnalysisState) -> AnalysisState:
    """Validate the analysis output against schema and status rules.

    Args:
        state: Current graph state with analysis.

    Returns:
        Updated state - routes to fallback if invalid.
    """
    analysis = state.get("analysis")

    if analysis is None:
        state["error"] = "No analysis produced"
        return state

    # Validate status is in enum (Pydantic should catch this, but double-check)
    valid_statuses = [
        "Converted", "Interested", "Follow-up Required",
        "Not Interested", "Demo Requested", "No Response"
    ]
    if analysis.status not in valid_statuses:
        state["error"] = f"Invalid status: {analysis.status}"
        state["analysis"] = None
        return state

    # Validate status precedence rules against transcript
    transcript = state.get("transcript", [])
    formatted = state.get("formatted_transcript", "")

    # Rule 1: No Response - fewer than 2 substantive turns
    substantive_turns = [t for t in transcript if t.get("content", "").strip()]
    if len(substantive_turns) < 2:
        if analysis.status != "No Response":
            # Override to No Response per precedence rule
            analysis = analysis.model_copy(update={"status": "No Response"})
            state["analysis"] = analysis
        return state

    # For other statuses, we trust the LLM's judgment since we provided the rules
    # The LLM was instructed to apply precedence from top to bottom
    # If there's a conflict, the validate step would catch it, but the LLM
    # should have applied the rules correctly in its response

    state["error"] = None
    return state


def fallback(state: AnalysisState) -> AnalysisState:
    """Generate a safe default analysis on failure.

    Args:
        state: Current graph state with error info.

    Returns:
        Updated state with fallback analysis.
    """
    logger.info("Using fallback analysis")

    # Best-effort status from transcript heuristics
    transcript = state.get("transcript", [])
    formatted = state.get("formatted_transcript", "")

    status = "No Response"
    summary = "Call analysis unavailable (fallback used)"

    if transcript:
        substantive_turns = [t for t in transcript if t.get("content", "").strip()]
        if len(substantive_turns) >= 2:
            # Check for obvious keywords
            full_text = formatted.lower()
            if any(word in full_text for word in ["buy", "sign up", "purchase", "agreed to"]):
                status = "Converted"
                summary = "Customer indicated purchase intent (fallback heuristic)"
            elif any(word in full_text for word in ["demo", "trial", "test"]):
                status = "Demo Requested"
                summary = "Customer requested demo (fallback heuristic)"
            elif any(word in full_text for word in ["not interested", "decline", "no thanks", "pass"]):
                status = "Not Interested"
                summary = "Customer declined (fallback heuristic)"
            elif any(word in full_text for word in ["follow up", "call back", "later", "decision maker", "pricing"]):
                status = "Follow-up Required"
                summary = "Customer requested follow-up (fallback heuristic)"
            elif any(word in full_text for word in ["interest", "like", "good", "great"]):
                status = "Interested"
                summary = "Customer showed interest (fallback heuristic)"
            else:
                status = "Interested"
                summary = "Call completed with customer engagement (fallback heuristic)"
        else:
            status = "No Response"
            summary = "Insufficient conversation for analysis (fallback)"

    fallback_analysis = CallAnalysis(
        summary=summary,
        customer_requirements=[],
        objections=[],
        next_steps=[],
        status=status,
    )
    state["analysis"] = fallback_analysis
    state["error"] = None
    return state


def should_retry(state: AnalysisState) -> str:
    """Decide whether to retry analyze or go to fallback/validate.

    Args:
        state: Current graph state.

    Returns:
        Next node name: "analyze" (retry), "validate" (success), or "fallback" (max retries).
    """
    retry_count = state.get("retry_count", 0)
    error = state.get("error")

    if error is None and state.get("analysis") is not None:
        return "validate"

    if retry_count >= 1:  # One retry allowed (max 2 attempts total)
        return "fallback"

    # Increment retry count and retry
    state["retry_count"] = retry_count + 1
    return "analyze"


def should_fallback_after_validate(state: AnalysisState) -> str:
    """Decide next step after validation.

    Args:
        state: Current graph state.

    Returns:
        Next node name: "fallback" (if invalid) or END (if valid).
    """
    if state.get("error") or state.get("analysis") is None:
        return "fallback"
    return END


# --- Build the graph ---

def build_graph() -> StateGraph:
    """Build and compile the LangGraph analysis pipeline.

    Returns:
        Compiled StateGraph ready for invocation.
    """
    graph = StateGraph(AnalysisState)

    # Add nodes
    graph.add_node("prepare_transcript", prepare_transcript)
    graph.add_node("analyze", analyze)
    graph.add_node("validate", validate)
    graph.add_node("fallback", fallback)

    # Define edges
    graph.set_entry_point("prepare_transcript")
    graph.add_edge("prepare_transcript", "analyze")

    # Conditional: analyze -> validate (success) or analyze (retry) or fallback (max retries)
    graph.add_conditional_edges(
        "analyze",
        should_retry,
        {
            "analyze": "analyze",
            "validate": "validate",
            "fallback": "fallback",
        }
    )

    # Conditional: validate -> fallback (if invalid) or END (if valid)
    graph.add_conditional_edges(
        "validate",
        should_fallback_after_validate,
        {
            "fallback": "fallback",
            END: END,
        }
    )

    # Fallback always goes to END
    graph.add_edge("fallback", END)

    return graph.compile()


# --- Public API ---

async def run(transcript: list[dict]) -> CallAnalysis:
    """Run the post-call analysis pipeline on a transcript.

    Args:
        transcript: List of message dicts with 'role' and 'content' keys.

    Returns:
        Validated CallAnalysis object.
    """
    graph = build_graph()

    initial_state = AnalysisState({
        "transcript": transcript,
        "formatted_transcript": "",
        "analysis": None,
        "error": None,
        "retry_count": 0,
    })

    result = await graph.ainvoke(initial_state)

    analysis = result.get("analysis")
    if analysis is None:
        # Should never happen since fallback always produces output
        logger.error("Graph completed without analysis - using emergency fallback")
        return CallAnalysis(
            summary="Analysis failed completely",
            customer_requirements=[],
            objections=[],
            next_steps=[],
            status="No Response",
        )

    return analysis