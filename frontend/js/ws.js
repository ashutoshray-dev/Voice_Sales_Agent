/** WsClient — wraps a WebSocket connection for the call.
 *
 * One WebSocket per call; no reconnection logic (per spec).
 * Message protocol matches app/routers/ws.py
 */
export class WsClient {
  #ws = null;
  #url;
  #onMessageCb = null;
  #onCloseCb = null;
  #onOpenCb = null;

  constructor(url) {
    this.#url = url;
  }

  /** Open the WebSocket connection. Returns a promise that resolves on open, rejects on error. */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.#ws = new WebSocket(this.#url);

      this.#ws.onopen = () => {
        console.log("[WsClient] Connected");
        // Hide cold-start overlay on successful connection
        const coldStartOverlay = document.getElementById("coldStartOverlay");
        if (coldStartOverlay) {
          coldStartOverlay.hidden = true;
        }
        // Also hide connection error overlay if shown
        const connectionErrorOverlay = document.getElementById("connectionErrorOverlay");
        if (connectionErrorOverlay) {
          connectionErrorOverlay.hidden = true;
        }
        if (this.#onOpenCb) {
          this.#onOpenCb();
        }
        resolve();
      };

      this.#ws.onerror = (err) => {
        console.error("[WsClient] Error:", err);
        // onclose will fire after this; we don't reject here to avoid double-handling
      };

      this.#ws.onclose = (event) => {
        console.log("[WsClient] Closed:", event.code, event.reason);
        const wasClean = event.wasClean;
        this.#ws = null;
        if (this.#onCloseCb) {
          this.#onCloseCb({ wasClean, code: event.code, reason: event.reason });
        }
      };

      this.#ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.#onMessageCb) {
            this.#onMessageCb(data);
          }
        } catch (e) {
          console.warn("[WsClient] Failed to parse message:", event.data, e);
        }
      };
    });
  }

  /** Register open handler. */
  onOpen(cb) {
    this.#onOpenCb = cb;
  }

  /** Send a JSON-serializable object. */
  send(obj) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      console.warn("[WsClient] Cannot send: not connected");
      return false;
    }
    this.#ws.send(JSON.stringify(obj));
    return true;
  }

  /** Register message handler. */
  onMessage(cb) {
    this.#onMessageCb = cb;
  }

  /** Register close handler. */
  onClose(cb) {
    this.#onCloseCb = cb;
  }

  /** Close the connection gracefully. */
  close() {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.close(1000, "Client ended call");
    }
    this.#ws = null;
  }

  /** Current readyState (WebSocket.CONNECTING, OPEN, CLOSING, CLOSED) or null if no socket. */
  get readyState() {
    return this.#ws ? this.#ws.readyState : null;
  }

  /** Test helper: simulate receiving a message (only works with MockWebSocket). */
  _testSimulateMessage(data) {
    if (this.#ws && typeof this.#ws.simulateMessage === "function") {
      this.#ws.simulateMessage(data);
    }
  }

  /** Test helper: get sent messages from internal WebSocket (only works with MockWebSocket). */
  _testGetSentMessages() {
    console.log("[WsClient] _testGetSentMessages called, #ws:", this.#ws);
    if (this.#ws && Array.isArray(this.#ws.sentMessages)) {
      return this.#ws.sentMessages;
    }
    return [];
  }
}