/** stt.js — Speech Recognition wrapper using Web Speech API.
 *
 * Exports:
 * - SttEngine: class with start(), stop(), onInterim(cb), onFinal(cb), onError(cb), isSupported()
 * - Events: stt:interim, stt:error (dispatched on window)
 */

/**
 * Get the SpeechRecognition constructor (handles webkit prefix and test mocks)
 */
function getSpeechRecognition() {
  // Use globalThis for broader compatibility (works in Node with JSDOM)
  const g = typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : {});
  return g.SpeechRecognition || g.webkitSpeechRecognition;
}

/**
 * Check if browser supports Speech Recognition
 */
export function isSupported() {
  return !!getSpeechRecognition();
}

/** Silence timer states */
const SILENCE_PHASE = {
  NONE: "none",           // Not listening for silence
  FIRST: "first",         // First silence period (8s) - will re-prompt
  SECOND: "second",       // Second silence period (12s) - will end call
};

/** Default timeout values (ms) */
const SILENCE_TIMEOUTS = {
  FIRST: 8000,   // 8 seconds for first silence
  SECOND: 12000, // 12 seconds for second silence (total ~20s)
};

/** SttEngine — wraps SpeechRecognition with silence detection and error handling */
export class SttEngine {
  #recognition = null;
  #onInterimCb = null;
  #onFinalCb = null;
  #onErrorCb = null;
  #silencePhase = SILENCE_PHASE.NONE;
  #silenceTimer = null;
  #reprompted = false;
  #turnId = null;
  #wsClient = null;
  #stateRef = null; // Reference to callState for transition checks
  #explicitlyStopped = false; // Flag to prevent auto-restart when explicitly stopped

  /**
   * Create a new SttEngine
   * @param {Object} options
   * @param {WsClient} options.wsClient - WebSocket client for sending transcripts
   * @param {CallState} options.stateRef - Reference to call state machine
   */
  constructor({ wsClient, stateRef } = {}) {
    this.#wsClient = wsClient;
    this.#stateRef = stateRef;
  }

  /** Returns true if Speech Recognition is supported in this browser */
  isSupported() {
    return isSupported();
  }

  /** Set the WebSocket client (can be called after construction) */
  setWsClient(wsClient) {
    this.#wsClient = wsClient;
  }

  /** Set the state reference (can be called after construction) */
  setStateRef(stateRef) {
    this.#stateRef = stateRef;
  }

  /**
   * Register callback for interim transcript updates
   * @param {Function} cb - Called with interim text string
   */
  onInterim(cb) {
    this.#onInterimCb = cb;
  }

  /**
   * Register callback for final transcript
   * @param {Function} cb - Called with { text, turnId }
   */
  onFinal(cb) {
    this.#onFinalCb = cb;
  }

  /**
   * Register callback for errors
   * @param {Function} cb - Called with error object { error, message }
   */
  onError(cb) {
    this.#onErrorCb = cb;
  }

  /**
   * Start speech recognition
   * Requests microphone permission and begins continuous recognition
   */
  start() {
    if (!this.isSupported()) {
      const err = new Error("Speech recognition not supported");
      err.code = "not-supported";
      this.#emitError(err);
      return false;
    }

    if (this.#recognition) {
      console.warn("[SttEngine] Already started");
      return true;
    }

    // Reset explicitly stopped flag when intentionally restarting
    this.#explicitlyStopped = false;

    try {
      const SpeechRecognition = getSpeechRecognition();
      this.#recognition = new SpeechRecognition();
      this.#recognition.continuous = true;
      this.#recognition.interimResults = true;
      this.#recognition.lang = navigator.language || "en-US";

      this.#recognition.onresult = (event) => this.#handleResult(event);
      this.#recognition.onerror = (event) => this.#handleError(event);
      this.#recognition.onend = () => this.#handleEnd();

      this.#recognition.start();
      console.log("[SttEngine] Recognition started");
      return true;
    } catch (e) {
      console.error("[SttEngine] Failed to start:", e);
      this.#emitError(e);
      return false;
    }
  }

  /**
   * Stop speech recognition
   */
  stop() {
    this.#explicitlyStopped = true;
    if (this.#recognition) {
      try {
        this.#recognition.stop();
      } catch (e) {
        console.warn("[SttEngine] Error stopping recognition:", e);
      }
      this.#recognition = null;
    }
    this.#clearSilenceTimer();
    this.#silencePhase = SILENCE_PHASE.NONE;
    this.#reprompted = false;
    this.#turnId = null;
    console.log("[SttEngine] Recognition stopped (explicitly)");

    // Reset the flag after a short delay to allow for proper cleanup
    setTimeout(() => {
      this.#explicitlyStopped = false;
    }, 100);
  }

