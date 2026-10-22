/** tts-player.js — TTS audio playback with queue, barge-in, mute, and volume (F06).
 *
 * Exports:
 * - TtsPlayer: class with play(b64), stop(), setMuted(bool), setVolume(float 0-1)
 * - Uses <audio> elements for playback with a queue for sequential playback.
 * - On stop(), sends {type: "cancel"} to server via WebSocket.
 * - Fallback to speechSynthesis if edge-tts fails (handled by UI on "tts_fallback" message).
 */

let wsClientRef = null;

/** Set the WebSocket client reference for sending cancel messages */
export function setWsClient(wsClient) {
  wsClientRef = wsClient;
}

/** TtsPlayer — manages audio queue and playback */
export class TtsPlayer {
  #queue = [];           // Array of { audio: HTMLAudioElement, chunkB64: string, resolve, reject, url }
  #currentAudio = null;  // Currently playing HTMLAudioElement
  #currentResolve = null; // Resolver for current audio promise
  #currentReject = null;  // Rejector for current audio promise
  #isPlaying = false;
  #muted = false;
  #volume = 1.0;
  #playingPromise = null; // Promise that resolves when current audio finishes
  #resolvePlaying = null; // Resolver for #playingPromise

  /** Create a new TtsPlayer */
  constructor() {
    this.#initPlayingPromise();
  }

  /** Initialize the playing promise */
  #initPlayingPromise() {
    this.#playingPromise = new Promise((resolve) => {
      this.#resolvePlaying = resolve;
    });
  }

  /** Play a base64-encoded MP3 chunk - enqueues and plays sequentially */
  play(chunkB64) {
    return new Promise((resolve, reject) => {
      try {
        // Decode base64 to ArrayBuffer
        const binaryString = atob(chunkB64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create blob and object URL
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);

        // Create audio element
        const audio = new Audio(url);
        audio.volume = this.#muted ? 0 : this.#volume;
        audio.preload = "auto";

        // Queue the audio
        this.#queue.push({ audio, chunkB64, url, resolve, reject });

        // If not currently playing, start playback
        if (!this.#isPlaying) {
          this.#playNext();
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Play the next item in the queue */
  #playNext() {
    if (this.#queue.length === 0) {
      this.#isPlaying = false;
      this.#resolvePlaying();
      this.#initPlayingPromise();
      return;
    }

    this.#isPlaying = true;
    const item = this.#queue.shift();
    this.#currentAudio = item.audio;
    this.#currentResolve = item.resolve;
    this.#currentReject = item.reject;

    // Set up event handlers
    item.audio.onended = () => {
      URL.revokeObjectURL(item.url);
      item.resolve();
      this.#currentAudio = null;
      this.#currentResolve = null;
      this.#currentReject = null;
      this.#playNext();
    };

    item.audio.onerror = (e) => {
      URL.revokeObjectURL(item.url);
      item.reject(new Error(`Audio playback error: ${e.type || "unknown"}`));
      this.#currentAudio = null;
      this.#currentResolve = null;
      this.#currentReject = null;
      this.#playNext();
    };

    // Start playback
    item.audio.play().catch((e) => {
      URL.revokeObjectURL(item.url);
      item.reject(e);
      this.#currentAudio = null;
      this.#currentResolve = null;
      this.#currentReject = null;
      this.#playNext();
    });
  }

  /** Stop playback immediately, clear queue, and send cancel to server */
  stop() {
    // Stop current audio and reject its promise
    if (this.#currentAudio) {
      this.#currentAudio.pause();
      this.#currentAudio.currentTime = 0;
      this.#currentAudio.onended = null;
      this.#currentAudio.onerror = null;
      URL.revokeObjectURL(this.#currentAudio.src);
      // Reject the current item's promise
      if (this.#currentReject) {
        this.#currentReject(new Error("Playback stopped (barge-in)"));
      }
      this.#currentAudio = null;
      this.#currentResolve = null;
      this.#currentReject = null;
    }

    // Clear queue and reject pending promises
    for (const item of this.#queue) {
      URL.revokeObjectURL(item.url);
      item.reject(new Error("Playback stopped (barge-in)"));
    }
    this.#queue = [];

    // Reset state
    this.#isPlaying = false;
    this.#resolvePlaying();
    this.#initPlayingPromise();

    // Send cancel to server (barge-in notification)
    if (wsClientRef && wsClientRef.readyState === WebSocket.OPEN) {
      wsClientRef.send({ type: "cancel" });
    }
  }

  /** Set mute state */
  setMuted(muted) {
    this.#muted = !!muted;
    // Apply to current audio
    if (this.#currentAudio) {
      this.#currentAudio.volume = this.#muted ? 0 : this.#volume;
    }
    // Apply to queued audio
    for (const item of this.#queue) {
      item.audio.volume = this.#muted ? 0 : this.#volume;
    }
  }

  /** Set volume (0.0 to 1.0) */
  setVolume(volume) {
    this.#volume = Math.max(0, Math.min(1, volume));
    // Apply to current audio
    if (this.#currentAudio) {
      this.#currentAudio.volume = this.#muted ? 0 : this.#volume;
    }
    // Apply to queued audio
    for (const item of this.#queue) {
      item.audio.volume = this.#muted ? 0 : this.#volume;
    }
  }

  /** Get current mute state */
  get muted() {
    return this.#muted;
  }

  /** Get current volume */
  get volume() {
    return this.#volume;
  }

  /** Check if currently playing or has queued audio */
  get isPlaying() {
    return this.#isPlaying || this.#queue.length > 0;
  }

  /** Get the current audio element (for recording) */
  get currentAudio() {
    return this.#currentAudio;
  }

  /** Wait for all queued audio to finish playing */
  async waitUntilDone() {
    await this.#playingPromise;
  }
}

/** SpeechSynthesis fallback for when edge-tts fails */
export class SpeechSynthesisFallback {
  #utterance = null;
  #onEndCallback = null;

  /** Speak text using browser's built-in speech synthesis */
  speak(text, onEnd = null) {
    // Cancel any ongoing speech
    this.cancel();

    if (!("speechSynthesis" in window)) {
      console.warn("SpeechSynthesis not supported");
      if (onEnd) onEnd();
      return false;
    }

    this.#utterance = new SpeechSynthesisUtterance(text);
    this.#utterance.lang = navigator.language || "en-US";
    this.#utterance.rate = 1.0;
    this.#utterance.pitch = 1.0;
    this.#utterance.volume = 1.0;

    this.#onEndCallback = onEnd;

    this.#utterance.onend = () => {
      this.#utterance = null;
      if (this.#onEndCallback) {
        this.#onEndCallback();
        this.#onEndCallback = null;
      }
    };

    this.#utterance.onerror = (e) => {
      console.error("SpeechSynthesis error:", e);
      this.#utterance = null;
      if (this.#onEndCallback) {
        this.#onEndCallback();
        this.#onEndCallback = null;
      }
    };

    window.speechSynthesis.speak(this.#utterance);
    return true;
  }

  /** Cancel any ongoing speech */
  cancel() {
    if (this.#utterance) {
      window.speechSynthesis.cancel();
      this.#utterance = null;
      if (this.#onEndCallback) {
        this.#onEndCallback();
        this.#onEndCallback = null;
      }
    }
  }

  /** Check if currently speaking */
  get speaking() {
    return window.speechSynthesis && window.speechSynthesis.speaking;
  }
}

// Singleton instances
export const ttsPlayer = new TtsPlayer();
export const speechSynthesisFallback = new SpeechSynthesisFallback();