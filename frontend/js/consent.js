/** consent.js — Recording consent management (F07).
 *
 * Exports:
 * - ConsentManager: class with show(), isGranted(), recordConsent(bool), getConsent()
 * - Uses native <dialog> for modal, localStorage for persistence
 */

const CONSENT_STORAGE_KEY = "voicebot_consent";

/**
 * Get a unique device ID for this browser (stored in localStorage)
 */
function getDeviceId() {
  let deviceId = localStorage.getItem("voicebot_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("voicebot_device_id", deviceId);
  }
  return deviceId;
}

/**
 * ConsentManager — handles the consent modal and storage
 */
export class ConsentManager {
  #modal = null;
  #checkbox = null;
  #agreeBtn = null;
  #declineBtn = null;
  #resolvePromise = null;

  /**
   * Create a new ConsentManager
   * Initializes DOM references and event listeners
   */
  constructor() {
    this.#modal = document.getElementById("consentModal");
    this.#checkbox = document.getElementById("consentCheckbox");
    this.#agreeBtn = document.getElementById("consentAgreeBtn");
    this.#declineBtn = document.getElementById("consentDeclineBtn");

    if (!this.#modal || !this.#checkbox || !this.#agreeBtn || !this.#declineBtn) {
      console.warn("[ConsentManager] Required DOM elements not found");
      return;
    }

    // Checkbox enables/disables agree button
    this.#checkbox.addEventListener("change", () => {
      this.#agreeBtn.disabled = !this.#checkbox.checked;
    });

    // Agree button
    this.#agreeBtn.addEventListener("click", () => {
      this.recordConsent(true);
      this.#resolve(true);
    });

    // Decline button
    this.#declineBtn.addEventListener("click", () => {
      this.recordConsent(false);
      this.#resolve(false);
    });

    // Handle modal close (ESC key or backdrop click)
    this.#modal.addEventListener("close", () => {
      this.#resolve(false);
    });

    // Prevent closing on backdrop click (require explicit button press)
    this.#modal.addEventListener("click", (e) => {
      if (e.target === this.#modal) {
        e.preventDefault();
      }
    });
  }

  /**
   * Check if consent has been granted for this device
   * @returns {boolean} True if consent was granted
   */
  isGranted() {
    const consent = this.getConsent();
    return consent?.consent_given === true;
  }

  /**
   * Get stored consent data
   * @returns {Object|null} {consent_given: bool, consent_at: ISO string} or null
   */
  getConsent() {
    const deviceId = getDeviceId();
    const key = `${CONSENT_STORAGE_KEY}_${deviceId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Record consent decision
   * @param {boolean} granted - Whether user consented
   */
  recordConsent(granted) {
    const deviceId = getDeviceId();
    const key = `${CONSENT_STORAGE_KEY}_${deviceId}`;
    const data = {
      consent_given: granted,
      consent_at: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  /**
   * Show the consent modal and return a promise that resolves with the user's choice
   * @returns {Promise<boolean>} Resolves to true if user agreed, false if declined/closed
   */
  show() {
    return new Promise((resolve) => {
      // If already granted, resolve immediately
      if (this.isGranted()) {
        resolve(true);
        return;
      }

      // Reset checkbox and button state
      this.#checkbox.checked = false;
      this.#agreeBtn.disabled = true;
      this.#resolvePromise = resolve;

      // Show modal
      this.#modal.showModal();
    });
  }

  /**
   * Resolve the promise and clean up
   * @private
   */
  #resolve(value) {
    if (this.#resolvePromise) {
      const resolver = this.#resolvePromise;
      this.#resolvePromise = null;
      resolver(value);
    }
  }

  /**
   * Hide the consent modal
   */
  hide() {
    if (this.#modal.open) {
      this.#modal.close();
    }
  }

  /**
   * Check if consent has been asked before (either granted or declined)
   * @returns {boolean}
   */
  hasBeenAsked() {
    return this.getConsent() !== null;
  }
}

/**
 * Factory function to create ConsentManager instance
 * @returns {ConsentManager}
 */
export function createConsentManager() {
  return new ConsentManager();
}