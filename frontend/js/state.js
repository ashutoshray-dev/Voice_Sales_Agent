/** CallState — a tiny state machine for the call screen.
 *
 * States: idle, connecting, listening, thinking, speaking, ended, error
 * Transitions are the only way to change state; invalid transitions throw.
 */
export class CallState {
  #state = "idle";
  #listeners = new Set();

  // Valid transitions: from -> allowed next states
  static #transitions = {
    idle: ["connecting", "error"],
    connecting: ["listening", "error", "ended"],
    listening: ["thinking", "ended", "error"],
    thinking: ["speaking", "ended", "error"],
    speaking: ["listening", "ended", "error"],
    ended: ["idle"],
    error: ["idle", "connecting"],
  };

  /** Current state */
  getState() {
    return this.#state;
  }

  /** Subscribe to state changes */
  onchange(cb) {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /** Attempt a transition; throws if invalid. Self-transitions are no-ops. */
  transition(to) {
    // Self-transition is a no-op (per spec: double End Call is no-op)
    if (to === this.#state) {
      return;
    }
    const allowed = CallState.#transitions[this.#state] ?? [];
    if (!allowed.includes(to)) {
      const err = new Error(`Invalid transition: ${this.#state} → ${to}`);
      err.from = this.#state;
      err.to = to;
      throw err;
    }
    this.#state = to;
    this.#notify();
  }

  /** Reset to idle (used when navigating away) */
  reset() {
    this.#state = "idle";
    this.#notify();
  }

  #notify() {
    for (const cb of this.#listeners) {
      try {
        cb(this.#state);
      } catch (e) {
        console.error("CallState listener error:", e);
      }
    }
  }
}

// Export singleton for convenience
export const callState = new CallState();