"""Storage service for call recordings (F07).

Uploads recordings to Supabase Storage bucket 'recordings'.
Provides signed URLs for playback.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.config import get_supabase, get_supabase_admin

logger = logging.getLogger(__name__)

RECORDINGS_BUCKET = "recordings"


async def ensure_bucket_exists() -> bool:
    """Ensure the recordings bucket exists. Returns True if bucket exists or was created."""
    # Try admin client first for bucket creation (requires service role key)
    supabase = get_supabase_admin()
    if not supabase:
        # Fallback to anon client - may work if bucket already exists
        supabase = get_supabase()
        if not supabase:
            logger.warning("Supabase not configured, cannot ensure bucket")
            return False

    try:
        # List buckets to check if recordings exists
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]

        if RECORDINGS_BUCKET not in bucket_names:
            # Create the bucket - requires admin client
            admin = get_supabase_admin()
            if not admin:
                logger.error("Service role key required to create bucket. Bucket 'recordings' does not exist.")
                return False
            admin.storage.create_bucket(RECORDINGS_BUCKET, options={"public": False})
            logger.info("Created recordings bucket")

        return True
    except Exception as e:
        logger.error("Failed to ensure recordings bucket: %s", e)
        return False


async def upload_recording(call_id: str, blob_bytes: bytes, device_id: str) -> Optional[str]:
    """
    Upload a recording to Supabase Storage.

    Args:
        call_id: Unique call identifier
        blob_bytes: Audio data as bytes (webm/opus)
        device_id: Device identifier for path organization

    Returns:
        Recording path (e.g., "device_id/call_id.webm") or None on failure
    """
    # Use admin client for uploads (requires service role key for storage writes)
    supabase = get_supabase_admin()
    if not supabase:
        logger.error("Service role key not configured, cannot upload recording")
        return None

    # Ensure bucket exists
    bucket_ok = await ensure_bucket_exists()
    logger.info("Bucket ensure result for call %s: %s", call_id, bucket_ok)
    if not bucket_ok:
        return None

    # Path: {device_id}/{call_id}.webm
    path = f"{device_id}/{call_id}.webm"

    try:
        # Upload to Supabase Storage
        logger.info("Uploading recording to path: %s, size: %d bytes", path, len(blob_bytes))
        result = supabase.storage.from_(RECORDINGS_BUCKET).upload(
            path=path,
            file=blob_bytes,
            file_options={
                "content-type": "audio/webm",
                "upsert": True,  # Overwrite if exists
            },
        )

        # Check result
        logger.info("Supabase upload result: %s", result)
        if hasattr(result, "error") and result.error:
            logger.error("Supabase upload error: %s", result.error)
            return None

        logger.info("Recording uploaded: %s", path)
        return path

    except Exception as e:
        logger.exception("Failed to upload recording for call %s", call_id)
        return None


def get_playback_url(recording_path: str, expires_in: int = 3600) -> Optional[str]:
    """
    Get a signed URL for playback of a recording.

    Args:
        recording_path: Path returned by upload_recording
        expires_in: URL expiration in seconds (default 1 hour)

    Returns:
        Signed URL or None on failure
    """
    # Use admin client for signed URL creation
    supabase = get_supabase_admin()
    if not supabase:
        logger.error("Service role key not configured, cannot create playback URL")
        return None

    try:
        # Create signed URL
        result = supabase.storage.from_(RECORDINGS_BUCKET).create_signed_url(
            path=recording_path,
            expires_in=expires_in,
        )

        if hasattr(result, "error") and result.error:
            logger.error("Failed to create signed URL: %s", result.error)
            return None

        # Result format varies; handle both dict and object
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl")
        return getattr(result, "signed_url", None) or getattr(result, "signedURL", None)

    except Exception as e:
        logger.exception("Failed to create signed URL for %s", recording_path)
        return None