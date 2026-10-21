/** Unit tests for CallState machine (F04).
 * Run with: node tests/test_state_machine.js
 */

import { CallState } from "../frontend/js/state.js";

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

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  ✗ ${message} (expected throw)`);
    failed++;
  } catch (e) {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

console.log("Running CallState tests...\n");

const state = new CallState();

// Test 1: Initial state is idle
assert(state.getState() === "idle", "Initial state is 'idle'");

// Test 2: Valid transition idle -> connecting
state.transition("connecting");
assert(state.getState() === "connecting", "Valid transition: idle -> connecting");

// Test 3: Valid transition connecting -> listening
state.transition("listening");
assert(state.getState() === "listening", "Valid transition: connecting -> listening");

// Test 4: Valid transition listening -> thinking
state.transition("thinking");
assert(state.getState() === "thinking", "Valid transition: listening -> thinking");

// Test 5: Valid transition thinking -> speaking
state.transition("speaking");
assert(state.getState() === "speaking", "Valid transition: thinking -> speaking");

// Test 6: Valid transition speaking -> listening
state.transition("listening");
assert(state.getState() === "listening", "Valid transition: speaking -> listening");

// Test 7: Valid transition listening -> ended
state.transition("ended");
assert(state.getState() === "ended", "Valid transition: listening -> ended");

// Test 8: Valid transition ended -> idle
state.transition("idle");
assert(state.getState() === "idle", "Valid transition: ended -> idle");

// Test 9: Invalid transition idle -> speaking (should throw)
const state2 = new CallState();
assertThrows(
  () => state2.transition("speaking"),
  "Invalid transition idle -> speaking throws"
);

// Test 10: Invalid transition idle -> thinking (should throw)
const state3 = new CallState();
assertThrows(
  () => state3.transition("thinking"),
  "Invalid transition idle -> thinking throws"
);

// Test 11: Invalid transition connecting -> speaking (should throw)
const state4 = new CallState();
state4.transition("connecting");
assertThrows(
  () => state4.transition("speaking"),
  "Invalid transition connecting -> speaking throws"
);

// Test 12: Invalid transition ended -> connecting (should throw)
const state5 = new CallState();
state5.transition("connecting");
state5.transition("listening");
state5.transition("ended");
assertThrows(
  () => state5.transition("connecting"),
  "Invalid transition ended -> connecting throws"
);

// Test 13: Error state can go to idle
const state6 = new CallState();
state6.transition("connecting");
state6.transition("error");
assert(state6.getState() === "error", "Can transition to error");
state6.transition("idle");
assert(state6.getState() === "idle", "Error -> idle is valid");

// Test 14: Error state can go to connecting
const state7 = new CallState();
state7.transition("connecting");
state7.transition("error");
state7.transition("connecting");
assert(state7.getState() === "connecting", "Error -> connecting is valid");

// Test 15: onchange listener fires on transition
const state8 = new CallState();
let lastState = null;
state8.onchange((s) => { lastState = s; });
state8.transition("connecting");
assert(lastState === "connecting", "onchange fires on transition");

// Test 16: onchange listener can be unsubscribed
const state9 = new CallState();
let count = 0;
const unsubscribe = state9.onchange(() => { count++; });
state9.transition("connecting");
assert(count === 1, "Listener fires once");
unsubscribe();
state9.transition("listening");
assert(count === 1, "Listener does not fire after unsubscribe");

// Test 17: reset() returns to idle
const state10 = new CallState();
state10.transition("connecting");
state10.transition("listening");
state10.reset();
assert(state10.getState() === "idle", "reset() returns to idle");

// Test 18: reset() fires onchange
const state11 = new CallState();
let resetFired = false;
state11.onchange(() => { resetFired = true; });
state11.transition("connecting");
state11.reset();
assert(resetFired, "reset() fires onchange");

// Test 19: Double ended is no-op (no throw)
const state12 = new CallState();
state12.transition("connecting");
state12.transition("listening");
state12.transition("ended");
state12.transition("ended"); // Should not throw
assert(state12.getState() === "ended", "Double ended is no-op");

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);