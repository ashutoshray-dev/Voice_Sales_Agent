"""Call endpoints (F08/F09).

Provides:
- GET /calls?device_id=<id> - List calls for a device
- GET /calls/{call_id} - Get call details including analysis
- GET /calls/{call_id}/recording/url - Get signed playback URL
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.calls import create_call, end_call, get_call, list_calls
from app.services.storage import get_playback_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calls", tags=["calls"])


class CreateCallRequest(BaseModel):
    device_id: str
    call_id: str | None = None


class EndCallRequest(BaseModel):
    duration_sec: int
    status: str = "No Response"


@router.post("")
async def create_call_endpoint(request: CreateCallRequest) -> JSONResponse:
    """
    Create a new call record.

    Request body:
    - device_id: Required device identifier
    - call_id: Optional UUID (generated if not provided)

    Returns:
        { "call_id": "uuid" }
    """
    call_id = await create_call(request.device_id, request.call_id)

    if not call_id:
        raise HTTPException(status_code=500, detail="Failed to create call record")

    return JSONResponse(content={"call_id": call_id})


@router.patch("/{call_id}/end")
async def end_call_endpoint(
    call_id: Annotated[str, Path(description="Call UUID")],
    request: EndCallRequest,
) -> JSONResponse:
    """
    Mark a call as ended with duration and final status.

    Path params:
    - call_id: Call UUID

    Request body:
    - duration_sec: Call duration in seconds
    - status: Final call status (default: "No Response")

    Returns:
        { "success": true }
    """
    success = await end_call(call_id, request.duration_sec, request.status)

    if not success:
        raise HTTPException(status_code=404, detail="Call not found or update failed")

    return JSONResponse(content={"success": True})


@router.get("")
async def list_calls_endpoint(
    device_id: Annotated[str, Query(description="Device identifier")],
    limit: Annotated[int, Query(description="Maximum calls to return", ge=1, le=100)] = 100,
) -> JSONResponse:
    """
    List calls for a device.

    Query params:
    - device_id: Required device identifier
    - limit: Maximum calls to return (1-100, default 100)

    Returns:
        [
            {
                "id": "uuid",
                "device_id": "device-id",
                "started_at": "ISO timestamp",
                "ended_at": "ISO timestamp",
                "duration_sec": 123,
                "status": "Converted|Interested|...",
                "summary": {...},
                "recording_path": "device_id/call_id.webm" | null,
                "transcript": [...]
            },
            ...
        ]
    """
    calls = await list_calls(device_id, limit)
    return JSONResponse(content=calls)


@router.get("/{call_id}")
async def get_call_details(
    call_id: Annotated[str, Path(description="Call UUID")]
) -> JSONResponse:
    """
    Get call details including transcript, recording, and post-call analysis.

    Returns:
        {
            "id": "uuid",
            "device_id": "device-id",
            "status": "Converted|Interested|...",
            "summary": {...},  # Full CallAnalysis object
            "transcript": [...],
            "recording_path": "device_id/call_id.webm" | null,
            "created_at": "ISO timestamp"
        }
    """
    call = await get_call(call_id)

    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    return JSONResponse(content=call)


@router.get("/{call_id}/recording/url")
async def get_recording_playback_url(
    call_id: Annotated[str, Path(description="Call UUID")],
    device_id: Annotated[str, Query(description="Device identifier")]
) -> JSONResponse:
    """
    Get a signed URL for playback of a call recording.

    Query params:
    - device_id: Device identifier (required for path construction)

    Returns: { "url": "https://..." }
    """
    # Construct the path
    recording_path = f"{device_id}/{call_id}.webm"

    url = get_playback_url(recording_path)

    if not url:
        raise HTTPException(status_code=404, detail="Recording not found or URL generation failed")

    return JSONResponse(content={"url": url})