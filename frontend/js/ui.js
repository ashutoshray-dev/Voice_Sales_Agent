/** ui.js — renders the call screen and handles UI events.
 *
 * Exports:
 * - initUI(callState, wsClient): initializes the call view, returns cleanup fn
 * - dispatch(eventName, detail): emits custom events on window
 */
import { callState } from "./state.js";
import { SttEngine, showCompatibilityBanner, showMicDeniedBanner, showSttErrorBanner, clearSttBanners, createInterimRow, replaceInterimWithFinal } from "./stt.js";
import { ttsPlayer, speechSynthesisFallback, setWsClient } from "./tts-player.js";
import { createConsentManager } from "./consent.js";
import { createRecorder, isRecordingSupported } from "./recorder.js";

let wsClient = null;
let timerInterval = null;
let timerSeconds = 0;
let botMessageEl = null; // current bot message element for streaming
let cleanupFns = [];
let sttEngine = null;
let sttInitialized = false;
let fallbackNoticeShown = false;
let consentManager = null;
let recorder = null;
let micStream = null;

/** State label mapping for the status pill */
const STATE_LABELS = {
  idle: "Idle",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  ended: "Ended",
  error: "Error",
};

/** Initialize the call UI. Call once on page load. */
export function initUI(state, ws) {
  wsClient = ws;
  window.__CALL_STATE__ = state; // Store for message handlers

  // Set up TTS player with WebSocket reference for barge-in cancel
  setWsClient(wsClient);

  // Register message handlers immediately
  wsClient.onMessage(handleServerMessage);
  wsClient.onClose(handleClose);

  // Cache DOM elements
  const startBtn = document.getElementById("startBtn");
  const endBtn = document.getElementById("endBtn");
  const statusPill = document.getElementById("statusPill");
  const durationEl = document.getElementById("duration");
  const msgInput = document.getElementById("msgInput");
  const msgForm = document.getElementById("msgForm");
  const chatEl = document.getElementById("chat");
  const callView = document.getElementById("call-view");
  const controlsEl = document.getElementById("controls");

  // Add mute/volume controls
  addCallControls(controlsEl);

  // Initialize consent manager
  consentManager = createConsentManager();

  // Initialize STT engine
  sttEngine = new SttEngine({ wsClient, stateRef: state });

  // Check STT support and show banner if needed
  if (!sttEngine.isSupported()) {
    showCompatibilityBanner(callView);
    // Disable STT-related features but keep typed input working
    msgInput.placeholder = "Type a message…";
  } else {
    msgInput.placeholder = "Type a message… (or speak)";

    // Set up STT callbacks
    sttEngine.onInterim((text) => {
      createInterimRow(chatEl, text);
      // Barge-in DISABLED: let bot complete speaking before user can respond
      // if (ttsPlayer.isPlaying) {
      //   ttsPlayer.stop();
      //   speechSynthesisFallback.cancel();
      // }
    });

    sttEngine.onFinal(({ text, turnId }) => {
      replaceInterimWithFinal(chatEl, text);
      // Barge-in DISABLED: let bot complete speaking before user can respond
      // if (ttsPlayer.isPlaying) {
      //   ttsPlayer.stop();
      //   speechSynthesisFallback.cancel();
      // }
      // SttEngine#sendToServer already sends the transcript; no duplicate send here
      if (state.getState() === "listening") {
        state.transition("thinking");
      }
      dispatch("message:send", { text, turnId });
    });

    sttEngine.onError((error) => {
      console.error("[UI] STT Error:", error);
      if (error.code === "not-allowed") {
        showMicDeniedBanner(callView);
      } else if (error.code !== "no-speech" && error.code !== "aborted") {
        showSttErrorBanner(callView, error.message);
      }
      // Fall back to typed input - STT engine stops, but UI continues working
    });

    sttInitialized = true;
  }

  // Subscribe to state changes
  cleanupFns.push(state.onchange((newState) => {
    updateStatusPill(statusPill, newState);
    updateButtons(startBtn, endBtn, newState);
    if (newState === "connecting") {
      startTimer(durationEl);
    } else if (newState === "ended" || newState === "error") {
      stopTimer(durationEl);
    }
    // Handle STT state transitions
    if (sttInitialized) {
      if (newState === "listening") {
        // Start STT if not already running
        // Add a small delay to prevent residual audio from triggering STT
        setTimeout(() => {
          if (state.getState() === "listening") {
            sttEngine.start();
            sttEngine.startSilenceTimer();
          }
        }, 500);
      } else if (newState === "speaking") {
        // Bot is speaking - stop STT to prevent feedback loop
        sttEngine.stop();
      } else if (newState === "thinking") {
        // Bot is thinking - cancel silence timer but keep STT stopped
        sttEngine.cancelSilenceTimer();
      } else if (newState === "ended" || newState === "error") {
        // Call ended - stop STT
        sttEngine.stop();
      }
    }
  }));

  // Start Call button - show consent modal first
  startBtn.addEventListener("click", async () => {
    try {
      // Show consent modal and wait for user decision
      const consentGranted = await consentManager.show();

      if (!consentGranted) {
        consentManager.recordConsent(false);
      }

      // Get microphone stream first
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.error("[UI] Microphone access denied:", e);
        appendMessage(chatEl, "bot", "⚠️ Microphone access denied. Please enable microphone permissions and try again.");
        state.transition("error");
        return;
      }

      state.setCallId(crypto.randomUUID());
      state.transition("connecting");
      await wsClient.connect();
      state.transition("listening");

      // Start recording if consent was granted
      if (consentGranted && isRecordingSupported()) {
        // Get bot audio element from TTS player (we'll need to expose this)
        // For now, we'll connect the recorder after TTS starts playing
        recorder = createRecorder({ consentGiven: true });
        // We'll start the recorder when we have both mic stream and bot audio
        // The bot audio will be available when TTS player plays the first chunk
      }

      dispatch("call:start");
    } catch (e) {
      console.error("[UI] Start call failed:", e);
      state.transition("error");
    }
  });

  // End Call button
  endBtn.addEventListener("click", () => {
    if (state.getState() === "ended") return; // no-op on double click
    endCall(state);
  });

  // Message form submit
  msgForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    sendUserMessage(text, state);
    msgInput.value = "";
  });

  // Initial render
  updateStatusPill(statusPill, state.getState());
  updateButtons(startBtn, endBtn, state.getState());

  // Return cleanup function
  return () => {
    for (const fn of cleanupFns) fn();
    stopTimer(durationEl);
    if (sttEngine) {
      sttEngine.stop();
    }
    wsClient.close();
    clearSttBanners(callView);
  };
}

