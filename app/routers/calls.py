"""Call endpoints (F08/F09).

Provides:
- GET /calls/{call_id} - Get call details including analysis
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import JSONResponse

from app.services.calls import get_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calls", tags=["calls"])


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