// js/components/transferOptimizerUI.js
// Phase 7: Transfer Optimizer UI Components
// Renders transfer recommendations with full justification

import { utils } from "../utils.js";
import {
  runTransferOptimization,
  loadTransferSettings,
  saveTransferSettings,
  lockPlayer,
  unlockPlayer,
  setHitEnabled,
  setHitThreshold,
  resetTransferSettings,
  EXPENDABILITY_REASONS,
} from "../lib/transferOptimizer.js";
import { state } from "../state.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const ACTION_CLASSES = {
  transfer: "sp-action-go",
  roll: "sp-action-hold",
  hit: "sp-action-hit",
  hold: "sp-action-hold",
};

const ACTION_LABELS = {
  transfer: "Make Transfer",
  roll: "Roll Transfer",
  hit: "Take Hit",
  hold: "Hold",
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN RENDER FUNCTION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Render the complete Transfer Optimizer panel
 *
 * @param {Object} context - Squad context from loadContext()
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} - HTML string for the panel
 */
export async function renderTransferOptimizer(context, options = {}) {
  const {
    horizonGwCount = 5,
    onRefresh = null,
  } = options;

  try {
    const result = await runTransferOptimization(context, { horizonGwCount });

    if (!result.ok) {
      return renderError(result.error);
    }

    const hitEnabled = result.settings?.hitEnabled !== false;

    // Phase 10: Enhanced horizon clarity
    const horizonTooltip = `Transfer suggestions optimise over ${horizonGwCount} gameweeks.\nXI and Captain selections are for the current GW only.`;

    return `
      <div class="sp-card sp-card-transfers sp-transfer-optimizer" id="transferOptimizer">
        <div class="sp-card-header">
          Transfers (Next ${horizonGwCount} GWs)
          <span class="sp-horizon-badge sp-horizon-tooltip" title="${horizonTooltip}">
            <span class="sp-horizon-info">ℹ️</span>
            ${horizonGwCount} GW horizon
          </span>
        </div>

        ${renderUserControls(result.settings)}

        ${renderActionSummary(result.recommendations, result.freeTransfers, result.bankFormatted, hitEnabled)}

        ${renderWeakestLinks(result.weakestLinks, result.settings.lockedPlayerIds || [])}

        ${renderRecommendedTransfers(result.recommendations, result, hitEnabled)}

        ${renderAlternativeOptions(result)}

        ${renderAssumptions(horizonGwCount)}
      </div>
    `;
  } catch (err) {
    console.error("Transfer Optimizer error:", err);
    return renderError(err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   USER CONTROLS
   ═══════════════════════════════════════════════════════════════════════════ */

function renderUserControls(settings) {
  const hitEnabled = settings.hitEnabled !== false;
  const hitThreshold = settings.hitThreshold ?? 4;
  const lockedCount = (settings.lockedPlayerIds || []).length;
  const excludedTeamsCount = (settings.excludedTeamIds || []).length;

  // Phase 10: Hide hit threshold slider when hits are disabled
  const hitThresholdSection = hitEnabled ? `
        <div class="sp-control-group" id="hitThresholdGroup">
          <label class="sp-control-label sp-control-inline">
            Hit threshold:
            <input type="range" id="hitThresholdSlider" min="0" max="12" step="1" value="${hitThreshold}">
            <span id="hitThresholdValue">${hitThreshold} pts</span>
          </label>
        </div>
  ` : "";

  // Phase 10: Clear all pins button (only show if there are locked players)
  const clearPinsBtn = lockedCount > 0
    ? `<button class="sp-btn-small sp-btn-clear-pins" id="clearAllPins" title="Remove all locked players">Clear pins</button>`
    : "";

  return `
    <div class="sp-transfer-controls" id="transferControls">
      <div class="sp-control-row">
        <label class="sp-control-label">
          <input type="checkbox" id="hitEnabledToggle" ${hitEnabled ? "checked" : ""}>
          Allow hits
        </label>
        ${hitThresholdSection}
      </div>

      <div class="sp-control-row sp-control-summary">
        <span class="sp-control-stat sp-control-stat-pins" title="Players exempt from transfer out suggestions">
          <span class="sp-lock-icon">🔒</span> ${lockedCount} pinned
          ${clearPinsBtn}
        </span>
        <span class="sp-control-stat" title="Teams excluded from transfer targets">
          <span class="sp-exclude-icon">🚫</span> ${excludedTeamsCount} teams excluded
        </span>
        <button class="sp-btn-small sp-btn-reset" id="resetTransferSettings">Reset</button>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTION SUMMARY
   ═══════════════════════════════════════════════════════════════════════════ */

function renderActionSummary(recommendations, freeTransfers, bankFormatted, hitEnabled = true) {
  const action = recommendations.action;
  const best = recommendations.best;

  // Phase 10: If FT = 0 and hits disabled, show "No legal transfers" state
  if (freeTransfers === 0 && !hitEnabled) {
    return `
      <div class="sp-action-summary sp-action-no-transfers">
        <div class="sp-action-header">
          <span class="sp-action-badge sp-action-blocked">No Legal Transfers</span>
          <span class="sp-ft-badge">0 FT</span>
          <span class="sp-bank-badge">${bankFormatted} ITB</span>
        </div>
        <div class="sp-action-detail sp-no-transfer-msg">
          <span class="sp-no-transfer-icon">ℹ️</span>
          <span>No free transfers available and hits are disabled. Enable "Allow hits" to see transfer options.</span>
        </div>
      </div>
    `;
  }

  // Phase 10: Don't show hit action if hits are disabled (shouldn't happen but safety check)
  const effectiveAction = (!hitEnabled && action === "hit") ? "hold" : action;
  const actionClass = ACTION_CLASSES[effectiveAction] || "";
  const actionLabel = ACTION_LABELS[effectiveAction] || effectiveAction;

  let summaryContent = "";

  if (effectiveAction === "transfer" && best) {
    const transfer = best.transfers[0];
    summaryContent = `
      <div class="sp-action-detail">
        <span class="sp-out-name">${transfer?.out?.player?.web_name || "?"}</span>
        <span class="sp-arrow">→</span>
        <span class="sp-in-name">${transfer?.in?.player?.web_name || "?"}</span>
      </div>
      <div class="sp-action-gain">+${best.netGain?.toFixed(1) || 0} xP net gain</div>
    `;
  } else if (effectiveAction === "hit" && best && hitEnabled) {
    summaryContent = `
      <div class="sp-action-detail">
        ${best.transfers.map(t =>
          `<span class="sp-out-name">${t.out?.player?.web_name}</span> → <span class="sp-in-name">${t.in?.player?.web_name}</span>`
        ).join(", ")}
      </div>
      <div class="sp-action-hit-info">
        <span class="sp-hit-cost">-${best.hitCost} hit</span>
        <span class="sp-net-gain">+${best.netGain?.toFixed(1)} net xP</span>
      </div>
    `;
  } else if (effectiveAction === "roll") {
    summaryContent = `
      <div class="sp-action-detail">${recommendations.actionReason}</div>
      <div class="sp-action-ft-note">FT will roll to ${Math.min(5, freeTransfers + 1)} next GW</div>
    `;
  } else {
    summaryContent = `<div class="sp-action-detail">${recommendations.actionReason}</div>`;
  }

  return `
    <div class="sp-action-summary">
      <div class="sp-action-header">
        <span class="sp-action-badge ${actionClass}">${actionLabel}</span>
        <span class="sp-ft-badge">${freeTransfers} FT</span>
        <span class="sp-bank-badge">${bankFormatted} ITB</span>
      </div>
      ${summaryContent}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEAKEST LINKS SECTION (7.1)
   ═══════════════════════════════════════════════════════════════════════════ */

function renderWeakestLinks(weakestLinks, lockedPlayerIds) {
  const lockedSet = new Set(lockedPlayerIds);
  const expendable = weakestLinks.filter(wl => wl.isExpendable);

  if (expendable.length === 0) {
    return `
      <div class="sp-weakest-section">
        <div class="sp-section-header">Weakest Contributors</div>
        <div class="sp-no-weak">All players performing adequately</div>
      </div>
    `;
  }

  const rows = expendable.map(wl => {
    const p = wl.player;
    const isLocked = lockedSet.has(p.id);
    const posLabel = ({ 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" })[p.element_type] || "?";

    // Get status indicator
    const statusClass = getStatusClass(p.status);
    const statusIcon = getStatusIcon(p.status);

    // Primary reason badge
    const reasonBadge = wl.primaryReason
      ? `<span class="sp-reason-badge sp-reason-${wl.primaryReason.id}">${wl.primaryReason.label}</span>`
      : "";

    // All reasons tooltip
    const allReasons = wl.reasons.map(r => `${r.label}: ${r.detail}`).join("\n");

    return `
      <div class="sp-weak-row ${isLocked ? "sp-weak-locked" : ""}" data-player-id="${p.id}">
        <div class="sp-weak-main">
          <span class="sp-weak-rank">#${wl.rank}</span>
          <span class="sp-weak-status ${statusClass}" title="${p.news || p.status}">${statusIcon}</span>
          <span class="sp-weak-pos">${posLabel}</span>
          <span class="sp-weak-name">${p.web_name}</span>
          <span class="sp-weak-team">${p.teamName || ""}</span>
        </div>
        <div class="sp-weak-stats">
          <span class="sp-weak-xp" title="Expected points over horizon">${wl.xpOverHorizon?.toFixed(1) || 0} xP</span>
          <span class="sp-weak-score" title="Expendability score (higher = more expendable)">${wl.expendabilityScore}</span>
        </div>
        <div class="sp-weak-reason" title="${allReasons}">
          ${reasonBadge}
        </div>
        <div class="sp-weak-actions">
          <button class="sp-btn-lock ${isLocked ? "active" : ""}"
                  data-player-id="${p.id}"
                  title="${isLocked ? "Unlock player" : "Lock player (exempt from transfers)"}">
            ${isLocked ? "🔓" : "🔒"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="sp-weakest-section">
      <div class="sp-section-header">
        Weakest Contributors
        <span class="sp-section-hint">Click 🔒 to exempt from suggestions</span>
      </div>
      <div class="sp-weak-list">
        ${rows}
      </div>
    </div>
  `;
}

function getStatusClass(status) {
  const classes = {
    a: "sp-status-available",
    d: "sp-status-doubtful",
    i: "sp-status-injured",
    s: "sp-status-suspended",
    n: "sp-status-unavailable",
    u: "sp-status-unavailable",
  };
  return classes[status] || "";
}

function getStatusIcon(status) {
  const icons = {
    a: "✓",
    d: "?",
    i: "🤕",
    s: "🟥",
    n: "✗",
    u: "✗",
  };
  return icons[status] || "?";
}

/* ═══════════════════════════════════════════════════════════════════════════
   RECOMMENDED TRANSFERS SECTION (7.2)
   ═══════════════════════════════════════════════════════════════════════════ */

function renderRecommendedTransfers(recommendations, result, hitEnabled = true) {
  const best = recommendations.best;

  if (!best || best.type === "roll" || best.type === "hold") {
    return "";
  }

  // Phase 10: Don't show hit transfers if hits are disabled
  if (best.type === "hit" && !hitEnabled) {
    return "";
  }

  return `
    <div class="sp-transfers-section">
      <div class="sp-section-header">Recommended Transfer${best.transfers.length > 1 ? "s" : ""}</div>
      ${best.transfers.map((t, idx) => renderTransferCard(t, idx + 1, result)).join("")}
    </div>
  `;
}

function renderTransferCard(transfer, number, result) {
  const playerOut = transfer.out?.player;
  const playerIn = transfer.in?.player;
  const xpGain = transfer.xpGain || 0;
  const primaryReason = transfer.out?.primaryReason;
  const whyBest = transfer.in?.whyBest;

  // Calculate remaining ITB after this transfer
  const outPrice = playerOut?.selling_price || playerOut?.now_cost || 0;
  const inPrice = transfer.in?.cost || 0;
  const bankChange = outPrice - inPrice;

  return `
    <div class="sp-transfer-card">
      <div class="sp-transfer-header">
        <span class="sp-transfer-number">${number}</span>
        <span class="sp-transfer-gain ${xpGain > 0 ? "positive" : xpGain < 0 ? "negative" : ""}">
          ${xpGain > 0 ? "+" : ""}${xpGain.toFixed(1)} xP
        </span>
      </div>

      <div class="sp-transfer-players">
        <div class="sp-transfer-out">
          <div class="sp-transfer-label">OUT</div>
          <div class="sp-player-card sp-player-out">
            <span class="sp-player-name">${playerOut?.web_name || "?"}</span>
            <span class="sp-player-team">${playerOut?.teamName || ""}</span>
            <span class="sp-player-price">£${((playerOut?.now_cost || 0) / 10).toFixed(1)}m</span>
          </div>
          <div class="sp-transfer-why sp-why-out">
            <span class="sp-why-label">Why out:</span>
            <span class="sp-why-text">${primaryReason?.detail || primaryReason?.label || "Lower expected returns"}</span>
          </div>
        </div>

        <div class="sp-transfer-arrow">→</div>

        <div class="sp-transfer-in">
          <div class="sp-transfer-label">IN</div>
          <div class="sp-player-card sp-player-in">
            <span class="sp-player-name">${playerIn?.web_name || "?"}</span>
            <span class="sp-player-team">${getTeamName(playerIn?.team) || ""}</span>
            <span class="sp-player-price">£${(inPrice / 10).toFixed(1)}m</span>
          </div>
          <div class="sp-transfer-why sp-why-in">
            <span class="sp-why-label">Why in:</span>
            <span class="sp-why-text">${whyBest || "Best available option"}</span>
          </div>
        </div>
      </div>

      <div class="sp-transfer-footer">
        <span class="sp-itb-change" title="Change in bank">
          ITB: ${bankChange >= 0 ? "+" : ""}£${(bankChange / 10).toFixed(1)}m
        </span>
        <span class="sp-remaining-itb">
          Remaining: £${((result.bank + bankChange) / 10).toFixed(1)}m
        </span>
      </div>
    </div>
  `;
}

function getTeamName(teamId) {
  const bs = state.bootstrap;
  if (!bs || !teamId) return "";
  const team = (bs.teams || []).find(t => t.id === teamId);
  return team?.short_name || "";
}

/* ═══════════════════════════════════════════════════════════════════════════
   ALTERNATIVE OPTIONS SECTION
   ═══════════════════════════════════════════════════════════════════════════ */

function renderAlternativeOptions(result) {
  const { recommendations, singleTransfers, settings } = result;
  const hitEnabled = settings?.hitEnabled !== false;

  // Show alternative single transfers (skip the first if it's the recommended one)
  const alternatives = singleTransfers.filter(t => t !== recommendations.best).slice(0, 3);

  if (alternatives.length === 0 && (!hitEnabled || !recommendations.hitOptions?.length)) {
    return "";
  }

  const rows = alternatives.map((scenario, idx) => {
    const transfer = scenario.transfers[0];
    const playerOut = transfer?.out?.player;
    const playerIn = transfer?.in?.player;

    return `
      <div class="sp-alt-row">
        <span class="sp-alt-rank">${idx + 2}</span>
        <span class="sp-alt-move">
          ${playerOut?.web_name || "?"} → ${playerIn?.web_name || "?"}
        </span>
        <span class="sp-alt-gain ${scenario.netGain > 0 ? "positive" : ""}">
          +${scenario.netGain?.toFixed(1) || 0} xP
        </span>
        <span class="sp-alt-itb">
          £${(scenario.remainingBank / 10).toFixed(1)}m ITB
        </span>
      </div>
    `;
  }).join("");

  // Phase 10: Only show hit options if hitEnabled is true
  let hitSection = "";
  if (hitEnabled && recommendations.hitOptions && recommendations.hitOptions.length > 0) {
    const hitRows = recommendations.hitOptions.slice(0, 2).map(scenario => {
      const moves = scenario.transfers.map(t =>
        `${t.out?.player?.web_name} → ${t.in?.player?.web_name}`
      ).join(", ");

      return `
        <div class="sp-alt-row sp-alt-hit">
          <span class="sp-alt-hit-badge">HIT</span>
          <span class="sp-alt-move">${moves}</span>
          <span class="sp-alt-hit-cost">-${scenario.hitCost}</span>
          <span class="sp-alt-gain ${scenario.netGain > 0 ? "positive" : ""}">
            +${scenario.netGain?.toFixed(1)} net
          </span>
        </div>
      `;
    }).join("");

    hitSection = `
      <div class="sp-alt-hit-section">
        <div class="sp-alt-hit-header">Hit Options</div>
        ${hitRows}
      </div>
    `;
  }

  if (!rows && !hitSection) {
    return "";
  }

  return `
    <div class="sp-alternatives-section">
      <div class="sp-section-header">Alternative Options</div>
      <div class="sp-alt-list">
        ${rows}
      </div>
      ${hitSection}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSUMPTIONS PANEL
   ═══════════════════════════════════════════════════════════════════════════ */

function renderAssumptions(horizonGwCount) {
  return `
    <div class="sp-transfer-assumptions">
      <div class="sp-assumptions-toggle" id="transferAssumptionsToggle">
        Model Assumptions ▼
      </div>
      <div class="sp-assumptions-content" id="transferAssumptionsContent" style="display: none;">
        <ul>
          <li><strong>Horizon:</strong> ${horizonGwCount} gameweeks of fixtures considered</li>
          <li><strong>xP Model:</strong> Appearance + Attack (xGI) + Clean Sheet + Bonus</li>
          <li><strong>Expendability:</strong> Status, minutes, form, fixtures, price momentum</li>
          <li><strong>Club limit:</strong> Max 3 players per team enforced</li>
          <li><strong>Hit threshold:</strong> Net gain must exceed threshold to recommend</li>
          <li><strong>Caveats:</strong> Cannot predict rotation, late injuries, or manager decisions</li>
        </ul>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ERROR RENDERING
   ═══════════════════════════════════════════════════════════════════════════ */

function renderError(message) {
  return `
    <div class="sp-card sp-card-error">
      <div class="sp-card-header">Transfer Optimizer</div>
      <div class="sp-error-content">
        <span class="sp-error-icon">⚠️</span>
        <span class="sp-error-message">${message || "An error occurred"}</span>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT HANDLERS
   ═══════════════════════════════════════════════════════════════════════════ */

// Phase 10: Storage key for tracking first pin toast
const FIRST_PIN_TOAST_SHOWN_KEY = "fpl.transfer.firstPinToastShown";

/**
 * Show a temporary toast notification
 */
function showToast(message, duration = 3000) {
  // Remove any existing toast
  const existingToast = document.querySelector(".sp-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.className = "sp-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("sp-toast-visible");
  });

  // Remove after duration
  setTimeout(() => {
    toast.classList.remove("sp-toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Clear all locked players
 */
function clearAllLockedPlayers() {
  const { setJSON } = window.fplStorage || {};
  if (setJSON) {
    setJSON("fpl.transfer.lockedPlayers", []);
  } else {
    localStorage.setItem("fpl.transfer.lockedPlayers", "[]");
  }
}

/**
 * Wire up all interactive elements in the Transfer Optimizer
 */
export function wireUpTransferOptimizer(container, context, onRefresh) {
  // Hit enabled toggle
  const hitToggle = container.querySelector("#hitEnabledToggle");
  if (hitToggle) {
    hitToggle.addEventListener("change", async (e) => {
      setHitEnabled(e.target.checked);
      if (onRefresh) await onRefresh();
    });
  }

  // Hit threshold slider
  const thresholdSlider = container.querySelector("#hitThresholdSlider");
  const thresholdValue = container.querySelector("#hitThresholdValue");
  if (thresholdSlider) {
    thresholdSlider.addEventListener("input", (e) => {
      if (thresholdValue) {
        thresholdValue.textContent = `${e.target.value} pts`;
      }
    });
    thresholdSlider.addEventListener("change", async (e) => {
      setHitThreshold(parseInt(e.target.value, 10));
      if (onRefresh) await onRefresh();
    });
  }

  // Reset button
  const resetBtn = container.querySelector("#resetTransferSettings");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      resetTransferSettings();
      if (onRefresh) await onRefresh();
    });
  }

  // Phase 10: Clear all pins button
  const clearPinsBtn = container.querySelector("#clearAllPins");
  if (clearPinsBtn) {
    clearPinsBtn.addEventListener("click", async () => {
      clearAllLockedPlayers();
      showToast("All pins cleared");
      if (onRefresh) await onRefresh();
    });
  }

  // Lock/unlock buttons
  container.querySelectorAll(".sp-btn-lock").forEach(btn => {
    btn.addEventListener("click", async () => {
      const playerId = parseInt(btn.dataset.playerId, 10);
      const isLocked = btn.classList.contains("active");

      if (isLocked) {
        unlockPlayer(playerId);
      } else {
        lockPlayer(playerId);

        // Phase 10: Show one-time toast on first pin
        const hasSeenToast = localStorage.getItem(FIRST_PIN_TOAST_SHOWN_KEY);
        if (!hasSeenToast) {
          showToast("Player pinned — optimiser will respect this");
          localStorage.setItem(FIRST_PIN_TOAST_SHOWN_KEY, "true");
        }
      }

      if (onRefresh) await onRefresh();
    });
  });

  // Assumptions toggle
  const assumptionsToggle = container.querySelector("#transferAssumptionsToggle");
  const assumptionsContent = container.querySelector("#transferAssumptionsContent");
  if (assumptionsToggle && assumptionsContent) {
    assumptionsToggle.addEventListener("click", () => {
      const isHidden = assumptionsContent.style.display === "none";
      assumptionsContent.style.display = isHidden ? "block" : "none";
      assumptionsToggle.textContent = isHidden
        ? "Model Assumptions ▲"
        : "Model Assumptions ▼";
    });
  }
}

export default {
  renderTransferOptimizer,
  wireUpTransferOptimizer,
};
