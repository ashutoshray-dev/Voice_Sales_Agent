/** postcall.js — Post-call analysis view (F08).
 *
 * Exports:
 * - loadPostCallAnalysis(callId): fetches and renders call analysis
 * - renderPostCallAnalysis(data): renders analysis data to the postcall view
 */

import { dispatch } from "./ui.js";

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

/** Format a list array as HTML list items or a message if empty */
function formatList(items, emptyMessage = "None") {
  if (!items || items.length === 0) {
    return `<p class="empty-list">${emptyMessage}</p>`;
  }
  return items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
}

/** Escape HTML to prevent XSS */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Render the post-call analysis view */
export function renderPostCallAnalysis(data) {
  const container = document.getElementById("postcall-content");
  if (!container) return;

  const status = data.status || "No Response";
  const statusClass = STATUS_CLASSES[status] || "status-no-response";
  const statusLabel = STATUS_LABELS[status] || status;

  const summary = data.summary || "No summary available";
  const requirements = data.customer_requirements || [];
  const objections = data.objections || [];
  const nextSteps = data.next_steps || [];

  container.innerHTML = `
    <div class="postcall-header">
      <span class="status-badge ${statusClass}">${statusLabel}</span>
    </div>
    <div class="postcall-section">
      <h3>Summary</h3>
      <p class="postcall-summary">${escapeHtml(summary)}</p>
    </div>
    <div class="postcall-section">
      <h3>Customer Requirements</h3>
      <ul class="postcall-list">
        ${formatList(requirements, "No specific requirements mentioned")}
      </ul>
    </div>
    <div class="postcall-section">
      <h3>Objections Raised</h3>
      <ul class="postcall-list">
        ${formatList(objections, "No objections raised")}
      </ul>
    </div>
    <div class="postcall-section">
      <h3>Next Steps</h3>
      <ul class="postcall-list">
        ${formatList(nextSteps, "No next steps defined")}
      </ul>
    </div>
  `;
}

/** Load and display post-call analysis for a call ID */
export async function loadPostCallAnalysis(callId) {
  const container = document.getElementById("postcall-content");
  if (!container) return;

  container.innerHTML = '<p class="hint">Loading analysis...</p>';

  try {
    const response = await fetch(`/calls/${callId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    // The API returns the call object with summary (the full CallAnalysis) and status
    // Extract the analysis from summary or use top-level fields
    const analysis = data.summary || {
      summary: data.summary?.summary || "Analysis not available",
      customer_requirements: data.summary?.customer_requirements || [],
      objections: data.summary?.objections || [],
      next_steps: data.summary?.next_steps || [],
      status: data.status || "No Response",
    };

    renderPostCallAnalysis(analysis);
  } catch (e) {
    console.error("[PostCall] Failed to load analysis:", e);
    container.innerHTML = `
      <div class="postcall-error">
        <p>⚠️ Failed to load call analysis</p>
        <p class="error-detail">${escapeHtml(e.message)}</p>
        <button id="postcallRetryBtn" class="secondary">Retry</button>
      </div>
    `;

    const retryBtn = document.getElementById("postcallRetryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => loadPostCallAnalysis(callId));
    }
  }
}

/** Initialize the post-call view event listeners */
export function initPostCallView() {
  const backBtn = document.getElementById("postcallBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      location.hash = "/history";
    });
  }
}