/** Update status pill text and styling */
function updateStatusPill(el, state) {
  if (!el) return;
  el.textContent = STATE_LABELS[state] ?? state;
  el.className = "status-pill " + state;
}

/** Update button enabled/disabled state */
function updateButtons(startBtn, endBtn, state) {
  if (!startBtn || !endBtn) return;

  const isIdle = state === "idle";
  const isEnded = state === "ended";
  const isConnecting = state === "connecting";

  startBtn.disabled = !isIdle;
  endBtn.disabled = isIdle || isEnded || isConnecting;
}

/** Start the call timer */
function startTimer(durationEl) {
  timerSeconds = 0;
  updateTimerDisplay(durationEl);
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay(durationEl);
  }, 1000);
}

/** Stop the call timer */
function stopTimer(_durationEl) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/** Update timer display (MM:SS) */
function updateTimerDisplay(el) {
  if (!el) return;
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, "0");
  const s = String(timerSeconds % 60).padStart(2, "0");
  el.textContent = `${m}:${s}`;
}

/** Send user message via WebSocket */
function sendUserMessage(text, state) {
  const turnId = crypto.randomUUID();
  const chatEl = document.getElementById("chat");

  // Append user message immediately
  appendMessage(chatEl, "user", text);

  // Send via WebSocket
  const sent = wsClient.send({ type: "user_text", text, turn_id: turnId });
  if (!sent) {
    console.warn("[UI] Failed to send message: not connected");
    appendMessage(chatEl, "bot", "⚠️ Not connected. Click Start Call first.");
    return;
  }

  // Transition to thinking while waiting for bot reply
  if (state.getState() === "listening") {
    state.transition("thinking");
  }

  dispatch("message:send", { text, turnId });
}

