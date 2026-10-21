// F01 stub — minimal page wiring so the frontend loads without errors.
// Full call UI, WebSocket, Web Speech, and recording arrive in F04-F07.

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");

function setStatus(text) {
  statusEl.textContent = text;
}

startBtn.addEventListener("click", () => {
  setStatus("Starting call...");
  startBtn.disabled = true;
  endBtn.disabled = false;
  // F05/F06 will open a WebSocket and request mic here.
});

endBtn.addEventListener("click", () => {
  setStatus("Idle");
  startBtn.disabled = false;
  endBtn.disabled = true;
});