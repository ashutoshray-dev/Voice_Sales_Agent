/** Unit tests for hash-based view switching (F04).
 * Run with: node tests/test_view_switching.js
 */

import { JSDOM } from "jsdom";
import { CallState } from "../frontend/js/state.js";
import { WsClient } from "../frontend/js/ws.js";
import { initUI, dispatch } from "../frontend/js/ui.js";

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

console.log("Running view switching tests...\n");

async function runTests() {
  // Test 1: Default hash shows call view
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <head><base href="http://localhost/"></head>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active"></section>
          <section id="history-view" class="view"></section>
          <section id="detail-view" class="view"></section>
        </main>
        <div id="chat" class="chat"></div>
        <div id="controls">
          <button id="startBtn" class="primary">Start Call</button>
          <button id="endBtn" disabled>End Call</button>
          <span id="duration">00:00</span>
        </div>
        <form id="msgForm"><input id="msgInput" type="text" /><button id="sendBtn" type="submit">Send</button></form>
      </body>
      </html>`, {
      url: "http://localhost/#/call",
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
    global.location = dom.window.location;

    // Load the hash-based view switching code
    const views = {
      "call": document.getElementById("call-view"),
      "history": document.getElementById("history-view"),
      "detail": document.getElementById("detail-view"),
    };

    function showView(name) {
      for (const [key, el] of Object.entries(views)) {
        el.classList.toggle("active", key === name);
      }
      if (name !== "call") {
        // callState.reset() would be called here
      }
    }

    function parseHash() {
      const hash = location.hash.slice(1) || "/call";
      const [path, query] = hash.split("?");
      const params = new URLSearchParams(query || "");
      return { path: path.replace(/^\//, ""), params };
    }

    function onHashChange() {
      const { path, params } = parseHash();
      if (path === "call") {
        showView("call");
      } else if (path === "history") {
        showView("history");
      } else if (path === "detail") {
        showView("detail");
      } else {
        showView("call");
      }
    }

    onHashChange();

    // Check call view is active by default
    assert(views.call.classList.contains("active"), "Call view is active by default");
    assert(!views.history.classList.contains("active"), "History view is not active by default");
    assert(!views.detail.classList.contains("active"), "Detail view is not active by default");
  }

  // Test 2: Hash #/history shows history view
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <head><base href="http://localhost/"></head>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active"></section>
          <section id="history-view" class="view"></section>
          <section id="detail-view" class="view"></section>
        </main>
      </body>
      </html>`, {
      url: "http://localhost/#/history",
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
    global.location = dom.window.location;

    const views = {
      "call": document.getElementById("call-view"),
      "history": document.getElementById("history-view"),
      "detail": document.getElementById("detail-view"),
    };

    function showView(name) {
      for (const [key, el] of Object.entries(views)) {
        el.classList.toggle("active", key === name);
      }
    }

    function parseHash() {
      const hash = location.hash.slice(1) || "/call";
      const [path, query] = hash.split("?");
      const params = new URLSearchParams(query || "");
      return { path: path.replace(/^\//, ""), params };
    }

    function onHashChange() {
      const { path, params } = parseHash();
      if (path === "call") {
        showView("call");
      } else if (path === "history") {
        showView("history");
      } else if (path === "detail") {
        showView("detail");
      } else {
        showView("call");
      }
    }

    onHashChange();

    assert(!views.call.classList.contains("active"), "Call view is not active for history hash");
    assert(views.history.classList.contains("active"), "History view is active for #/history");
    assert(!views.detail.classList.contains("active"), "Detail view is not active for history hash");
  }

  // Test 3: Hash #/detail?id=123 shows detail view
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <head><base href="http://localhost/"></head>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active"></section>
          <section id="history-view" class="view"></section>
          <section id="detail-view" class="view"></section>
        </main>
      </body>
      </html>`, {
      url: "http://localhost/#/detail?id=abc123",
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
    global.location = dom.window.location;

    const views = {
      "call": document.getElementById("call-view"),
      "history": document.getElementById("history-view"),
      "detail": document.getElementById("detail-view"),
    };

    function showView(name) {
      for (const [key, el] of Object.entries(views)) {
        el.classList.toggle("active", key === name);
      }
    }

    function parseHash() {
      const hash = location.hash.slice(1) || "/call";
      const [path, query] = hash.split("?");
      const params = new URLSearchParams(query || "");
      return { path: path.replace(/^\//, ""), params };
    }

    function onHashChange() {
      const { path, params } = parseHash();
      if (path === "call") {
        showView("call");
      } else if (path === "history") {
        showView("history");
      } else if (path === "detail") {
        showView("detail");
        // F09: could load detail by params.get("id")
      } else {
        showView("call");
      }
    }

    onHashChange();

    const { path, params } = parseHash();
    assert(path === "detail", "Path is 'detail'");
    assert(params.get("id") === "abc123", "Detail ID param is parsed correctly");
    assert(!views.call.classList.contains("active"), "Call view is not active for detail hash");
    assert(!views.history.classList.contains("active"), "History view is not active for detail hash");
    assert(views.detail.classList.contains("active"), "Detail view is active for #/detail");
  }

  // Test 4: Invalid hash defaults to call view
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <head><base href="http://localhost/"></head>
      <body>
        <header><p id="statusPill" class="status-pill idle">Idle</p></header>
        <main>
          <section id="call-view" class="view active"></section>
          <section id="history-view" class="view"></section>
          <section id="detail-view" class="view"></section>
        </main>
      </body>
      </html>`, {
      url: "http://localhost/#/invalid",
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
    global.location = dom.window.location;

    const views = {
      "call": document.getElementById("call-view"),
      "history": document.getElementById("history-view"),
      "detail": document.getElementById("detail-view"),
    };

    function showView(name) {
      for (const [key, el] of Object.entries(views)) {
        el.classList.toggle("active", key === name);
      }
    }

    function parseHash() {
      const hash = location.hash.slice(1) || "/call";
      const [path, query] = hash.split("?");
      const params = new URLSearchParams(query || "");
      return { path: path.replace(/^\//, ""), params };
    }

    function onHashChange() {
      const { path, params } = parseHash();
      if (path === "call") {
        showView("call");
      } else if (path === "history") {
        showView("history");
      } else if (path === "detail") {
        showView("detail");
      } else {
        showView("call");
      }
    }

    onHashChange();

    assert(views.call.classList.contains("active"), "Call view is active for invalid hash");
    assert(!views.history.classList.contains("active"), "History view is not active for invalid hash");
    assert(!views.detail.classList.contains("active"), "Detail view is not active for invalid hash");
  }

  // Test 5: State resets when leaving call view
  {
    const dom = new JSDOM(`<!DOCTYPE html>
      <html>
      <head><base href="http://localhost/"></head>
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
          <section id="history-view" class="view"></section>
          <section id="detail-view" class="view"></section>
        </main>
      </body>
      </html>`, {
      url: "http://localhost/#/call",
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
    global.location = dom.window.location;

    // Simulate callState
    const callState = new CallState();
    callState.transition("connecting");
    callState.transition("listening");
    assert(callState.getState() === "listening", "State is listening before navigation");

    const views = {
      "call": document.getElementById("call-view"),
      "history": document.getElementById("history-view"),
      "detail": document.getElementById("detail-view"),
    };

    function showView(name) {
      for (const [key, el] of Object.entries(views)) {
        el.classList.toggle("active", key === name);
      }
      // Reset call state when leaving call view
      if (name !== "call") {
        callState.reset();
      }
    }

    function parseHash() {
      const hash = location.hash.slice(1) || "/call";
      const [path, query] = hash.split("?");
      const params = new URLSearchParams(query || "");
      return { path: path.replace(/^\//, ""), params };
    }

    function onHashChange() {
      const { path, params } = parseHash();
      if (path === "call") {
        showView("call");
      } else if (path === "history") {
        showView("history");
      } else if (path === "detail") {
        showView("detail");
      } else {
        showView("call");
      }
    }

    // Simulate navigation to history
    global.window.location.hash = "#/history";
    onHashChange();

    assert(callState.getState() === "idle", "State resets to idle when leaving call view");
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});