  /**
   * Start the silence timer after bot finishes speaking
   * Called when state transitions to "listening" after bot speaks
   */
  startSilenceTimer() {
    // Only start if we're in listening state and have a valid turn
    if (!this.#stateRef || this.#stateRef.getState() !== "listening") {
      return;
    }

    this.#clearSilenceTimer();
    this.#silencePhase = SILENCE_PHASE.FIRST;
    this.#reprompted = false;

    this.#silenceTimer = setTimeout(() => this.#onSilenceTimeout(), SILENCE_TIMEOUTS.FIRST);
    console.log("[SttEngine] Silence timer started (first phase: 8s)");
  }

  /**
   * Cancel the silence timer (called when user speaks)
   */
  cancelSilenceTimer() {
    if (this.#silenceTimer) {
      this.#clearSilenceTimer();
      this.#silencePhase = SILENCE_PHASE.NONE;
      this.#reprompted = false;
      console.log("[SttEngine] Silence timer cancelled");
    }
  }

  /** Handle speech recognition results */
  #handleResult(event) {
    // Don't process results if explicitly stopped (prevents feedback loop)
    if (this.#explicitlyStopped) {
      console.log("[SttEngine] Ignoring results - explicitly stopped");
      return;
    }

    let interimText = "";
    let finalText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    // Cancel silence timer on any speech (interim or final)
    if (interimText || finalText) {
      this.#clearSilenceTimer();
    }

    // Emit interim transcript
    if (interimText && this.#onInterimCb) {
      this.#onInterimCb(interimText);
      // Also dispatch event for UI
      window.dispatchEvent(new CustomEvent("stt:interim", { detail: { text: interimText } }));
    }

    // Emit final transcript
    if (finalText && this.#onFinalCb) {
      const turnId = this.#turnId || crypto.randomUUID();
      this.#onFinalCb({ text: finalText.trim(), turnId });
      // Send to server via WebSocket
      this.#sendToServer(finalText.trim(), turnId);
    }
  }

  /** Handle speech recognition errors */
  #handleError(event) {
    const errorCode = event.error;
    let message = "";
    let fallbackToText = false;

    switch (errorCode) {
      case "no-speech":
        // No speech detected - don't end call, rely on silence timer
        console.log("[SttEngine] No speech detected");
        return; // Don't emit error for no-speech

      case "audio-capture":
        message = "Microphone not found or audio capture failed.";
        fallbackToText = true;
        break;

      case "not-allowed":
        message = "Microphone access denied. Type your response instead.";
        fallbackToText = true;
        break;

      case "network":
        message = "Speech recognition service unavailable. Type your response instead.";
        fallbackToText = true;
        break;

      case "aborted":
        console.log("[SttEngine] Recognition aborted");
        return; // Don't emit error for aborted

      case "service-not-allowed":
        message = "Speech recognition service not allowed.";
        fallbackToText = true;
        break;

      case "bad-grammar":
      case "language-not-supported":
        message = `Speech recognition error: ${errorCode}`;
        break;

      default:
        message = `Speech recognition error: ${errorCode}`;
    }

    const err = new Error(message);
    err.code = errorCode;
    err.fallbackToText = fallbackToText;

    console.error("[SttEngine] Error:", errorCode, message);
    this.#emitError(err);
  }

  /** Handle recognition end (auto-restart for continuous mode) */
  #handleEnd() {
    console.log("[SttEngine] Recognition ended");
    this.#recognition = null;

    // Don't auto-restart if explicitly stopped (prevents feedback loop)
    if (this.#explicitlyStopped) {
      console.log("[SttEngine] Not auto-restarting - explicitly stopped");
      return;
    }

    // Auto-restart if we're still in listening state
    if (this.#stateRef && this.#stateRef.getState() === "listening") {
      console.log("[SttEngine] Auto-restarting recognition");
      setTimeout(() => this.start(), 100);
    }
  }

  /** Send final transcript to server */
  #sendToServer(text, turnId) {
    if (this.#wsClient) {
      const sent = this.#wsClient.send({ type: "user_text", text, turn_id: turnId });
      if (!sent) {
        console.warn("[SttEngine] Failed to send transcript: not connected");
      }
    } else {
      console.warn("[SttEngine] No wsClient available");
    }
  }

  /** Emit error to callback and dispatch event */
  #emitError(error) {
    if (this.#onErrorCb) {
      this.#onErrorCb(error);
    }
    window.dispatchEvent(new CustomEvent("stt:error", { detail: error }));
  }

  /** Clear silence timer */
  #clearSilenceTimer() {
    if (this.#silenceTimer) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
  }

  /** Handle silence timeout */
  #onSilenceTimeout() {
    if (!this.#stateRef) return;

    const currentState = this.#stateRef.getState();
    if (currentState !== "listening") return;

    if (this.#silencePhase === SILENCE_PHASE.FIRST && !this.#reprompted) {
      // First timeout: re-prompt
      this.#reprompted = true;
      this.#silencePhase = SILENCE_PHASE.SECOND;

      // Send re-prompt request to server
      if (this.#wsClient) {
        this.#wsClient.send({ type: "reprompt", turn_id: this.#turnId || crypto.randomUUID() });
      }

      // Restart timer for second phase
      this.#silenceTimer = setTimeout(() => this.#onSilenceTimeout(), SILENCE_TIMEOUTS.SECOND);
      console.log("[SttEngine] Silence timeout - re-prompting (second phase: 12s)");
    } else if (this.#silencePhase === SILENCE_PHASE.SECOND) {
      // Second timeout: end call as No Response
      console.log("[SttEngine] Silence timeout - ending call as No Response");

      if (this.#wsClient) {
        this.#wsClient.send({ type: "end", reason: "no_response" });
        this.#wsClient.close();
      }

      if (this.#stateRef) {
        this.#stateRef.transition("ended");
      }

      this.stop();
    }
  }
}

