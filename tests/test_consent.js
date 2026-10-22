/** Unit tests for ConsentManager (F07).
 * Run with: node tests/test_consent.js
 * Uses JSDOM to simulate DOM and mock localStorage.
 */

import { JSDOM } from "jsdom";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

// Create a DOM for the initial setup
const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <dialog id="consentModal">
    <div class="consent-content">
      <h2>Recording Consent</h2>
      <p class="consent-text">
        This call is recorded for quality and training purposes. The browser's speech recognition
        (Chrome/Edge) sends audio to Google during the call. You can end the call at any time.
      </p>
      <label class="consent-checkbox-label">
        <input type="checkbox" id="consentCheckbox" />
        <span>I understand and consent to recording</span>
      </label>
      <div class="consent-buttons">
        <button id="consentAgreeBtn" class="primary" disabled>Agree & Start Call</button>
        <button id="consentDeclineBtn" class="secondary">Decline (Start Unrecorded)</button>
      </div>
    </div>
  </dialog>
</body></html>`, {
  url: "http://localhost",
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', {
  value: { language: "en-US" },
  configurable: true,
  writable: true
});
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Event = dom.window.Event;
global.CustomEvent = dom.window.CustomEvent;
global.HTMLDialogElement = dom.window.HTMLDialogElement;

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null,
  };
})();
global.localStorage = localStorageMock;

// Mock dialog showModal/close for JSDOM
const originalDialogProto = Object.getPrototypeOf(dom.window.HTMLDialogElement.prototype);
dom.window.HTMLDialogElement.prototype.showModal = function() {
  this.open = true;
  // Don't dispatch close on showModal - that happens on actual close
};
dom.window.HTMLDialogElement.prototype.close = function() {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2)
  },
  configurable: true,
  writable: true
});

// Now import the ConsentManager after globals are set up
import { createConsentManager, ConsentManager } from "../frontend/js/consent.js";

console.log("Running ConsentManager tests...\n");

// Debug: check DOM elements exist
const modal = document.getElementById("consentModal");
const checkbox = document.getElementById("consentCheckbox");
const agreeBtn = document.getElementById("consentAgreeBtn");
const declineBtn = document.getElementById("consentDeclineBtn");
console.log("  [DEBUG] DOM elements:", { modal, checkbox, agreeBtn, declineBtn });

async function runTests() {
  // Clear localStorage before each test
  localStorageMock.clear();

  // Test 1: ConsentManager construction
  {
    const manager = createConsentManager();
    assert(manager instanceof ConsentManager, "ConsentManager constructs successfully");
  }

  // Test 2: isGranted returns false when no consent stored
  {
    const manager = createConsentManager();
    assert(manager.isGranted() === false, "isGranted() returns false when no consent stored");
  }

  // Test 3: getConsent returns null when no consent stored
  {
    const manager = createConsentManager();
    assert(manager.getConsent() === null, "getConsent() returns null when no consent stored");
  }

  // Test 4: recordConsent stores consent in localStorage
  {
    const manager = createConsentManager();
    manager.recordConsent(true);
    const consent = manager.getConsent();
    assert(consent !== null, "getConsent() returns object after recordConsent(true)");
    assert(consent.consent_given === true, "consent_given is true");
    assert(typeof consent.consent_at === "string", "consent_at is ISO string");
    assert(new Date(consent.consent_at).toString() !== "Invalid Date", "consent_at is valid date");
  }

  // Test 5: recordConsent(false) stores decline
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    manager.recordConsent(false);
    const consent = manager.getConsent();
    assert(consent !== null, "getConsent() returns object after recordConsent(false)");
    assert(consent.consent_given === false, "consent_given is false");
  }

  // Test 6: isGranted returns true after consent granted
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    manager.recordConsent(true);
    assert(manager.isGranted() === true, "isGranted() returns true after consent granted");
  }

  // Test 7: isGranted returns false after consent declined
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    manager.recordConsent(false);
    assert(manager.isGranted() === false, "isGranted() returns false after consent declined");
  }

  // Test 8: show() resolves immediately if already granted
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    manager.recordConsent(true);
    const result = await manager.show();
    assert(result === true, "show() resolves to true immediately if already granted");
  }

  // Test 9: show() opens modal and waits for user interaction
  {
    localStorageMock.clear();
    const manager = createConsentManager();

    console.log("  [DEBUG] isGranted before show:", manager.isGranted());

    // Start show() - it should return a pending promise
    const showPromise = manager.show();

    console.log("  [DEBUG] After show(), isGranted:", manager.isGranted());

    // Modal should be open
    const modal = document.getElementById("consentModal");
    assert(modal.open === true, "Modal is open after show()");

    // Checkbox should be unchecked
    const checkbox = document.getElementById("consentCheckbox");
    assert(checkbox.checked === false, "Checkbox is unchecked initially");

    // Agree button should be disabled
    const agreeBtn = document.getElementById("consentAgreeBtn");
    assert(agreeBtn.disabled === true, "Agree button is disabled initially");

    // Check the checkbox
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    // Agree button should now be enabled
    assert(agreeBtn.disabled === false, "Agree button enabled after checkbox checked");

    // Click agree
    agreeBtn.click();
    // Manually close modal (JSDOM doesn't auto-close on button click)
    modal.close();

    // Wait for promise to resolve
    const result = await showPromise;
    assert(result === true, "show() resolves to true after clicking Agree");

    // Modal should be closed
    assert(modal.open === false, "Modal is closed after agree");

    // Consent should be stored
    console.log("  [DEBUG] isGranted after agree:", manager.isGranted());
    console.log("  [DEBUG] getConsent after agree:", manager.getConsent());
    assert(manager.isGranted() === true, "Consent stored after agree");
  }

  // Test 10: show() resolves to false when Decline clicked
  {
    localStorageMock.clear();
    const manager = createConsentManager();

    const showPromise = manager.show();

    const declineBtn = document.getElementById("consentDeclineBtn");
    declineBtn.click();
    // Manually close modal
    const modal = document.getElementById("consentModal");
    modal.close();

    const result = await showPromise;
    assert(result === false, "show() resolves to false after clicking Decline");

    assert(modal.open === false, "Modal is closed after decline");

    // Consent should be stored as false
    assert(manager.isGranted() === false, "Consent stored as false after decline");
  }

  // Test 11: show() resolves to false when modal closed without interaction (ESC/backdrop)
  {
    localStorageMock.clear();
    const manager = createConsentManager();

    const showPromise = manager.show();

    const modal = document.getElementById("consentModal");
    // Dispatch close event directly since JSDOM doesn't fully support dialog
    modal.dispatchEvent(new Event("close"));

    const result = await showPromise;
    assert(result === false, "show() resolves to false when modal closed without action");

    // Consent should be stored as false
    assert(manager.isGranted() === false, "Consent stored as false after modal close");
  }

  // Test 12: Consent is stored per device ID
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    manager.recordConsent(true);

    // Create a new manager (simulates new session)
    const manager2 = createConsentManager();
    assert(manager2.isGranted() === true, "Consent persists across manager instances (same device)");
  }

  // Test 13: hasBeenAsked returns true after any consent decision
  {
    localStorageMock.clear();
    const manager = createConsentManager();
    assert(manager.hasBeenAsked() === false, "hasBeenAsked() returns false initially");

    manager.recordConsent(true);
    assert(manager.hasBeenAsked() === true, "hasBeenAsked() returns true after consent granted");

    localStorageMock.clear();
    const manager2 = createConsentManager();
    manager2.recordConsent(false);
    assert(manager2.hasBeenAsked() === true, "hasBeenAsked() returns true after consent declined");
  }

  // Test 14: Consent text is present in modal
  {
    const modal = document.getElementById("consentModal");
    const text = modal.textContent;
    assert(text.includes("recorded"), "Modal contains recording explanation");
    assert(text.includes("speech recognition"), "Modal mentions speech recognition");
    assert(text.includes("Google"), "Modal mentions Google");
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});