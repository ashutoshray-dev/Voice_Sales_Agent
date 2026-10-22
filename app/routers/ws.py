"""WebSocket router for real-time conversation (F03).

Provides:
- /ws endpoint for text-based conversation streaming.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.conversation import Conversation
from app.services.llm import get_chat_model, with_retry
from app.services.tts import synthesize_sentence

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages active WebSocket connections and their conversations."""

    def __init__(self):
        self.active_connections: dict[str, tuple[WebSocket, Conversation]] = {}

    async def connect(self, websocket: WebSocket, client_id: str) -> Conversation:
        """Accept a new connection and create a conversation."""
        await websocket.accept()
        conversation = Conversation()
        self.active_connections[client_id] = (websocket, conversation)
        logger.info("Client %s connected. Total connections: %d", client_id, len(self.active_connections))
        return conversation

    def disconnect(self, client_id: str) -> None:
        """Remove a connection."""
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            logger.info("Client %s disconnected. Total connections: %d", client_id, len(self.active_connections))

    def get_conversation(self, client_id: str) -> Conversation | None:
        """Get conversation for a client."""
        conn = self.active_connections.get(client_id)
        return conn[1] if conn else None


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for conversation streaming.

    Message protocol (JSON):
    Client -> Server:
      - {type: "user_text", text: str, turn_id: str}
      - {type: "cancel"}
      - {type: "end"}

    Server -> Client:
      - {type: "delta", text: str}
      - {type: "sentence", text: str}
      - {type: "audio", chunk_b64: str}
      - {type: "tts_fallback"}
      - {type: "error", message: str}
      - {type: "done"}
      - {type: "cancelled"}
    """
    # Generate a simple client ID
    import uuid
    client_id = str(uuid.uuid4())[:8]

    conversation = await manager.connect(websocket, client_id)
    llm = get_chat_model()

    # Track if streaming is cancelled (barge-in)
    stream_cancelled = False

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = message.get("type")

            if msg_type == "user_text":
                text = message.get("text", "").strip()
                turn_id = message.get("turn_id", "")

                if not text:
                    await websocket.send_json({"type": "error", "message": "Empty text"})
                    continue

                # Add user message to conversation
                conversation.add_user(text)

                # Reset cancellation flag for new turn
                stream_cancelled = False

                # Stream reply (no retry on streaming - retries would duplicate tokens)
                async def stream_reply():
                    nonlocal stream_cancelled
                    buffer = ""
                    sentence_buffer = ""

                    async for chunk in llm.astream(conversation.messages()):
                        if stream_cancelled:
                            break
                        if chunk.content:
                            token = chunk.content
                            buffer += token
                            sentence_buffer += token

                            # Check for sentence boundary - buffer ends with punctuation
                            # This catches: ". ", "! ", "? ", and punctuation at end
                            if any(sentence_buffer.endswith(p) for p in [". ", "! ", "? ", ".\n", "!\n", "?\n"]):
                                # Send full accumulated text so frontend can replace entire bubble
                                sentence_text = buffer.strip()
                                await websocket.send_json({"type": "sentence", "text": sentence_text})
                                await _stream_tts_for_sentence(websocket, sentence_buffer.strip())
                                sentence_buffer = ""
                            elif sentence_buffer.rstrip().endswith((".", "!", "?")):
                                # Also split on punctuation at end (e.g., "Hi!" followed by " I'm...")
                                sentence_text = buffer.strip()
                                await websocket.send_json({"type": "sentence", "text": sentence_text})
                                await _stream_tts_for_sentence(websocket, sentence_buffer.strip())
                                sentence_buffer = ""

                    return buffer

                try:
                    full_reply = await stream_reply()

                    # Format final reply for speech and add to history
                    from app.services.prompt_builder import format_for_speech
                    formatted = format_for_speech(full_reply, max_sentences=3)
                    if formatted:
                        conversation.add_assistant(formatted)

                    await websocket.send_json({"type": "done", "turn_id": turn_id})

                except Exception as e:
                    logger.exception("Stream error for client %s", client_id)
                    error_msg = str(e).lower()
                    if "429" in error_msg or "rate limit" in error_msg or "too many requests" in error_msg:
                        await websocket.send_json({
                            "type": "error",
                            "message": "I'm getting a lot of requests right now. Could you repeat that?"
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Something went wrong. Please try again."
                        })

            elif msg_type == "cancel":
                # Barge-in DISABLED: ignore cancel messages
                # logger.info("Client %s sent cancel (barge-in)", client_id)
                # stream_cancelled = True
                # await websocket.send_json({"type": "cancelled"})
                pass

            elif msg_type == "reprompt":
                # Silence timeout re-prompt from client (F05)
                logger.info("Client %s requested re-prompt", client_id)
                # Add a system message to trigger a gentle re-prompt
                conversation.add_user("[System: The customer has been silent. Gently re-prompt them.]")

                # Stream a brief re-prompt reply
                stream_cancelled = False

                async def stream_reprompt():
                    nonlocal stream_cancelled
                    buffer = ""
                    sentence_buffer = ""

                    async for chunk in llm.astream(conversation.messages()):
                        if stream_cancelled:
                            break
                        if chunk.content:
                            token = chunk.content
                            buffer += token
                            sentence_buffer += token

                            # Check for sentence boundary - buffer ends with punctuation
                            # This catches: ". ", "! ", "? ", and punctuation at end
                            if any(sentence_buffer.endswith(p) for p in [". ", "! ", "? ", ".\n", "!\n", "?\n"]):
                                # Send full accumulated text so frontend can replace entire bubble
                                sentence_text = buffer.strip()
                                await websocket.send_json({"type": "sentence", "text": sentence_text})
                                await _stream_tts_for_sentence(websocket, sentence_buffer.strip())
                                sentence_buffer = ""
                            elif sentence_buffer.rstrip().endswith((".", "!", "?")):
                                # Also split on punctuation at end (e.g., "Hi!" followed by " I'm...")
                                sentence_text = buffer.strip()
                                await websocket.send_json({"type": "sentence", "text": sentence_text})
                                await _stream_tts_for_sentence(websocket, sentence_buffer.strip())
                                sentence_buffer = ""

                    return buffer

                try:
                    full_reply = await stream_reprompt()

                    # Format final reply for speech
                    from app.services.prompt_builder import format_for_speech
                    formatted = format_for_speech(full_reply, max_sentences=2)
                    if formatted:
                        conversation.add_assistant(formatted)

                    await websocket.send_json({"type": "done", "turn_id": message.get("turn_id", "")})

                except Exception as e:
                    logger.exception("Reprompt stream error for client %s", client_id)
                    error_msg = str(e).lower()
                    if "429" in error_msg or "rate limit" in error_msg or "too many requests" in error_msg:
                        await websocket.send_json({
                            "type": "error",
                            "message": "I'm getting a lot of requests right now. Could you repeat that?"
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Something went wrong. Please try again."
                        })

            elif msg_type == "end":
                # Persist transcript (F08) - includes reason for "no_response" status
                reason = message.get("reason", "")
                logger.info("Client %s ended conversation: %s", client_id, reason)
                await websocket.send_json({"type": "done"})
                break

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        logger.info("Client %s disconnected", client_id)
    except Exception as e:
        logger.exception("WebSocket error for client %s", client_id)
    finally:
        manager.disconnect(client_id)


async def _stream_tts_for_sentence(websocket: WebSocket, sentence: str) -> None:
    """Stream TTS audio for a single sentence via WebSocket.

    Accumulates all MP3 chunks for the sentence and sends as a single base64 blob.
    This prevents audio breaking caused by many small 720-byte chunks.
    If edge-tts fails, sends {type: "tts_fallback"}.
    """
    try:
        # Accumulate all audio chunks for this sentence
        audio_chunks = []
        async for chunk in synthesize_sentence(sentence):
            # synthesize_sentence yields bytes directly (audio data)
            if chunk:
                audio_chunks.append(chunk)

        # Send complete MP3 as single base64 chunk
        if audio_chunks:
            import base64
            complete_audio = b"".join(audio_chunks)
            chunk_b64 = base64.b64encode(complete_audio).decode("ascii")
            # Check if WebSocket is still open
            if websocket.client_state.name != "CONNECTED":
                return
            await websocket.send_json({"type": "audio", "chunk_b64": chunk_b64})
        else:
            logger.warning("No audio chunks generated for sentence: %s", sentence[:50])

    except Exception as e:
        logger.warning("TTS failed for sentence, sending fallback: %s", e)
        await websocket.send_json({"type": "tts_fallback"})