/** Handle incoming server messages */
function handleServerMessage(msg) {
  const chatEl = document.getElementById("chat");
  const state = window.__CALL_STATE__; // Use the state passed via initUI

  // Safeguard: Stop STT immediately when bot starts responding (any server message)
  // This prevents feedback loop even if state transition is delayed
  if (msg.type === "delta" || msg.type === "sentence" || msg.type === "audio" || msg.type === "tts_fallback") {
    if (sttInitialized && sttEngine) {
      sttEngine.stop();
    }
  }

  switch (msg.type) {
    case "delta":
      // Streaming token - append to current bot message
      appendOrUpdateBotMessage(chatEl, msg.text, true);
      if (state.getState() === "thinking") {
        state.transition("speaking");
      }
      break;

    case "sentence":
      // Complete sentence - update the bot message
      appendOrUpdateBotMessage(chatEl, msg.text, false);
      break;

    case "audio":
      // TTS audio chunk - play via TtsPlayer
      if (msg.chunk_b64) {
        ttsPlayer.play(msg.chunk_b64).catch((e) => {
          console.error("[UI] TTS playback error:", e);
        });

        // Start recorder on first audio chunk if consent was given and recorder exists
        if (recorder && !recorder.isRecording() && micStream) {
          const botAudioEl = ttsPlayer.currentAudio;
          if (botAudioEl) {
            recorder.start(micStream, botAudioEl).catch((e) => {
              console.error("[UI] Failed to start recorder:", e);
            });
          }
        }
      }
      break;

    case "tts_fallback":
      // Edge TTS failed - use browser speechSynthesis
      showFallbackNotice(chatEl);
      const currentBotText = botMessageEl ? botMessageEl.textContent : "";
      if (currentBotText) {
        speechSynthesisFallback.speak(currentBotText);
      }
      break;

    case "cancelled":
      // Barge-in DISABLED: ignore cancel messages
      // ttsPlayer.stop();
      // speechSynthesisFallback.cancel();
      // finalizeBotMessage();
      // state.transition("listening");
      break;

    case "done":
      // Bot finished - remove streaming cursor
      finalizeBotMessage();
      // Wait for TTS to finish playing before starting to listen
      // This prevents the bot's own voice from being picked up as user input
      ttsPlayer.waitUntilDone().then(() => {
        // Also wait a bit for speechSynthesis fallback to finish
        if (speechSynthesisFallback.speaking) {
          // Poll until speechSynthesis finishes
          const checkSpeech = setInterval(() => {
            if (!speechSynthesisFallback.speaking) {
              clearInterval(checkSpeech);
              state.transition("listening");
            }
          }, 100);
        } else {
          state.transition("listening");
        }
      });
      dispatch("message:recv", { turnId: msg.turn_id });
      break;

    case "error":
      appendMessage(chatEl, "bot", `⚠️ ${msg.message}`);
      state.transition("error");
      break;

    default:
      console.warn("[UI] Unknown message type:", msg.type);
  }
}

/** Handle WebSocket close */
function handleClose({ wasClean }) {
  const state = callState;
  if (state.getState() !== "ended" && state.getState() !== "idle") {
    state.transition("error");
    const chatEl = document.getElementById("chat");
    if (!wasClean) {
      appendMessage(chatEl, "bot", "⚠️ Connection lost. Click Start Call to retry.");
    }
  }
}

/** End the call */
async function endCall(state) {
  wsClient.send({ type: "end" });
  wsClient.close();

  // Stop recorder and upload if recording
  if (recorder && recorder.isRecording()) {
    try {
      const blob = await recorder.stop();
      if (blob && blob.size > 0) {
        // Upload recording to backend
        await uploadRecording(blob, state);
      }
    } catch (e) {
      console.error("[UI] Failed to stop/upload recording:", e);
    }
  }

  // Stop microphone stream
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  state.transition("ended");
  dispatch("call:end");
}

