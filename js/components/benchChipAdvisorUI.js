// js/components/benchChipAdvisorUI.js
// Phase 8: Bench Order + Chip Suggestions UI
// - 8.1: Display recommended bench sequence with warnings
// - 8.2: Show chip suggestions only when thresholds met (conservative)

import { utils } from "../utils.js";
import { runBenchChipAnalysis, CHIP_CONFIG } from "../lib/benchOptimizer.js";

/* ============================================================================
   CONSTANTS
   ============================================================================ */

const CONFIDENCE_CLASSES = {
  HIGH: "sp-confidence-high",
  MEDIUM: "sp-confidence-medium",
  LOW: "sp-confidence-low",
};

const CHIP_DISPLAY = {
  bboost: { name: "Bench Boost", icon: "BB", class: "sp-chip-bb" },
  "3xc": { name: "Triple Captain", icon: "TC", class: "sp-chip-tc" },
  wildcard: { name: "Wildcard", icon: "WC", class: "sp-chip-wc" },
  freehit: { name: "Free Hit", icon: "FH", class: "sp-chip-fh" },
};

/* ============================================================================
   MAIN RENDER FUNCTION
   ============================================================================ */

/**
 * Render the complete Bench + Chip Advisor panel
 *
 * @param {Object} context - Squad context from loadContext()
 * @returns {Promise<string>} - HTML string for the panel
 */
export async function renderBenchChipAdvisor(context) {
  try {
    const result = await runBenchChipAnalysis(context);

    if (!result.ok) {
      return renderError(result.error || "Unable to analyze bench");
    }

    return `
      <div class="sp-card sp-card-bench-chip sp-bench-chip-advisor" id="benchChipAdvisor">
        <div class="sp-card-header">
          Bench & Chips
          <span class="sp-gw-badge">GW${result.nextGw}</span>
        </div>

        ${renderChipSuggestion(result.chipSuggestion, context.chipsAvailable)}

        ${renderBenchOrder(result.benchOrder)}

        ${renderChipDetails(result.chipSuggestion)}
      </div>
    `;
  } catch (err) {
    console.error("Bench/Chip Advisor error:", err);
    return renderError(err.message);
  }
}

/* ============================================================================
   CHIP SUGGESTION SECTION (8.2)
   ============================================================================ */

function renderChipSuggestion(chipSuggestion, chipsAvailable = []) {
  const { recommendation, message, rationale, confidence } = chipSuggestion;

  // Default: No chip recommended
  if (recommendation === "none") {
    return `
      <div class="sp-chip-section sp-chip-none">
        <div class="sp-chip-header">
          <span class="sp-chip-icon sp-chip-neutral">-</span>
          <span class="sp-chip-title">No chip recommended</span>
        </div>
        <div class="sp-chip-rationale">${rationale}</div>
        ${renderChipsAvailable(chipsAvailable)}
      </div>
    `;
  }

  // Chip is recommended
  const chipInfo = CHIP_DISPLAY[recommendation] || { name: recommendation, icon: "?", class: "" };
  const confidenceClass = CONFIDENCE_CLASSES[confidence] || "";

  return `
    <div class="sp-chip-section sp-chip-active ${chipInfo.class}">
      <div class="sp-chip-header">
        <span class="sp-chip-icon">${chipInfo.icon}</span>
        <span class="sp-chip-title">${message}</span>
        <span class="sp-confidence-badge ${confidenceClass}">${confidence}</span>
      </div>
      <div class="sp-chip-rationale">${rationale}</div>
      ${renderChipsAvailable(chipsAvailable.filter(c => c !== recommendation))}
    </div>
  `;
}

function renderChipsAvailable(chips) {
  if (!chips || chips.length === 0) {
    return '<div class="sp-chips-status sp-chips-exhausted">All chips used</div>';
  }

  const chipBadges = chips.map(chip => {
    const info = CHIP_DISPLAY[chip] || { icon: "?", name: chip };
    return `<span class="sp-chip-available" title="${info.name}">${info.icon}</span>`;
  }).join("");

  return `
    <div class="sp-chips-status">
      <span class="sp-chips-label">Available:</span>
      ${chipBadges}
    </div>
  `;
}

