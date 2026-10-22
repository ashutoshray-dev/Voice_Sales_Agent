/** Unit tests for Recorder (F07).
 * Run with: node tests/test_recorder.js
 * Uses JSDOM to simulate DOM and mock MediaRecorder, AudioContext.
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
  value: { language: "en-US", mediaDevices: { getUserMedia: async () => {} } },
  configurable: true,
  writable: true
});
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Event = dom.window.Event;
global.CustomEvent = dom.window.CustomEvent;
global.HTMLAudioElement = dom.window.HTMLAudioElement;
global.Blob = dom.window.Blob;

// Mock MediaStream
class MockMediaStream {
  constructor() {
    this.tracks = [];
  }
  getTracks() { return this.tracks; }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track); }
}
global.MediaStream = MockMediaStream;

// Mock AudioContext
let mockAudioContextInstance = null;
const mockAudioDestination = {
  stream: new MockMediaStream(),
  connect: () => {},
  disconnect: () => {},
};

class MockAudioContext {
  constructor() {
    mockAudioContextInstance = this;
    this.state = "running";
    this.destination = mockAudioDestination;
  }
  createMediaStreamSource(stream) {
    return {
      connect: () => {},
      disconnect: () => {},
      mediaStream: stream,
    };
  }
  createMediaElementSource(audioEl) {
    return {
      connect: () => {},
      disconnect: () => {},
      mediaElement: audioEl,
    };
  }
  createMediaStreamDestination() {
    return mockAudioDestination;
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}
global.AudioContext = MockAudioContext;
global.webkitAudioContext = MockAudioContext;
dom.window.AudioContext = MockAudioContext;
dom.window.webkitAudioContext = MockAudioContext;

// Mock MediaRecorder
let mockMediaRecorderInstance = null;
let mockMediaRecorderOndataavailable = null;
let mockMediaRecorderOnstop = null;
let mockMediaRecorderOnerror = null;

class MockMediaRecorder {
  static isTypeSupported(mimeType) {
    // Support both opus and default webm
    return mimeType === "audio/webm;codecs=opus" || mimeType === "audio/webm";
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = "inactive";
    mockMediaRecorderInstance = this;
  }

  start(timeslice) {
    this.state = "recording";
    // Simulate data available events
    if (timeslice) {
      setInterval(() => {
        if (this.state === "recording" && mockMediaRecorderOndataavailable) {
          const blob = new Blob(["fake audio data"], { type: this.mimeType });
          mockMediaRecorderOndataavailable({ data: blob });
        }
      }, timeslice);
    }
  }

  stop() {
    this.state = "inactive";
    // Simulate final data available
    if (mockMediaRecorderOndataavailable) {
      const blob = new Blob(["fake audio data"], { type: this.mimeType });
      mockMediaRecorderOndataavailable({ data: blob });
    }
    // Call onstop after a tick
    setTimeout(() => {
      if (mockMediaRecorderOnstop) {
        mockMediaRecorderOnstop({});
      }
    }, 0);
  }

  get ondataavailable() {
    return mockMediaRecorderOndataavailable;
  }
  set ondataavailable(cb) {
    mockMediaRecorderOndataavailable = cb;
  }

  get onstop() {
    return mockMediaRecorderOnstop;
  }
  set onstop(cb) {
    mockMediaRecorderOnstop = cb;
  }

  get onerror() {
    return mockMediaRecorderOnerror;
  }
  set onerror(cb) {
    mockMediaRecorderOnerror = cb;
  }
}
global.MediaRecorder = MockMediaRecorder;
dom.window.MediaRecorder = MockMediaRecorder;

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2)
  },
  configurable: true,
  writable: true
});

// Mock URL.createObjectURL/revokeObjectURL
global.URL = {
  createObjectURL: (blob) => "blob:mock-url",
  revokeObjectURL: (url) => {},
};

// Now import the Recorder after globals are set up
import { createRecorder, Recorder, isRecordingSupported } from "../frontend/js/recorder.js";

console.log("Running Recorder tests...\n");

async function runTests() {
  // Test 1: isRecordingSupported returns true when MediaRecorder supported
  {
    assert(isRecordingSupported() === true, "isRecordingSupported() returns true");
  }

  // Test 2: Recorder construction
  {
    const recorder = createRecorder({ consentGiven: true });
    assert(recorder instanceof Recorder, "Recorder constructs successfully");
    assert(recorder.isRecording() === false, "isRecording() false initially");
  }

  // Test 3: Recorder with no consent is no-op
  {
    const recorder = createRecorder({ consentGiven: false });
    await recorder.start(new MediaStream(), null);
    assert(recorder.isRecording() === false, "Recorder no-op when no consent");
  }

  // Test 4: Recorder starts and stops successfully
  {
    mockMediaRecorderInstance = null;
    mockMediaRecorderOndataavailable = null;
    mockMediaRecorderOnstop = null;

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();

    await recorder.start(mockStream, null);
    assert(recorder.isRecording() === true, "Recorder is recording after start()");
    assert(mockMediaRecorderInstance !== null, "MediaRecorder created");

    const blob = await recorder.stop();
    assert(blob instanceof Blob, "stop() returns Blob");
    assert(blob.size > 0, "Blob has data");
    assert(recorder.isRecording() === false, "Recorder not recording after stop()");
  }

  // Test 5: onData callback receives chunks
  {
    mockMediaRecorderInstance = null;
    mockMediaRecorderOndataavailable = null;
    mockMediaRecorderOnstop = null;

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();
    let chunksReceived = [];

    recorder.onData((chunk) => {
      chunksReceived.push(chunk);
    });

    await recorder.start(mockStream, null);
    // Wait for a couple of data events
    await new Promise(r => setTimeout(r, 250));

    await recorder.stop();

    assert(chunksReceived.length > 0, "onData callback receives chunks");
    assert(chunksReceived.every(c => c instanceof Blob), "All chunks are Blobs");
  }

  // Test 6: Recorder with bot audio element
  {
    mockMediaRecorderInstance = null;
    mockMediaRecorderOndataavailable = null;
    mockMediaRecorderOnstop = null;

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();
    const mockAudioEl = document.createElement("audio");

    await recorder.start(mockStream, mockAudioEl);
    assert(recorder.isRecording() === true, "Recorder starts with bot audio element");

    // Test setBotAudio
    const mockAudioEl2 = document.createElement("audio");
    recorder.setBotAudio(mockAudioEl2);
    // Should not throw

    await recorder.stop();
    assert(recorder.isRecording() === false, "Recorder stops correctly");
  }

  // Test 7: Recorder falls back to default webm codec if opus not supported
  {
    // Temporarily change isTypeSupported to only support default webm
    const originalIsTypeSupported = MockMediaRecorder.isTypeSupported;
    MockMediaRecorder.isTypeSupported = (mimeType) => mimeType === "audio/webm";

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();

    await recorder.start(mockStream, null);
    assert(recorder.isRecording() === true, "Recorder starts with fallback codec");
    assert(mockMediaRecorderInstance.mimeType === "audio/webm", "Uses fallback mimeType");

    await recorder.stop();

    // Restore
    MockMediaRecorder.isTypeSupported = originalIsTypeSupported;
  }

  // Test 8: Recorder handles MediaRecorder not supported
  {
    const originalMediaRecorder = global.MediaRecorder;
    const originalWindowMediaRecorder = dom.window.MediaRecorder;
    global.MediaRecorder = undefined;
    dom.window.MediaRecorder = undefined;

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();

    await recorder.start(mockStream, null);
    assert(recorder.isRecording() === false, "Recorder no-op when MediaRecorder not supported");

    global.MediaRecorder = originalMediaRecorder;
    dom.window.MediaRecorder = originalWindowMediaRecorder;
  }

  // Test 9: Recorder handles AudioContext not supported
  {
    const originalAudioContext = global.AudioContext;
    const originalWindowAudioContext = dom.window.AudioContext;
    const originalWindowWebkitAudioContext = dom.window.webkitAudioContext;
    global.AudioContext = undefined;
    dom.window.AudioContext = undefined;
    dom.window.webkitAudioContext = undefined;

    const recorder = createRecorder({ consentGiven: true });
    const mockStream = new MediaStream();

    await recorder.start(mockStream, null);
    assert(recorder.isRecording() === false, "Recorder no-op when AudioContext not supported");

    global.AudioContext = originalAudioContext;
    dom.window.AudioContext = originalWindowAudioContext;
    dom.window.webkitAudioContext = originalWindowWebkitAudioContext;
  }

  // Test 10: Stop when not recording returns null
  {
    const recorder = createRecorder({ consentGiven: true });
    const blob = await recorder.stop();
    assert(blob === null, "stop() returns null when not recording");
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});