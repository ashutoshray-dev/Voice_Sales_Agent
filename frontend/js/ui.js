/** ui.js — renders the call screen and handles UI events.
 *
 * Exports:
 * - initUI(callState, wsClient): initializes the call view, returns cleanup fn
 * - dispatch(eventName, detail): emits custom events on window
 */
import { callState } from "./state.js";
import { SttEngine, showCompatibilityBanner, showMicDeniedBanner, showSttErrorBanner, clearSttBanners, createInterimRow, replaceInterimWithFinal } from "./stt.js";
import { ttsPlayer, speechSynthesisFallback, setWsClient } from "./tts-player.js";

let wsClient = null;
let timerInterval = null;
let timerSeconds = 0;
let botMessageEl = null; // current bot message element for streaming
let cleanupFns = [];
let sttEngine = null;
let sttInitialized = false;
let fallbackNoticeShown = false;

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
    });

    sttEngine.onFinal(({ text, turnId }) => {
      replaceInterimWithFinal(chatEl, text);
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
        sttEngine.start();
        // Start silence timer after bot finishes speaking
        sttEngine.startSilenceTimer();
      } else if (newState === "speaking") {
        // Bot is speaking - cancel silence timer
        sttEngine.cancelSilenceTimer();
      } else if (newState === "thinking") {
        // Bot is thinking - cancel silence timer
        sttEngine.cancelSilenceTimer();
      } else if (newState === "ended" || newState === "error") {
        // Call ended - stop STT
        sttEngine.stop();
      }
    }
  }));

  // Start Call button
  startBtn.addEventListener("click", async () => {
    try {
      state.transition("connecting");
      await wsClient.connect();
      state.transition("listening");
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

    case "done":
      // Bot finished - remove streaming cursor
      finalizeBotMessage();
      state.transition("listening");
      dispatch("message:recv", { turnId: msg.turn_id });
      break;

    case "cancelled":
      finalizeBotMessage();
      state.transition("listening");
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
function endCall(state) {
  wsClient.send({ type: "end" });
  wsClient.close();
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
    // For sentence, replace with full sentence (cleaner)
    botMessageEl.textContent = text;
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

/** Dispatch a custom event on window */
export function dispatch(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}