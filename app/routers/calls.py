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

from app.services.calls import get_call, list_calls
from app.services.storage import get_playback_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calls", tags=["calls"])


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