/** Append a message to the chat panel */
function appendMessage(chatEl, role, text) {
  const row = document.createElement("div");
  row.className = `msg-row ${role}`;

  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "👤" : "🤖";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  row.append(avatar, bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

/** Append or update the bot's streaming message */
function appendOrUpdateBotMessage(chatEl, text, isStreaming) {
  if (!botMessageEl) {
    // Create new bot message row
    const row = document.createElement("div");
    row.className = "msg-row bot";

    const avatar = document.createElement("span");
    avatar.className = "msg-avatar";
    avatar.textContent = "🤖";

    botMessageEl = document.createElement("div");
    botMessageEl.className = "msg-bubble streaming";

    row.append(avatar, botMessageEl);
    chatEl.appendChild(row);
  }

  if (isStreaming) {
    // For delta, we append the token
    botMessageEl.textContent += text;
    // Ensure streaming cursor is visible
    botMessageEl.classList.add("streaming");
  } else {
    // For sentence, append with a space (not replace)
    // This keeps the full message visible as it arrives sentence by sentence
    if (botMessageEl.textContent && !botMessageEl.textContent.endsWith(" ")) {
      botMessageEl.textContent += " ";
    }
    botMessageEl.textContent += text;
  }

  chatEl.scrollTop = chatEl.scrollHeight;
}

/** Finalize bot message (remove streaming cursor) */
function finalizeBotMessage() {
  if (botMessageEl) {
    botMessageEl.classList.remove("streaming");
    botMessageEl = null;
  }
}

/** Show fallback notice when edge-tts fails */
function showFallbackNotice(chatEl) {
  if (fallbackNoticeShown) return;
  fallbackNoticeShown = true;

  const notice = document.createElement("div");
  notice.id = "tts-fallback-notice";
  notice.className = "tts-fallback-notice";
  notice.innerHTML = `
    <span class="tts-fallback-icon">🔊</span>
    <span class="tts-fallback-text">Voice output uses your browser's built-in speaker and is not included in the call recording.</span>
  `;

  // Insert at the top of chat
  chatEl.insertBefore(notice, chatEl.firstChild);

  // Add styles if not already added
  if (!document.getElementById("tts-fallback-styles")) {
    const style = document.createElement("style");
    style.id = "tts-fallback-styles";
    style.textContent = `
      .tts-fallback-notice {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: #fef3c7;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        margin-bottom: 0.75rem;
        color: #92400e;
        font-size: 0.8rem;
      }
      .tts-fallback-icon { font-size: 0.9rem; }
    `;
    document.head.appendChild(style);
  }
}

/** Add mute and volume controls to the call controls */
function addCallControls(controlsEl) {
  if (!controlsEl || document.getElementById("muteBtn")) return;

  // Mute button
  const muteBtn = document.createElement("button");
  muteBtn.id = "muteBtn";
  muteBtn.type = "button";
  muteBtn.className = "secondary";
  muteBtn.innerHTML = "🔊";
  muteBtn.title = "Mute/Unmute";
  muteBtn.addEventListener("click", () => {
    const newMuted = !ttsPlayer.muted;
    ttsPlayer.setMuted(newMuted);
    muteBtn.innerHTML = newMuted ? "🔇" : "🔊";
    muteBtn.title = newMuted ? "Unmute" : "Mute";
  });

  // Volume slider
  const volumeWrapper = document.createElement("div");
  volumeWrapper.className = "volume-wrapper";
  volumeWrapper.style.display = "flex";
  volumeWrapper.style.alignItems = "center";
  volumeWrapper.style.gap = "0.5rem";

  const volumeLabel = document.createElement("label");
  volumeLabel.htmlFor = "volumeSlider";
  volumeLabel.textContent = "🔊";
  volumeLabel.style.fontSize = "1.1rem";

  const volumeSlider = document.createElement("input");
  volumeSlider.id = "volumeSlider";
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "1";
  volumeSlider.step = "0.1";
  volumeSlider.value = ttsPlayer.volume;
  volumeSlider.style.width = "80px";
  volumeSlider.addEventListener("input", (e) => {
    ttsPlayer.setVolume(parseFloat(e.target.value));
  });

  volumeWrapper.append(volumeLabel, volumeSlider);

  // Insert before duration element
  const durationEl = document.getElementById("duration");
  if (durationEl) {
    controlsEl.insertBefore(muteBtn, durationEl);
    controlsEl.insertBefore(volumeWrapper, durationEl);
  } else {
    controlsEl.append(muteBtn, volumeWrapper);
  }
}

/** Upload recording to backend */
async function uploadRecording(blob, state) {
  try {
    const callId = state.getCallId?.() || crypto.randomUUID();
    const deviceId = localStorage.getItem("voicebot_device_id") || "unknown";

    const formData = new FormData();
    formData.append("file", blob, `${callId}.webm`);
    formData.append("device_id", deviceId);

    const response = await fetch(`/calls/${callId}/recording`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      console.log("[UI] Recording uploaded:", data.recording_path);
      // Store recording path in state for later playback
      state.setRecordingPath?.(data.recording_path);
    } else {
      console.error("[UI] Failed to upload recording:", response.status);
      state.setRecordingError?.("recording_upload_failed");
    }
  } catch (e) {
    console.error("[UI] Error uploading recording:", e);
    state.setRecordingError?.("recording_upload_failed");
  }
}

/** Dispatch a custom event on window */
export function dispatch(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}