/* ============================================================================
   CHIP DETAILS (BB + TC breakdown)
   ============================================================================ */

function renderChipDetails(chipSuggestion) {
  const { benchBoost, tripleCaptain } = chipSuggestion;

  const sections = [];

  // Bench Boost details
  if (benchBoost) {
    sections.push(renderBBDetails(benchBoost));
  }

  // Triple Captain details
  if (tripleCaptain) {
    sections.push(renderTCDetails(tripleCaptain));
  }

  if (sections.length === 0) {
    return "";
  }

  return `
    <div class="sp-chip-details">
      <div class="sp-details-toggle" id="chipDetailsToggle">
        Chip Analysis ▼
      </div>
      <div class="sp-details-content" id="chipDetailsContent" style="display: none;">
        ${sections.join("")}
      </div>
    </div>
  `;
}

function renderBBDetails(bb) {
  const statusClass = bb.triggered ? "sp-status-triggered" : "sp-status-not-triggered";
  const statusLabel = bb.triggered ? "Threshold met" : "Below threshold";

  const playerRows = bb.players.map(p => {
    const meetsClass = p.meetsMinimum ? "sp-meets" : "sp-below";
    return `
      <div class="sp-bb-player ${meetsClass}">
        <span class="sp-bb-name">${p.name}</span>
        <span class="sp-bb-xp">${p.xP.toFixed(1)} xP</span>
        <span class="sp-bb-mins">${Math.round(p.xMins)}'</span>
        <span class="sp-bb-fdr">FDR ${p.fdr || "?"}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="sp-bb-section">
      <div class="sp-bb-header">
        <span class="sp-bb-title">Bench Boost Analysis</span>
        <span class="sp-bb-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="sp-bb-summary">
        <span class="sp-bb-total">Bench total: <strong>${bb.totalXp.toFixed(1)} xP</strong></span>
        <span class="sp-bb-threshold">(threshold: ${bb.threshold} xP)</span>
      </div>
      <div class="sp-bb-players">
        ${playerRows}
      </div>
    </div>
  `;
}

function renderTCDetails(tc) {
  const statusClass = tc.triggered ? "sp-status-triggered" : "sp-status-not-triggered";
  const statusLabel = tc.triggered ? "Criteria met" : "Criteria not met";

  const conditions = tc.conditions;
  const checkMark = (met) => met ? '<span class="sp-check">&#10003;</span>' : '<span class="sp-cross">&#10007;</span>';

  return `
    <div class="sp-tc-section">
      <div class="sp-tc-header">
        <span class="sp-tc-title">Triple Captain Analysis</span>
        <span class="sp-tc-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="sp-tc-captain">
        <span class="sp-tc-name">${tc.captain.name}</span>
        <span class="sp-tc-team">${tc.captain.team}</span>
        <span class="sp-tc-pos">${tc.captain.position}</span>
      </div>
      <div class="sp-tc-metrics">
        <div class="sp-tc-row">
          ${checkMark(conditions.hasFixture)}
          Has fixture
        </div>
        <div class="sp-tc-row">
          ${checkMark(conditions.meetsXpThreshold)}
          xP: ${tc.xP.toFixed(1)} (min: ${tc.thresholds.xP})
        </div>
        <div class="sp-tc-row">
          ${checkMark(conditions.meetsMinutesThreshold)}
          Minutes: ${Math.round(tc.xMins)}' (min: ${tc.thresholds.xMins}')
        </div>
        <div class="sp-tc-row">
          ${checkMark(conditions.meetsFdrThreshold)}
          Fixture: FDR ${tc.fdr} ${tc.home ? "(H)" : "(A)"} (max: ${tc.thresholds.fdr})
        </div>
      </div>
    </div>
  `;
}

/* ============================================================================
   BENCH ORDER SECTION (8.1)
   ============================================================================ */

function renderBenchOrder(benchOrder) {
  const { gkp, currentOrder, optimalOrder, isSuboptimal, warnings, totalBenchXp } = benchOrder;

  // Build current order display
  const currentRows = renderBenchRows(currentOrder, "current");
  const optimalRows = isSuboptimal ? renderBenchRows(optimalOrder, "optimal") : "";

  // Warning banner
  const warningBanner = isSuboptimal && warnings.length > 0
    ? renderBenchWarnings(warnings)
    : "";

  return `
    <div class="sp-bench-section">
      <div class="sp-section-header">
        Bench Order
        ${isSuboptimal
          ? '<span class="sp-bench-warning-badge">Suboptimal</span>'
          : '<span class="sp-bench-ok-badge">OK</span>'}
      </div>

      ${warningBanner}

      <div class="sp-bench-order-container">
        <div class="sp-bench-current">
          <div class="sp-bench-order-label">Current Order</div>
          ${gkp ? renderGkpRow(gkp) : ""}
          ${currentRows}
          <div class="sp-bench-total">
            Total bench xP: <strong>${totalBenchXp?.toFixed(1) || 0}</strong>
          </div>
        </div>

        ${isSuboptimal ? `
          <div class="sp-bench-arrow">&#8594;</div>
          <div class="sp-bench-optimal">
            <div class="sp-bench-order-label">Recommended Order</div>
            ${gkp ? renderGkpRow(gkp) : ""}
            ${optimalRows}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderBenchRows(order, type) {
  return order.map(item => {
    const p = item.player;
    const posLabel = ({ 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" })[p.element_type] || "?";

    return `
      <div class="sp-bench-row sp-bench-${type}">
        <span class="sp-bench-pos">${item.position}</span>
        <span class="sp-bench-position-type">${posLabel}</span>
        <span class="sp-bench-name">${p.web_name}</span>
        <span class="sp-bench-xp">${item.xP.toFixed(1)} xP</span>
        <span class="sp-bench-mins">${Math.round(item.xMins)}'</span>
      </div>
    `;
  }).join("");
}

function renderGkpRow(gkp) {
  return `
    <div class="sp-bench-row sp-bench-gkp">
      <span class="sp-bench-pos">12</span>
      <span class="sp-bench-position-type">GKP</span>
      <span class="sp-bench-name">${gkp.player.web_name}</span>
      <span class="sp-bench-xp">${gkp.xP?.toFixed(1) || 0} xP</span>
      <span class="sp-bench-mins">${Math.round(gkp.xMins || 0)}'</span>
      <span class="sp-bench-note">(fixed)</span>
    </div>
  `;
}

function renderBenchWarnings(warnings) {
  const warningItems = warnings.map(w => `
    <div class="sp-bench-warning-item">
      <span class="sp-warning-icon">&#9888;</span>
      <span class="sp-warning-message">${w.message}</span>
      <span class="sp-warning-reason">${w.reason}</span>
    </div>
  `).join("");

  return `
    <div class="sp-bench-warnings">
      ${warningItems}
    </div>
  `;
}

/* ============================================================================
   ERROR RENDERING
   ============================================================================ */

function renderError(message) {
  return `
    <div class="sp-card sp-card-error sp-bench-chip-error">
      <div class="sp-card-header">Bench & Chips</div>
      <div class="sp-error-content">
        <span class="sp-error-icon">&#9888;</span>
        <span class="sp-error-message">${message || "An error occurred"}</span>
      </div>
    </div>
  `;
}

/* ============================================================================
   EVENT HANDLERS
   ============================================================================ */

/**
 * Wire up interactive elements in the Bench/Chip Advisor
 */
export function wireUpBenchChipAdvisor(container) {
  // Chip details toggle
  const detailsToggle = container.querySelector("#chipDetailsToggle");
  const detailsContent = container.querySelector("#chipDetailsContent");

  if (detailsToggle && detailsContent) {
    detailsToggle.addEventListener("click", () => {
      const isHidden = detailsContent.style.display === "none";
      detailsContent.style.display = isHidden ? "block" : "none";
      detailsToggle.textContent = isHidden
        ? "Chip Analysis ▲"
        : "Chip Analysis ▼";
    });
  }
}

export default {
  renderBenchChipAdvisor,
  wireUpBenchChipAdvisor,
};
