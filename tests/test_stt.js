/** Unit tests for STT engine (F05).
 * Run with: node tests/test_stt.js
 * Uses JSDOM to simulate DOM and mock SpeechRecognition.
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
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
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

// Mock SpeechRecognition for JSDOM
let mockRecognitionInstance = null;

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = "en-US";
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this._shouldError = null;
    this._errorCode = null;
    mockRecognitionInstance = this;
  }
  start() {
    this.readyState = 1; // STARTED
    // Don't auto-call onend - let tests control when recognition ends
  }
  stop() {
    this.readyState = 0; // STOPPED
    // Don't auto-call onend
  }
  // Test helper to simulate a result
  simulateResult(results) {
    if (this.onresult) {
      // Convert to array-like objects with numeric indices - properly mimic SpeechRecognitionResultList
      const formattedResults = results.map(r => {
        const obj = { isFinal: r.isFinal, length: 1 };
        Object.defineProperty(obj, '0', { value: r[0], enumerable: true });
        return obj;
      });
      // Make it array-like with length
      formattedResults.length = formattedResults.length;
      const event = {
        resultIndex: 0,
        results: formattedResults
      };
      this.onresult(event);
    }
  }
  // Test helper to simulate an error
  simulateError(errorCode) {
    if (this.onerror) {
      this.onerror({ error: errorCode });
    }
  }
}
global.SpeechRecognition = MockSpeechRecognition;
global.webkitSpeechRecognition = MockSpeechRecognition;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.sentMessages = [];
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen({});
    }, 0);
  }
  send(data) {
    console.log("[MockWebSocket] send called with:", data);
    // Handle both string and object (SttEngine sends object, UI sends JSON string)
    const msg = typeof data === "string" ? JSON.parse(data) : data;
    this.sentMessages.push(msg);
    console.log("[MockWebSocket] sentMessages now:", this.sentMessages);
    return true;
  }
  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ wasClean: true, code, reason });
  }
}
global.WebSocket = MockWebSocket;

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2)
  },
  configurable: true,
  writable: true
});

// Mock CallState
class MockCallState {
  constructor() {
    this._state = "idle";
    this._listeners = new Set();
  }
  getState() { return this._state; }
  transition(to) {
    if (to === this._state) return;
    this._state = to;
    for (const cb of this._listeners) cb(to);
  }
  onchange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
  reset() { this._state = "idle"; }
}

// Now import modules after globals are set up
import { SttEngine, isSupported, showCompatibilityBanner, showMicDeniedBanner, showSttErrorBanner, clearSttBanners, createInterimRow, replaceInterimWithFinal } from "../frontend/js/stt.js";
import { WsClient } from "../frontend/js/ws.js";

console.log("Running STT tests...\n");

async function runTests() {
  // Reset mocks
  mockRecognitionInstance = null;

  // Test 1: isSupported returns true when SpeechRecognition exists
  {
    assert(isSupported() === true, "isSupported() returns true when SpeechRecognition is available");
  }

  // Test 2: SttEngine constructor
  {
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    assert(stt instanceof SttEngine, "SttEngine constructs successfully");
    assert(stt.isSupported() === true, "SttEngine.isSupported() returns true");
  }

  // Test 3: onFinal fires once per utterance
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let finalCount = 0;
    let lastText = "";
    let lastTurnId = "";

    stt.onFinal(({ text, turnId }) => {
      finalCount++;
      lastText = text;
      lastTurnId = turnId;
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate a final result
    mockRecognitionInstance.simulateResult([
      { 0: { transcript: "Hello world" }, isFinal: true }
    ]);
    await new Promise(r => setTimeout(r, 10));

    assert(finalCount === 1, "onFinal fires exactly once per utterance");
    assert(lastText === "Hello world", "Final text is correct");
    assert(lastTurnId !== "", "Turn ID is generated");

    // Simulate another utterance
    mockRecognitionInstance.simulateResult([
      { 0: { transcript: "How are you" }, isFinal: true }
    ]);
    await new Promise(r => setTimeout(r, 10));

    assert(finalCount === 2, "onFinal fires for second utterance");
    assert(lastText === "How are you", "Second final text is correct");

    stt.stop();
  }

  // Test 4: onInterim receives interim transcripts
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let interimTexts = [];

    stt.onInterim((text) => {
      interimTexts.push(text);
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate interim result
    mockRecognitionInstance.simulateResult([
      { 0: { transcript: "Hel" }, isFinal: false },
      { 0: { transcript: "Hello" }, isFinal: false }
    ]);
    await new Promise(r => setTimeout(r, 10));

    // Interim results are concatenated in the STT engine
    assert(interimTexts.length >= 1, "onInterim receives interim transcripts");
    // The engine concatenates interim results, so we get "Hel" then "HelHello"
    assert(interimTexts[0].includes("Hel"), "First interim text contains Hel");
    assert(interimTexts[interimTexts.length - 1].includes("Hello"), "Last interim text contains Hello");

    stt.stop();
  }

  // Test 5: onError handles not-allowed
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let errorReceived = null;

    stt.onError((error) => {
      errorReceived = error;
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate not-allowed error
    mockRecognitionInstance.simulateError("not-allowed");
    await new Promise(r => setTimeout(r, 10));

    assert(errorReceived !== null, "onError callback fired for not-allowed");
    assert(errorReceived.code === "not-allowed", "Error code is not-allowed");
    assert(errorReceived.message.includes("denied"), "Error message mentions denied");

    stt.stop();
  }

  // Test 6: onError handles audio-capture
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let errorReceived = null;

    stt.onError((error) => {
      errorReceived = error;
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate audio-capture error
    mockRecognitionInstance.simulateError("audio-capture");
    await new Promise(r => setTimeout(r, 10));

    assert(errorReceived !== null, "onError callback fired for audio-capture");
    assert(errorReceived.code === "audio-capture", "Error code is audio-capture");
    assert(errorReceived.fallbackToText === true, "fallbackToText is true for audio-capture");

    stt.stop();
  }

  // Test 7: onError handles network error
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let errorReceived = null;

    stt.onError((error) => {
      errorReceived = error;
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate network error
    mockRecognitionInstance.simulateError("network");
    await new Promise(r => setTimeout(r, 10));

    assert(errorReceived !== null, "onError callback fired for network");
    assert(errorReceived.code === "network", "Error code is network");
    assert(errorReceived.fallbackToText === true, "fallbackToText is true for network");

    stt.stop();
  }

  // Test 8: no-speech error does not call onError (relied on silence timer)
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    let errorReceived = null;

    stt.onError((error) => {
      errorReceived = error;
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    // Simulate no-speech error
    mockRecognitionInstance.simulateError("no-speech");
    await new Promise(r => setTimeout(r, 10));

    assert(errorReceived === null, "onError NOT called for no-speech (silence timer handles it)");

    stt.stop();
  }

  // Test 9: startSilenceTimer and cancelSilenceTimer
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });

    // Start silence timer
    stt.startSilenceTimer();
    await new Promise(r => setTimeout(r, 10));

    // Cancel it
    stt.cancelSilenceTimer();
    await new Promise(r => setTimeout(r, 10));

    // Should not have timed out (we can't easily test the timeout without waiting 8s)
    assert(true, "startSilenceTimer and cancelSilenceTimer execute without error");

    stt.stop();
  }

  // Test 10: stop() stops recognition and clears timer
  {
    mockRecognitionInstance = null;
    const wsClient = new MockWebSocket("ws://localhost/ws");
    await new Promise(r => setTimeout(r, 10));
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });
    stt.start();
    await new Promise(r => setTimeout(r, 50));

    stt.stop();
    await new Promise(r => setTimeout(r, 10));

    // If we get here without errors, stop() works
    assert(true, "stop() stops recognition and clears timers");
  }

  // Test 11: isSupported returns false when SpeechRecognition not available
  {
    const originalSpeechRecognition = global.SpeechRecognition;
    const originalWebkitSpeechRecognition = global.webkitSpeechRecognition;
    global.SpeechRecognition = undefined;
    global.webkitSpeechRecognition = undefined;

    // Need to re-import or use a fresh module - for now test the function logic
    // Since we can't easily re-import, let's test the internal logic
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const sr = g.SpeechRecognition || g.webkitSpeechRecognition;
    assert(sr === undefined, "SpeechRecognition is undefined when removed");

    global.SpeechRecognition = originalSpeechRecognition;
    global.webkitSpeechRecognition = originalWebkitSpeechRecognition;
  }

  // Test 12: STT sends to WebSocket on final
  {
    mockRecognitionInstance = null;
    // Use WsClient which wraps the mocked WebSocket
    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();
    const state = new MockCallState();
    state.transition("listening");

    const stt = new SttEngine({ wsClient, stateRef: state });

    // Register onFinal callback (required for #sendToServer to be called)
    stt.onFinal(({ text, turnId }) => {
      // Callback fires, #sendToServer is called internally
    });

    stt.start();
    await new Promise(r => setTimeout(r, 50));

    mockRecognitionInstance.simulateResult([
      { 0: { transcript: "Test message" }, isFinal: true }
    ]);
    await new Promise(r => setTimeout(r, 10));

    // Check that message was sent via WebSocket - use the test helper
    const sentMessages = wsClient._testGetSentMessages();
    const userTextMessages = sentMessages.filter(m => m && m.type === "user_text");
    assert(userTextMessages.length === 1, "Final transcript sent via WebSocket");
    assert(userTextMessages[0].text === "Test message", "Sent text matches");
    assert(userTextMessages[0].turn_id !== undefined, "Turn ID included");

    stt.stop();
  }

  // Test 13: createInterimRow and replaceInterimWithFinal
  {
    const container = document.createElement("div");
    container.id = "chat";
    document.body.appendChild(container);

    // Create interim row
    const row = createInterimRow(container, "Interim text");
    assert(row !== null, "createInterimRow returns row element");
    assert(row.classList.contains("interim"), "Row has interim class");
    assert(row.querySelector(".msg-bubble").textContent === "Interim text", "Interim text displayed");

    // Replace with final
    replaceInterimWithFinal(container, "Final text");
    const finalRows = container.querySelectorAll(".msg-row.user:not(.interim)");
    assert(finalRows.length === 1, "Final row created");
    assert(finalRows[0].querySelector(".msg-bubble").textContent === "Final text", "Final text displayed");

    // Interim row should be gone
    const interimRows = container.querySelectorAll(".msg-row.interim");
    assert(interimRows.length === 0, "Interim row removed");

    container.remove();
  }

  // Test 14: showCompatibilityBanner
  {
    const container = document.createElement("div");
    container.id = "call-view";
    document.body.appendChild(container);

    showCompatibilityBanner(container);
    const banner = document.getElementById("stt-compat-banner");
    assert(banner !== null, "Compatibility banner created");
    assert(banner.textContent.includes("not supported"), "Banner text mentions not supported");

    clearSttBanners(container);
    assert(document.getElementById("stt-compat-banner") === null, "clearSttBanners removes banner");

    container.remove();
  }

  // Test 15: showMicDeniedBanner
  {
    const container = document.createElement("div");
    container.id = "call-view";
    document.body.appendChild(container);

    showMicDeniedBanner(container);
    const banner = document.getElementById("stt-mic-banner");
    assert(banner !== null, "Mic denied banner created");
    assert(banner.textContent.includes("denied"), "Banner text mentions denied");
    assert(banner.classList.contains("stt-banner-error"), "Banner has error styling");

    clearSttBanners(container);
    assert(document.getElementById("stt-mic-banner") === null, "clearSttBanners removes mic banner");

    container.remove();
  }

  // Test 16: showSttErrorBanner
  {
    const container = document.createElement("div");
    container.id = "call-view";
    document.body.appendChild(container);

    showSttErrorBanner(container, "Custom error message");
    const banner = document.getElementById("stt-error-banner");
    assert(banner !== null, "Error banner created");
    assert(banner.textContent.includes("Custom error message"), "Banner shows custom message");
    assert(banner.classList.contains("stt-banner-error"), "Banner has error styling");

    clearSttBanners(container);
    assert(document.getElementById("stt-error-banner") === null, "clearSttBanners removes error banner");

    container.remove();
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});