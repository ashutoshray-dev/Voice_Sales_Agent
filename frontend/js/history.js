/** history.js — Call History view (F09).
 *
 * Exports:
 * - initHistory(): initializes the history view, returns cleanup fn
 * - loadHistory(): fetches and renders call list for current device
 * - renderHistoryList(calls): renders the call list
 * - renderCallDetail(call): renders the detail view
 * - filterHistory(status): filters the list by status
 * - getOrCreateDeviceId(): generates/persists device ID
 * - formatDuration(seconds): formats seconds to MM:SS
 * - formatDateTime(isoString): formats ISO timestamp
 * - getCallSummary(call): extracts one-line summary
 * - escapeHtml(text): escapes HTML for XSS prevention
 */

import { dispatch } from "./ui.js";

export { formatDuration, formatDateTime, getCallSummary, escapeHtml, getOrCreateDeviceId };

/** Status badge class mapping */
const STATUS_CLASSES = {
  "Converted": "status-converted",
  "Interested": "status-interested",
  "Follow-up Required": "status-followup",
  "Not Interested": "status-not-interested",
  "Demo Requested": "status-demo",
  "No Response": "status-no-response",
};

/** Status display labels */
const STATUS_LABELS = {
  "Converted": "✅ Converted",
  "Interested": "💡 Interested",
  "Follow-up Required": "📋 Follow-up Required",
  "Not Interested": "❌ Not Interested",
  "Demo Requested": "🎯 Demo Requested",
  "No Response": "📭 No Response",
};

/** Format duration in seconds to MM:SS */
function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** Format ISO timestamp to readable date/time */
function formatDateTime(isoString) {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    // Check for invalid date
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/** Get one-line summary from call analysis */
function getCallSummary(call) {
  // Check if summary is in the call object
  if (call.summary) {
    // Handle both string summary and CallAnalysis object
    if (typeof call.summary === "string") {
      return call.summary;
    }
    if (call.summary.summary) {
      return call.summary.summary;
    }
    // If it's an object with other fields, try to construct a summary
    const parts = [];
    if (call.summary.customer_requirements?.length) {
      parts.push(`Requirements: ${call.summary.customer_requirements.join(", ")}`);
    }
    if (call.summary.objections?.length) {
      parts.push(`Objections: ${call.summary.objections.join(", ")}`);
    }
    return parts.join("; ") || "Call completed";
  }
  return "No summary available";
}

/** Escape HTML to prevent XSS */
function escapeHtml(text) {
  // Use a simple string replacement approach that works in all environments
  // Using Unicode escapes for the replacement strings to avoid encoding issues
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Generate device ID if not exists */
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("voicebot_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("voicebot_device_id", deviceId);
  }
  return deviceId;
}

/** Load history for current device */
export async function loadHistory() {
  const deviceId = getOrCreateDeviceId();
  const listContainer = document.getElementById("history-list");
  const emptyState = document.getElementById("history-empty");
  const errorState = document.getElementById("history-error");

  if (!listContainer) return;

  // Show loading state
  listContainer.innerHTML = '<p class="hint">Loading history...</p>';
  if (emptyState) emptyState.hidden = true;
  if (errorState) errorState.hidden = true;

  try {
    const response = await fetch(`/calls?device_id=${encodeURIComponent(deviceId)}&limit=100`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const calls = await response.json();

    // Store calls globally for filtering
    window.__CALLS_CACHE__ = calls;

    renderHistoryList(calls);
  } catch (e) {
    console.error("[History] Failed to load history:", e);
    if (listContainer) {
      listContainer.innerHTML = "";
    }
    if (errorState) {
      errorState.hidden = false;
      errorState.querySelector(".error-message").textContent = `Could not load history: ${e.message}`;
    }
  }
}

/** Render the call history list */
export function renderHistoryList(calls) {
  const listContainer = document.getElementById("history-list");
  const emptyState = document.getElementById("history-empty");

  if (!listContainer) return;

  if (!calls || calls.length === 0) {
    listContainer.innerHTML = "";
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const rowsHtml = calls.map(call => {
    const status = call.status || "No Response";
    const statusClass = STATUS_CLASSES[status] || "status-no-response";
    const statusLabel = STATUS_LABELS[status] || status;
    const duration = formatDuration(call.duration_sec);
    const date = formatDateTime(call.started_at);
    const summary = escapeHtml(getCallSummary(call));

    return `
      <article class="history-row" data-call-id="${escapeHtml(call.id)}" tabindex="0" role="button" aria-label="View call from ${date}, ${duration}, ${statusLabel}">
        <div class="history-row-main">
          <div class="history-row-date">${escapeHtml(date)}</div>
          <div class="history-row-duration">${escapeHtml(duration)}</div>
        </div>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        <div class="history-row-summary">${summary}</div>
      </article>
    `;
  }).join("");

  listContainer.innerHTML = rowsHtml;

  // Add click/keyboard handlers to rows
  listContainer.querySelectorAll(".history-row").forEach(row => {
    const callId = row.dataset.callId;
    const handleActivate = () => {
      location.hash = `/detail?id=${encodeURIComponent(callId)}`;
    };
    row.addEventListener("click", handleActivate);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActivate();
      }
    });
  });
}

