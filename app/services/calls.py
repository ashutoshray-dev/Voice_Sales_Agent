"""Calls database service (F08/F09).

Provides database operations for the calls table including saving analysis results.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.config import get_supabase
from app.models.analysis import CallAnalysis

logger = logging.getLogger(__name__)


async def save_analysis(call_id: str, analysis: CallAnalysis) -> bool:
    """Save call analysis to the calls table.

    Updates the call row with summary (jsonb) and status.

    Args:
        call_id: The call UUID.
        analysis: The CallAnalysis object to save.

    Returns:
        True if saved successfully, False otherwise.
    """
    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not configured, cannot save analysis")
        return False

    try:
        # Prepare the update data
        update_data = {
            "summary": analysis.model_dump(),  # Full analysis as JSONB
            "status": analysis.status,
        }

        # Update the call row
        result = supabase.table("calls").update(update_data).eq("id", call_id).execute()

        if hasattr(result, "error") and result.error:
            logger.error("Supabase update error: %s", result.error)
            return False

        # Check if any row was updated
        if not result.data or len(result.data) == 0:
            logger.warning("No call found with id %s to update", call_id)
            return False

        logger.info("Analysis saved for call %s with status %s", call_id, analysis.status)
        return True

    except Exception as e:
        logger.exception("Failed to save analysis for call %s", call_id)
        return False


async def get_call(call_id: str) -> Optional[dict[str, Any]]:
    """Retrieve a call by ID including analysis data.

    Args:
        call_id: The call UUID.

    Returns:
        Call dict with analysis fields, or None if not found.
    """
    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not configured, cannot get call")
        return None

    try:
        result = supabase.table("calls").select("*").eq("id", call_id).single().execute()

        if hasattr(result, "error") and result.error:
            logger.error("Supabase select error: %s", result.error)
            return None

        return result.data if result.data else None

    except Exception as e:
        logger.exception("Failed to get call %s", call_id)
        return None


async def create_call(device_id: str, call_id: str | None = None) -> Optional[str]:
    """Create a new call record.

    Args:
        device_id: The device identifier.
        call_id: Optional UUID (generated if not provided).

    Returns:
        The call_id if created, None on failure.
    """
    import uuid

    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not configured, cannot create call")
        return None

    call_id = call_id or str(uuid.uuid4())

    try:
        result = supabase.table("calls").insert({
            "id": call_id,
            "device_id": device_id,
            "status": "In Progress",
            "summary": None,
            "transcript": [],
            "recording_path": None,
        }).execute()

        if hasattr(result, "error") and result.error:
            logger.error("Supabase insert error: %s", result.error)
            return None

        if result.data and len(result.data) > 0:
            logger.info("Call created: %s", call_id)
            return call_id

        return None

    except Exception as e:
        logger.exception("Failed to create call")
        return None


async def update_call_transcript(call_id: str, transcript: list[dict]) -> bool:
    """Update the transcript for a call.

    Args:
        call_id: The call UUID.
        transcript: List of message dicts.

    Returns:
        True if updated successfully.
    """
    supabase = get_supabase()
    if not supabase:
        return False

    try:
        result = supabase.table("calls").update({"transcript": transcript}).eq("id", call_id).execute()
        return not (hasattr(result, "error") and result.error)
    except Exception as e:
        logger.exception("Failed to update transcript for call %s", call_id)
        return False


async def update_call_recording(call_id: str, recording_path: str) -> bool:
    """Update the recording path for a call.

    Args:
        call_id: The call UUID.
        recording_path: Path to the recording in storage.

    Returns:
        True if updated successfully.
    """
    supabase = get_supabase()
    if not supabase:
        return False

    try:
        result = supabase.table("calls").update({"recording_path": recording_path}).eq("id", call_id).execute()
        return not (hasattr(result, "error") and result.error)
    except Exception as e:
        logger.exception("Failed to update recording for call %s", call_id)
        return False


async def end_call(call_id: str, duration_sec: int, status: str = "No Response") -> bool:
    """Mark a call as ended with duration and final status.

    Args:
        call_id: The call UUID.
        duration_sec: Call duration in seconds.
        status: Final call status (default: "No Response").

    Returns:
        True if updated successfully.
    """
    supabase = get_supabase()
    if not supabase:
        return False

    try:
        result = supabase.table("calls").update({
            "ended_at": "now()",
            "duration_sec": duration_sec,
            "status": status,
        }).eq("id", call_id).execute()
        return not (hasattr(result, "error") and result.error)
    except Exception as e:
        logger.exception("Failed to end call %s", call_id)
        return False


async def list_calls(device_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """List calls for a device, ordered by started_at descending.

    Args:
        device_id: The device identifier.
        limit: Maximum number of calls to return (default 100).

    Returns:
        List of call dicts with: id, started_at, ended_at, duration_sec, status,
        summary, recording_path, transcript
    """
    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not configured, cannot list calls")
        return []

    try:
        result = (
            supabase.table("calls")
            .select("id,device_id,started_at,ended_at,duration_sec,status,summary,recording_path,transcript,error")
            .eq("device_id", device_id)
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )

        if hasattr(result, "error") and result.error:
            logger.error("Supabase select error: %s", result.error)
            return []

        return result.data if result.data else []

    except Exception as e:
        logger.exception("Failed to list calls for device %s", device_id)
        return []