/**
 * Create and show the compatibility banner for unsupported browsers
 * @param {HTMLElement} container - Container element to prepend banner to
 */
export function showCompatibilityBanner(container) {
  if (document.getElementById("stt-compat-banner")) return;

  const banner = document.createElement("div");
  banner.id = "stt-compat-banner";
  banner.className = "stt-banner";
  banner.innerHTML = `
    <span class="stt-banner-icon">⚠️</span>
    <span class="stt-banner-text">Speech input is not supported in this browser. Use the text input below.</span>
  `;

  // Insert at the top of the container
  container.insertBefore(banner, container.firstChild);

  // Add styles if not already added
  if (!document.getElementById("stt-banner-styles")) {
    const style = document.createElement("style");
    style.id = "stt-banner-styles";
    style.textContent = `
      .stt-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: #fef3c7;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        margin-bottom: 1rem;
        color: #92400e;
        font-size: 0.9rem;
      }
      .stt-banner-icon { font-size: 1.1rem; }
      .stt-banner-error {
        background: #fee2e2;
        border-color: #fca5a5;
        color: #991b1b;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Show mic denied error banner
 * @param {HTMLElement} container - Container element to prepend banner to
 */
export function showMicDeniedBanner(container) {
  // Remove compatibility banner if present
  const compatBanner = document.getElementById("stt-compat-banner");
  if (compatBanner) compatBanner.remove();

  if (document.getElementById("stt-mic-banner")) return;

  const banner = document.createElement("div");
  banner.id = "stt-mic-banner";
  banner.className = "stt-banner stt-banner-error";
  banner.innerHTML = `
    <span class="stt-banner-icon">🎤</span>
    <span class="stt-banner-text">Microphone access denied. Type your response instead.</span>
  `;

  container.insertBefore(banner, container.firstChild);
}

/**
 * Show generic STT error banner
 * @param {HTMLElement} container - Container element
 * @param {string} message - Error message
 */
export function showSttErrorBanner(container, message) {
  const compatBanner = document.getElementById("stt-compat-banner");
  if (compatBanner) compatBanner.remove();

  const micBanner = document.getElementById("stt-mic-banner");
  if (micBanner) micBanner.remove();

  if (document.getElementById("stt-error-banner")) return;

  const banner = document.createElement("div");
  banner.id = "stt-error-banner";
  banner.className = "stt-banner stt-banner-error";
  banner.innerHTML = `
    <span class="stt-banner-icon">⚠️</span>
    <span class="stt-banner-text">${message}</span>
  `;

  container.insertBefore(banner, container.firstChild);
}

/**
 * Remove all STT banners
 * @param {HTMLElement} container - Container element
 */
export function clearSttBanners(container) {
  const banners = [
    "stt-compat-banner",
    "stt-mic-banner",
    "stt-error-banner",
  ];
  for (const id of banners) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}

/**
 * Create a ghost (interim) message row in the chat
 * @param {HTMLElement} chatEl - Chat container element
 * @param {string} text - Interim text
 * @returns {HTMLElement} The created row element
 */
export function createInterimRow(chatEl, text) {
  // Remove existing interim row
  const existing = chatEl.querySelector(".msg-row.interim");
  if (existing) existing.remove();

  const row = document.createElement("div");
  row.className = "msg-row user interim";

  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.textContent = "👤";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble interim-bubble";
  bubble.textContent = text;

  row.append(avatar, bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  return row;
}

/**
 * Replace interim row with final message
 * @param {HTMLElement} chatEl - Chat container element
 * @param {string} text - Final text
 */
export function replaceInterimWithFinal(chatEl, text) {
  const interimRow = chatEl.querySelector(".msg-row.interim");
  if (interimRow) {
    interimRow.remove();
  }

  // Create final user message row
  const row = document.createElement("div");
  row.className = "msg-row user";

  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.textContent = "👤";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  row.append(avatar, bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}