/** Filter history list by status */
export function filterHistory(status) {
  const calls = window.__CALLS_CACHE__ || [];
  const listContainer = document.getElementById("history-list");

  if (!listContainer) return;

  if (status === "All" || !status) {
    renderHistoryList(calls);
    return;
  }

  const filtered = calls.filter(call => call.status === status);
  renderHistoryList(filtered);
}

/** Render call detail view */
export async function renderCallDetail(callId) {
  const detailContainer = document.getElementById("detail-content");
  const backBtn = document.getElementById("detail-back-btn");

  if (!detailContainer) return;

  // Show loading
  detailContainer.innerHTML = '<p class="hint">Loading call details...</p>';

  try {
    const response = await fetch(`/calls/${encodeURIComponent(callId)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const call = await response.json();

    // Store call for potential playback
    window.__CURRENT_CALL__ = call;

    // Render the detail view
    detailContainer.innerHTML = buildDetailHtml(call);

    // Set up audio player if recording exists
    setupAudioPlayer(call);

    // Set up back button
    if (backBtn) {
      backBtn.onclick = () => {
        location.hash = "/history";
      };
    }
  } catch (e) {
    console.error("[History] Failed to load call detail:", e);
    detailContainer.innerHTML = `
      <div class="detail-error">
        <p>⚠️ Failed to load call details</p>
        <p class="error-detail">${escapeHtml(e.message)}</p>
        <button id="detailRetryBtn" class="secondary">Retry</button>
      </div>
    `;
    const retryBtn = document.getElementById("detailRetryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => renderCallDetail(callId));
    }
  }
}

/** Build HTML for call detail view */
function buildDetailHtml(call) {
  const status = call.status || "No Response";
  const statusClass = STATUS_CLASSES[status] || "status-no-response";
  const statusLabel = STATUS_LABELS[status] || status;
  const date = formatDateTime(call.started_at);
  const duration = formatDuration(call.duration_sec);

  // Handle error state
  if (call.error) {
    return `
      <div class="detail-header">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="detail-meta">
        <div class="detail-meta-item"><strong>Date:</strong> ${escapeHtml(date)}</div>
        <div class="detail-meta-item"><strong>Duration:</strong> ${escapeHtml(duration)}</div>
        <div class="detail-meta-item"><strong>Call ID:</strong> ${escapeHtml(call.id)}</div>
      </div>
      <div class="detail-error">
        <p>⚠️ This call ended with an error</p>
        <p class="error-detail">${escapeHtml(call.error)}</p>
      </div>
      <button id="detail-back-btn" class="secondary">Back to History</button>
    `;
  }

  // Transcript
  const transcript = call.transcript || [];
  let transcriptHtml = "";
  if (transcript.length > 0) {
    transcriptHtml = transcript.map(msg => {
      const role = msg.role === "user" ? "You" : "Bot";
      const roleClass = msg.role === "user" ? "transcript-user" : "transcript-bot";
      return `
        <div class="transcript-row ${roleClass}">
          <span class="transcript-role">${escapeHtml(role)}:</span>
          <span class="transcript-text">${escapeHtml(msg.content || "")}</span>
        </div>
      `;
    }).join("");
  } else {
    transcriptHtml = '<p class="empty-list">No transcript available</p>';
  }

  // Summary/Analysis
  const summary = call.summary;
  let analysisHtml = "";
  if (summary) {
    if (typeof summary === "string") {
      analysisHtml = `<p>${escapeHtml(summary)}</p>`;
    } else {
      const reqs = summary.customer_requirements || [];
      const objs = summary.objections || [];
      const steps = summary.next_steps || [];

      analysisHtml = `
        <div class="detail-section">
          <h3>Summary</h3>
          <p>${escapeHtml(summary.summary || "No summary available")}</p>
        </div>
        <div class="detail-section">
          <h3>Customer Requirements</h3>
          <ul class="detail-list">${reqs.map(r => `<li>${escapeHtml(r)}</li>`).join("") || '<li class="empty-list">None</li>'}</ul>
        </div>
        <div class="detail-section">
          <h3>Objections Raised</h3>
          <ul class="detail-list">${objs.map(o => `<li>${escapeHtml(o)}</li>`).join("") || '<li class="empty-list">None</li>'}</ul>
        </div>
        <div class="detail-section">
          <h3>Next Steps</h3>
          <ul class="detail-list">${steps.map(s => `<li>${escapeHtml(s)}</li>`).join("") || '<li class="empty-list">None</li>'}</ul>
        </div>
      `;
    }
  } else {
    analysisHtml = '<p class="empty-list">Analysis pending</p>';
  }

  // Audio player section
  let audioHtml = "";
  if (call.recording_path) {
    audioHtml = `
      <div class="detail-section">
        <h3>Recording</h3>
        <div class="audio-player" data-recording-path="${escapeHtml(call.recording_path)}">
          <audio id="detailAudio" controls preload="metadata" style="width: 100%;"></audio>
          <p class="audio-hint">Click play to listen. URL will be loaded on first play.</p>
        </div>
      </div>
    `;
  } else {
    audioHtml = `
      <div class="detail-section">
        <h3>Recording</h3>
        <p class="empty-list">No recording available</p>
      </div>
    `;
  }

  return `
    <div class="detail-header">
      <span class="status-badge ${statusClass}">${statusLabel}</span>
    </div>
    <div class="detail-meta">
      <div class="detail-meta-item"><strong>Date:</strong> ${escapeHtml(date)}</div>
      <div class="detail-meta-item"><strong>Duration:</strong> ${escapeHtml(duration)}</div>
      <div class="detail-meta-item"><strong>Call ID:</strong> ${escapeHtml(call.id)}</div>
    </div>
    ${audioHtml}
    <div class="detail-section">
      <h3>Transcript</h3>
      <div class="transcript-container">
        ${transcriptHtml}
      </div>
    </div>
    <div class="detail-section">
      <h3>Analysis</h3>
      ${analysisHtml}
    </div>
    <button id="detail-back-btn" class="secondary">Back to History</button>
  `;
}

/** Set up audio player with signed URL */
async function setupAudioPlayer(call) {
  const audioEl = document.getElementById("detailAudio");
  const playerContainer = document.querySelector(".audio-player");

  if (!audioEl || !call.recording_path) return;

  // Get device ID from call or localStorage
  const deviceId = call.device_id || localStorage.getItem("voicebot_device_id");
  if (!deviceId) return;

  let urlLoaded = false;

  async function loadAudioUrl() {
    if (urlLoaded) return;
    urlLoaded = true;

    try {
      const response = await fetch(`/calls/${encodeURIComponent(call.id)}/recording/url?device_id=${encodeURIComponent(deviceId)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.url) {
        audioEl.src = data.url;
        audioEl.load();
      }
    } catch (e) {
      console.error("[History] Failed to load playback URL:", e);
      if (playerContainer) {
        playerContainer.innerHTML = `
          <p class="error-detail">Failed to load recording: ${escapeHtml(e.message)}</p>
          <button class="secondary" onclick="loadAudioUrl()">Retry</button>
        `;
      }
    }
  }

  // Load URL when user interacts with player
  audioEl.addEventListener("play", loadAudioUrl, { once: true });
  audioEl.addEventListener("click", loadAudioUrl, { once: true });
}

/** Initialize history view */
export function initHistory() {
  const filterSelect = document.getElementById("history-filter");
  const newCallBtn = document.getElementById("history-new-call-btn");

  // Set up filter dropdown
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      filterHistory(e.target.value);
    });
  }

  // Set up "Start New Call" button in empty state
  if (newCallBtn) {
    newCallBtn.addEventListener("click", () => {
      location.hash = "/call";
    });
  }

  // Initial load
  loadHistory();

  // Return cleanup function
  return () => {
    // Cleanup if needed
    window.__CALLS_CACHE__ = null;
    window.__CURRENT_CALL__ = null;
  };
}

/** Initialize detail view */
export function initDetailView() {
  const backBtn = document.getElementById("detail-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      location.hash = "/history";
    });
  }
}