/** recorder.js — Call recording using Web Audio API + MediaRecorder (F07).
 *
 * Exports:
 * - Recorder: class with start(stream), stop(), onData(cb), isRecording()
 * - Records mic + bot audio mixed via MediaStreamDestination
 * - Output: webm/opus (with fallback to default webm codec)
 */

const MIME_TYPE = "audio/webm;codecs=opus";
const FALLBACK_MIME_TYPE = "audio/webm";

/**
 * Recorder — mixes microphone and bot audio, records to webm
 */
export class Recorder {
  #audioContext = null;
  #micSource = null;
  #botSource = null;
  #destination = null;
  #mediaRecorder = null;
  #chunks = [];
  #onDataCallback = null;
  #consentGiven = false;
  #stream = null;

  /**
   * Create a new Recorder
   * @param {Object} options
   * @param {boolean} options.consentGiven - Whether recording consent was granted
   */
  constructor({ consentGiven = false } = {}) {
    this.#consentGiven = consentGiven;
  }

  /**
   * Start recording
   * @param {MediaStream} stream - The microphone stream from getUserMedia
   * @param {HTMLAudioElement|MediaStreamAudioDestinationNode} botAudio - Bot audio element or stream
   * @returns {Promise<void>}
   */
  async start(stream, botAudio) {
    // No-op if no consent
    if (!this.#consentGiven) {
      console.log("[Recorder] No consent - recording disabled");
      return;
    }

    // Check MediaRecorder support
    if (!window.MediaRecorder) {
      console.warn("[Recorder] MediaRecorder not supported");
      return;
    }

    // Check if mimeType is supported
    const mimeType = this.#getSupportedMimeType();
    if (!mimeType) {
      console.warn("[Recorder] No supported mime type for recording");
      return;
    }

    try {
      this.#stream = stream;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn("[Recorder] AudioContext not supported");
        return;
      }
      this.#audioContext = new AudioContext();

      // Create mic source from stream
      this.#micSource = this.#audioContext.createMediaStreamSource(stream);

      // Create destination for mixed audio
      this.#destination = this.#audioContext.createMediaStreamDestination();

      // Connect mic to destination
      this.#micSource.connect(this.#destination);

      // Connect bot audio if provided
      if (botAudio) {
        if (botAudio instanceof HTMLAudioElement) {
          // Create source from audio element
          this.#botSource = this.#audioContext.createMediaElementSource(botAudio);
          this.#botSource.connect(this.#destination);
        } else if (botAudio instanceof MediaStreamAudioDestinationNode) {
          // Already a destination node - connect its stream
          const botSource = this.#audioContext.createMediaStreamSource(
            botAudio.stream
          );
          botSource.connect(this.#destination);
        }
      }

      // Create MediaRecorder from mixed stream
      this.#mediaRecorder = new MediaRecorder(this.#destination.stream, {
        mimeType,
      });

      this.#chunks = [];

      this.#mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.#chunks.push(event.data);
          if (this.#onDataCallback) {
            this.#onDataCallback(event.data);
          }
        }
      };

      this.#mediaRecorder.onerror = (event) => {
        console.error("[Recorder] MediaRecorder error:", event.error);
      };

      this.#mediaRecorder.start(100); // Collect data every 100ms
      console.log(`[Recorder] Recording started with ${mimeType}`);
    } catch (e) {
      console.error("[Recorder] Failed to start recording:", e);
      this.#cleanup();
    }
  }

  /**
   * Get supported MIME type
   * @returns {string|null}
   */
  #getSupportedMimeType() {
    if (MediaRecorder.isTypeSupported(MIME_TYPE)) {
      return MIME_TYPE;
    }
    if (MediaRecorder.isTypeSupported(FALLBACK_MIME_TYPE)) {
      console.log("[Recorder] Falling back to default webm codec");
      return FALLBACK_MIME_TYPE;
    }
    return null;
  }

  /**
   * Stop recording and return the blob
   * @returns {Promise<Blob|null>}
   */
  async stop() {
    if (!this.#mediaRecorder || this.#mediaRecorder.state === "inactive") {
      console.log("[Recorder] Not recording");
      return null;
    }

    return new Promise((resolve) => {
      this.#mediaRecorder.onstop = () => {
        const blob = new Blob(this.#chunks, { type: this.#mediaRecorder.mimeType });
        console.log(`[Recorder] Recording stopped, blob size: ${blob.size} bytes`);
        this.#cleanup();
        resolve(blob);
      };

      this.#mediaRecorder.stop();
    });
  }

  /**
   * Register callback for data chunks
   * @param {Function} cb - Called with Blob chunk
   */
  onData(cb) {
    this.#onDataCallback = cb;
  }

  /**
   * Check if currently recording
   * @returns {boolean}
   */
  isRecording() {
    return this.#mediaRecorder?.state === "recording";
  }

  /**
   * Set bot audio element (call when bot starts speaking)
   * @param {HTMLAudioElement} audioEl
   */
  setBotAudio(audioEl) {
    if (!this.#audioContext || !this.#destination) return;

    // Disconnect previous bot source if any
    if (this.#botSource) {
      try {
        this.#botSource.disconnect();
      } catch (e) {
        // Ignore
      }
    }

    // Create new source from audio element
    this.#botSource = this.#audioContext.createMediaElementSource(audioEl);
    this.#botSource.connect(this.#destination);
  }

  /**
   * Clean up resources
   */
  #cleanup() {
    if (this.#micSource) {
      try {
        this.#micSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.#micSource = null;
    }

    if (this.#botSource) {
      try {
        this.#botSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.#botSource = null;
    }

    if (this.#destination) {
      try {
        this.#destination.disconnect();
      } catch (e) {
        // Ignore
      }
      this.#destination = null;
    }

    if (this.#audioContext && this.#audioContext.state !== "closed") {
      this.#audioContext.close().catch(() => {});
      this.#audioContext = null;
    }

    this.#mediaRecorder = null;
    this.#chunks = [];
  }
}

/**
 * Factory function to create Recorder instance
 * @param {Object} options
 * @param {boolean} options.consentGiven
 * @returns {Recorder}
 */
export function createRecorder({ consentGiven = false } = {}) {
  return new Recorder({ consentGiven });
}

/**
 * Check if recording is supported in this browser
 * @returns {boolean}
 */
export function isRecordingSupported() {
  return !!window.MediaRecorder && (MediaRecorder.isTypeSupported(MIME_TYPE) || MediaRecorder.isTypeSupported(FALLBACK_MIME_TYPE));
}