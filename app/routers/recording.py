"""Recording endpoints (F07).

Provides:
- POST /calls/{call_id}/recording - Upload recording blob
- GET /calls/{call_id}/recording/url - Get signed playback URL
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.services.storage import get_playback_url, upload_recording
from app.services.calls import update_call_recording

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calls", tags=["recordings"])


@router.post("/{call_id}/recording")
async def upload_call_recording(
    call_id: str,
    file: Annotated[UploadFile, File(description="Audio recording (webm/opus)")],
    device_id: Annotated[str, Form(description="Device identifier")],
) -> JSONResponse:
    """
    Upload a call recording.

    Expects multipart/form-data with:
    - file: audio/webm blob
    - device_id: string identifier for the device

    Returns: { "recording_path": "device_id/call_id.webm" }
    """
    # Validate file type
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="File must be an audio file")

    try:
        # Read file content
        blob_bytes = await file.read()

        if not blob_bytes:
            raise HTTPException(status_code=400, detail="Empty file")

        # Upload to Supabase
        recording_path = await upload_recording(call_id, blob_bytes, device_id)

        if not recording_path:
            # Storage might be unavailable - don't crash the call
            logger.warning("Recording upload failed for call %s (storage unavailable)", call_id)
            return JSONResponse(
                status_code=503,
                content={
                    "recording_path": None,
                    "error": "recording_upload_failed",
                    "message": "Recording storage temporarily unavailable",
                },
            )

        # Save recording path to database
        await update_call_recording(call_id, recording_path)

        return JSONResponse(content={"recording_path": recording_path})

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error uploading recording for call %s", call_id)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{call_id}/recording/url")
async def get_recording_playback_url(call_id: str, device_id: str) -> JSONResponse:
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