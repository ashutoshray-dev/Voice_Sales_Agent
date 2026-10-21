/** Unit tests for UI events (F04).
 * Run with: node tests/test_ui_events.js
 * Uses JSDOM to simulate DOM.
 */

import { JSDOM } from "jsdom";
import { initUI, dispatch } from "../frontend/js/ui.js";
import { CallState } from "../frontend/js/state.js";
import { WsClient } from "../frontend/js/ws.js";

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

// Mock WebSocket for testing
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.sentMessages = [];
    // Simulate async open
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen({});
    }, 0);
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose({ wasClean: true, code, reason });
  }

  // Simulate receiving a message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// Patch global WebSocket
global.WebSocket = MockWebSocket;

// Mock crypto.randomUUID for tests using Object.defineProperty
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2)
  },
  configurable: true,
  writable: true
});

console.log("Running UI events tests...\n");

async function runTests() {
  // Test 1: Chat panel appends user message on send
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header>
          <p id="statusPill" class="status-pill idle">Idle</p>
        </header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm" class="msg-form">
              <input id="msgInput" type="text" placeholder="Type a message…" />
              <button id="sendBtn" type="submit">Send</button>
            </form>
          </section>
        </main>
      </body>
      </html>`, {
      url: "http://localhost",
      pretendToBeVisual: true,
    });

    global.window = dom.window;
    global.document = dom.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom.window.navigator,
      configurable: true,
      writable: true
    });
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Event = dom.window.Event;
    global.CustomEvent = dom.window.CustomEvent;

    const state = new CallState();
    state.transition("connecting");
    state.transition("listening");

    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const chatEl = document.getElementById("chat");
    const msgInput = document.getElementById("msgInput");
    const msgForm = document.getElementById("msgForm");

    msgInput.value = "Hello bot";
    msgForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    // Wait for microtasks
    await new Promise(r => setTimeout(r, 10));

    const userRows = chatEl.querySelectorAll(".msg-row.user");
    assert(userRows.length === 1, "User message row appended");
    assert(userRows[0].querySelector(".msg-bubble").textContent === "Hello bot", "User message text correct");

    uiCleanup();
  }

  // Test 2: Chat panel shows bot streaming message
  {
    const dom2 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom2.window;
    global.document = dom2.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom2.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    state.transition("connecting");
    state.transition("listening");

    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const chatEl = document.getElementById("chat");
    const msgInput = document.getElementById("msgInput");
    const msgForm = document.getElementById("msgForm");

    msgInput.value = "Test";
    msgForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    // Simulate bot streaming delta
    wsClient._testSimulateMessage({ type: "delta", text: "Hello " });
    await new Promise(r => setTimeout(r, 10));

    const botRows = chatEl.querySelectorAll(".msg-row.bot");
    assert(botRows.length === 1, "Bot message row created");
    const bubble = botRows[0].querySelector(".msg-bubble");
    assert(bubble.textContent === "Hello ", "Bot delta text appended");
    assert(bubble.classList.contains("streaming"), "Streaming cursor present");

    // Simulate another delta
    wsClient._testSimulateMessage({ type: "delta", text: "world" });
    await new Promise(r => setTimeout(r, 10));
    assert(bubble.textContent === "Hello world", "Multiple deltas concatenated");

    // Simulate done
    wsClient._testSimulateMessage({ type: "done", turn_id: "test" });
    await new Promise(r => setTimeout(r, 10));
    assert(!bubble.classList.contains("streaming"), "Streaming cursor removed on done");

    uiCleanup();
  }

  // Test 3: State transitions update status pill
  {
    const dom3 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom3.window;
    global.document = dom3.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom3.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const statusPill = document.getElementById("statusPill");

    state.transition("connecting");
    assert(statusPill.textContent === "Connecting…", "Status pill shows connecting");
    assert(statusPill.classList.contains("connecting"), "Status pill has connecting class");

    state.transition("listening");
    assert(statusPill.textContent === "Listening…", "Status pill shows listening");

    state.transition("thinking");
    assert(statusPill.textContent === "Thinking…", "Status pill shows thinking");

    state.transition("speaking");
    assert(statusPill.textContent === "Speaking…", "Status pill shows speaking");

    state.transition("ended");
    assert(statusPill.textContent === "Ended", "Status pill shows ended");

    uiCleanup();
  }

  // Test 4: Buttons enable/disable based on state
  {
    const dom4 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom4.window;
    global.document = dom4.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom4.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const startBtn = document.getElementById("startBtn");
    const endBtn = document.getElementById("endBtn");

    // Idle: start enabled, end disabled
    assert(!startBtn.disabled, "Start enabled in idle");
    assert(endBtn.disabled, "End disabled in idle");

    state.transition("connecting");
    assert(startBtn.disabled, "Start disabled in connecting");
    assert(endBtn.disabled, "End disabled in connecting");

    state.transition("listening");
    assert(startBtn.disabled, "Start disabled in listening");
    assert(!endBtn.disabled, "End enabled in listening");

    state.transition("ended");
    assert(startBtn.disabled, "Start disabled in ended");
    assert(endBtn.disabled, "End disabled in ended");

    state.transition("idle");
    assert(!startBtn.disabled, "Start enabled back in idle");
    assert(endBtn.disabled, "End disabled back in idle");

    uiCleanup();
  }

  // Test 5: Timer starts on connecting, stops on ended
  {
    const dom5 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom5.window;
    global.document = dom5.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom5.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const durationEl = document.getElementById("duration");

    state.transition("connecting");
    await new Promise(r => setTimeout(r, 1100)); // Wait for 1 tick
    assert(durationEl.textContent === "00:01", "Timer increments after 1 second");

    await new Promise(r => setTimeout(r, 1100));
    assert(durationEl.textContent === "00:02", "Timer increments after 2 seconds");

    state.transition("ended");
    const stoppedTime = durationEl.textContent;
    await new Promise(r => setTimeout(r, 1100));
    assert(durationEl.textContent === stoppedTime, "Timer stops on ended");

    uiCleanup();
  }

  // Test 6: Error message displayed on server error
  {
    const dom6 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom6.window;
    global.document = dom6.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom6.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    state.transition("connecting");
    state.transition("listening");

    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const chatEl = document.getElementById("chat");

    wsClient._testSimulateMessage({ type: "error", message: "Rate limit exceeded" });
    await new Promise(r => setTimeout(r, 10));

    const botRows = chatEl.querySelectorAll(".msg-row.bot");
    assert(botRows.length === 1, "Error message row appended");
    assert(botRows[0].querySelector(".msg-bubble").textContent.includes("Rate limit"), "Error message shown");

    assert(state.getState() === "error", "State transitions to error");

    uiCleanup();
  }

  // Test 7: Double End Call is no-op
  {
    const dom7 = new JSDOM(`<!DOCTYPE html>
      <html>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active">
            <div id="chat" class="chat"></div>
            <div id="controls">
              <button id="startBtn" class="primary">Start Call</button>
              <button id="endBtn" disabled>End Call</button>
              <span id="duration">00:00</span>
            </div>
            <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
          </section>
        </main>
      </body>
      </html>`, { url: "http://localhost", pretendToBeVisual: true });

    global.window = dom7.window;
    global.document = dom7.window.document;
    Object.defineProperty(global, 'navigator', {
      value: dom7.window.navigator,
      configurable: true,
      writable: true
    });

    const state = new CallState();
    state.transition("connecting");
    state.transition("listening");

    const wsClient = new WsClient("ws://localhost/ws");
    await wsClient.connect();

    let uiCleanup = initUI(state, wsClient);

    const endBtn = document.getElementById("endBtn");

    endBtn.click(); // First click
    assert(state.getState() === "ended", "First click ends call");

    endBtn.click(); // Second click
    assert(state.getState() === "ended", "Second click does nothing (no throw)");

    uiCleanup();
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});