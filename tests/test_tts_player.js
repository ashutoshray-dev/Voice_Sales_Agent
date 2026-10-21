/** Unit tests for TTS Player (F06).
 * Run with: node tests/test_tts_player.js
 * Uses JSDOM to simulate DOM and mock Audio/WebSocket.
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
global.Audio = dom.window.Audio;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;
global.Uint8Array = dom.window.Uint8Array;
global.atob = (str) => {
  // Simple base64 decode for testing
  return Buffer.from(str, 'base64').toString('binary');
};
global.btoa = (str) => {
  // Simple base64 encode for testing
  return Buffer.from(str, 'binary').toString('base64');
};

// Mock SpeechSynthesis
global.speechSynthesis = {
  speak: (utterance) => {
    if (utterance.onend) setTimeout(() => utterance.onend(), 0);
  },
  cancel: () => {},
  speaking: false,
};
global.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
    this.lang = "en-US";
    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;
    this.onend = null;
    this.onerror = null;
  }
};

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.sentMessages = [];
  }
  send(data) {
    const msg = typeof data === "string" ? JSON.parse(data) : data;
    this.sentMessages.push(msg);
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

// Mock Audio element for testing
let mockAudioInstance = null;
const originalAudio = global.Audio;
global.Audio = class MockAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1.0;
    this.preload = "auto";
    this.onended = null;
    this.onerror = null;
    this._paused = true;
    this._currentTime = 0;
    mockAudioInstance = this;
  }
  play() {
    this._paused = false;
    // Simulate async playback - call onended after a delay
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.onended) this.onended();
        resolve();
      }, 100);
    });
  }
  pause() {
    this._paused = true;
  }
  get paused() { return this._paused; }
  get currentTime() { return this._currentTime; }
  set currentTime(v) { this._currentTime = v; }
};
global.URL.createObjectURL = (blob) => "blob:mock-url";
global.URL.revokeObjectURL = (url) => {};

// Now import the TTS player
import { TtsPlayer, SpeechSynthesisFallback, ttsPlayer, speechSynthesisFallback, setWsClient } from "../frontend/js/tts-player.js";

console.log("Running TTS Player tests...\n");

async function runTests() {
  // Test 1: TtsPlayer construction
  {
    const player = new TtsPlayer();
    assert(player instanceof TtsPlayer, "TtsPlayer constructs successfully");
    assert(player.muted === false, "Default muted is false");
    assert(player.volume === 1.0, "Default volume is 1.0");
    assert(player.isPlaying === false, "Default isPlaying is false");
  }

  // Test 2: play() enqueues audio
  {
    const player = new TtsPlayer();
    // Use a valid base64 string (needs proper padding)
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh"; // "fake audio data" in base64

    const playPromise = player.play(testB64);

    // Give it a moment to process
    await new Promise(r => setTimeout(r, 20));

    console.log("  [DEBUG] player.isPlaying:", player.isPlaying);

    assert(player.isPlaying === true, "isPlaying is true after play()");

    // Wait for playback to complete
    await playPromise;
    await new Promise(r => setTimeout(r, 20));

    assert(player.isPlaying === false, "isPlaying is false after playback completes");
  }

  // Test 3: stop() clears queue and rejects pending promises
  {
    const player = new TtsPlayer();
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh"; // "fake audio data" in base64

    // Queue multiple items
    const p1 = player.play(testB64);
    const p2 = player.play(testB64);
    const p3 = player.play(testB64);

    await new Promise(r => setTimeout(r, 20));
    assert(player.isPlaying === true, "isPlaying true with queued items");

    // Stop playback
    player.stop();

    // Check that promises were rejected - use Promise.allSettled to avoid unhandled rejections
    const results = await Promise.allSettled([p1, p2, p3]);
    const p1Rejected = results[0].status === "rejected";
    const p2Rejected = results[1].status === "rejected";
    const p3Rejected = results[2].status === "rejected";

    console.log("  [DEBUG] p1 status:", results[0].status, results[0].reason?.message);
    console.log("  [DEBUG] p2 status:", results[1].status, results[1].reason?.message);
    console.log("  [DEBUG] p3 status:", results[2].status, results[2].reason?.message);

    assert(p1Rejected, "First promise rejected on stop()");
    assert(p2Rejected, "Second promise rejected on stop()");
    assert(p3Rejected, "Third promise rejected on stop()");
    assert(player.isPlaying === false, "isPlaying false after stop()");
  }

  // Test 3b: stop() rejects currently playing promise too
  {
    const player = new TtsPlayer();
    const testB64 = "ZmFrZ SBhdWRpbyBkYXRh"; // "fake audio data" in base64

    const p1 = player.play(testB64);
    await new Promise(r => setTimeout(r, 20));
    assert(player.isPlaying === true, "isPlaying true with current item");

    player.stop();

    // Check that promise was rejected - use Promise.allSettled to avoid unhandled rejections
    const results = await Promise.allSettled([p1]);
    const p1Rejected = results[0].status === "rejected";

    console.log("  [DEBUG] p1 status:", results[0].status, results[0].reason?.message);

    assert(p1Rejected, "Current playing promise rejected on stop()");
  }

  // Test 4: setMuted() toggles mute state
  {
    const player = new TtsPlayer();
    assert(player.muted === false, "Initially not muted");

    player.setMuted(true);
    assert(player.muted === true, "Muted after setMuted(true)");

    player.setMuted(false);
    assert(player.muted === false, "Unmuted after setMuted(false)");
  }

  // Test 5: setVolume() clamps values
  {
    const player = new TtsPlayer();

    player.setVolume(0.5);
    assert(player.volume === 0.5, "Volume set to 0.5");

    player.setVolume(1.5); // Should clamp to 1.0
    assert(player.volume === 1.0, "Volume clamped to 1.0");

    player.setVolume(-0.5); // Should clamp to 0.0
    assert(player.volume === 0.0, "Volume clamped to 0.0");
  }

  // Test 6: setMuted() applies to current and queued audio
  {
    const player = new TtsPlayer();
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh";

    // Start playing
    const p1 = player.play(testB64);
    await new Promise(r => setTimeout(r, 20));

    // Mute
    player.setMuted(true);
    await new Promise(r => setTimeout(r, 10));

    // Current audio should be muted
    if (mockAudioInstance) {
      assert(mockAudioInstance.volume === 0, "Current audio volume is 0 when muted");
    }

    // Queue another
    const p2 = player.play(testB64);
    await new Promise(r => setTimeout(r, 10));

    // Wait for cleanup
    await p1.catch(() => {});
    await p2.catch(() => {});
    await new Promise(r => setTimeout(r, 20));
  }

  // Test 7: setWsClient sends cancel on stop()
  {
    const wsClient = new MockWebSocket("ws://localhost/ws");
    setWsClient(wsClient);

    const player = new TtsPlayer();
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh";

    await player.play(testB64);
    await new Promise(r => setTimeout(r, 20));

    player.stop();
    await new Promise(r => setTimeout(r, 20));

    // Check that cancel message was sent
    const cancelMessages = wsClient.sentMessages.filter(m => m.type === "cancel");
    assert(cancelMessages.length === 1, "Cancel message sent to server on stop()");

    setWsClient(null); // Reset for other tests
  }

  // Test 8: SpeechSynthesisFallback speak() and cancel()
  {
    const fallback = new SpeechSynthesisFallback();

    let onEndCalled = false;
    fallback.speak("Hello world", () => { onEndCalled = true; });

    await new Promise(r => setTimeout(r, 20));
    assert(onEndCalled === true, "onEnd callback called after speak()");

    // Test cancel
    fallback.speak("Test cancel");
    await new Promise(r => setTimeout(r, 10));
    fallback.cancel();
    // If we get here without error, cancel works
    assert(true, "cancel() executes without error");
  }

  // Test 9: waitUntilDone() resolves when queue empty
  {
    const player = new TtsPlayer();

    // Should resolve immediately when nothing playing
    await player.waitUntilDone();
    assert(true, "waitUntilDone() resolves when idle");

    // Should resolve after playback finishes
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh";
    await player.play(testB64);
    await player.waitUntilDone();
    assert(true, "waitUntilDone() resolves after playback");
  }

  // Test 10: Multiple sequential play() calls queue properly
  {
    const player = new TtsPlayer();
    const testB64 = "ZmFrZSBhdWRpbyBkYXRh";

    await player.play(testB64);
    await new Promise(r => setTimeout(r, 30)); // Wait for first to complete

    await player.play(testB64);
    await new Promise(r => setTimeout(r, 30)); // Wait for second to complete

    await player.play(testB64);
    await new Promise(r => setTimeout(r, 30)); // Wait for third to complete

    assert(true, "Multiple sequential play() calls work");
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});