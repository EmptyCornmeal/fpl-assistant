// js/pages/transfer-optimizer.js
// Phase 7: Transfer Optimisation UI
// Constrained simulation with explicit reasoning and user controls

import { fplClient, legacyApi } from "../api/fplClient.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import {
  OPTIMIZER_DEFAULTS,
  EXPENDABILITY_REASONS,
  REPLACEMENT_REASONS,
  rankSquadByExpendability,
  simulateTransferScenarios,
  buildFixturesByTeam,
  formatTransferSuggestion,
  optimizeMultiTransfer,
} from "../lib/transfer-optimizer.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY_LOCKED = "fpl.to.lockedPlayers";
const STORAGE_KEY_EXCLUDED_TEAMS = "fpl.to.excludedTeams";
const STORAGE_KEY_HIT_THRESHOLD = "fpl.to.hitThreshold";
const STORAGE_KEY_ALLOW_HITS = "fpl.to.allowHits";
const STORAGE_KEY_HORIZON = "fpl.to.horizon";

const HORIZONS = {
  1: { id: 1, label: "This GW" },
  3: { id: 3, label: "Next 3 GWs" },
  5: { id: 5, label: "Next 5 GWs" },
};

const money = (n) => `£${(+n).toFixed(1)}m`;

/* ═══════════════════════════════════════════════════════════════════════════
   UI HELPER COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function createBadge(text, variant = "default") {
  const classes = {
    default: "badge",
    success: "badge badge-green",
    warning: "badge badge-amber",
    danger: "badge badge-red",
    info: "badge badge-blue",
  };
  return utils.el("span", { class: classes[variant] || classes.default }, text);
}

function createReasonChip(reason, variant = "default") {
  const chip = utils.el("span", {
    class: `reason-chip reason-${variant}`,
    "data-tooltip": `${reason.description}${reason.value ? `: ${reason.value}` : ""}`,
  }, reason.label);
  return chip;
}

function createPlayerCard(player, extra = {}) {
  const card = utils.el("div", { class: "to-player-card" });

  const header = utils.el("div", { class: "to-player-header" });
  header.append(
    utils.el("span", { class: "to-player-name" }, player.web_name || player.name),
    utils.el("span", { class: "team-chip" }, extra.team || "???")
  );

  const stats = utils.el("div", { class: "to-player-stats" });
  stats.append(
    utils.el("span", {}, money(extra.price || player.now_cost / 10)),
    utils.el("span", {}, `xP: ${(extra.xpPerGw || 0).toFixed(2)}/GW`)
  );

  card.append(header, stats);

  if (extra.children) {
    for (const child of extra.children) {
      card.append(child);
    }
  }

  return card;
}

function createTransferCard(transfer, horizonLen) {
  const card = utils.el("div", { class: "to-transfer-card" });

  // Header with net gain
  const header = utils.el("div", { class: "to-transfer-header" });
  const gainClass = transfer.projectedGain.net > 0 ? "text-good" :
    transfer.projectedGain.net < 0 ? "text-bad" : "";
  header.append(
    utils.el("span", { class: "to-transfer-gain " + gainClass },
      `${transfer.projectedGain.net >= 0 ? "+" : ""}${transfer.projectedGain.net.toFixed(2)} xP (net)`
    ),
    transfer.isHit ? createBadge("-4 HIT", "danger") : null,
    utils.el("span", { class: "to-itb" }, `ITB: ${money(transfer.remainingITB)}`)
  );
  card.append(header);

  // Transfer arrow section
  const transferRow = utils.el("div", { class: "to-transfer-row" });

  // OUT player
  const outSection = utils.el("div", { class: "to-out-section" });
  outSection.append(
    utils.el("div", { class: "to-section-label to-out-label" }, "OUT"),
    utils.el("div", { class: "to-player-name" }, transfer.out.name),
    utils.el("div", { class: "to-player-meta" },
      `${money(transfer.out.price)} • ${transfer.out.xpPerGw.toFixed(2)} xP/GW`
    )
  );

  // Reasons why out is expendable
  const outReasons = utils.el("div", { class: "to-reasons" });
  for (const reason of transfer.whyOutExpendable.reasons.slice(0, 3)) {
    outReasons.append(createReasonChip(reason, "danger"));
  }
  outSection.append(outReasons);

  // Arrow
  const arrow = utils.el("div", { class: "to-arrow" }, "→");

  // IN player
  const inSection = utils.el("div", { class: "to-in-section" });
  inSection.append(
    utils.el("div", { class: "to-section-label to-in-label" }, "IN"),
    utils.el("div", { class: "to-player-name" }, transfer.in.name),
    utils.el("div", { class: "to-player-meta" },
      `${money(transfer.in.price)} • ${transfer.in.xpPerGw.toFixed(2)} xP/GW`
    )
  );

  // Reasons why in is best fit
  const inReasons = utils.el("div", { class: "to-reasons" });
  for (const reason of transfer.whyInBestFit.reasons.slice(0, 3)) {
    inReasons.append(createReasonChip(reason, "success"));
  }
  inSection.append(inReasons);

  transferRow.append(outSection, arrow, inSection);
  card.append(transferRow);

  // Detailed gain breakdown
  const breakdown = utils.el("div", { class: "to-gain-breakdown" });
  breakdown.append(
    utils.el("span", {},
      `Gross: +${transfer.projectedGain.gross.toFixed(2)} xP over ${horizonLen} GW${horizonLen > 1 ? "s" : ""}`
    ),
    transfer.projectedGain.penalty > 0 ?
      utils.el("span", { class: "text-bad" }, ` | Hit: -${transfer.projectedGain.penalty}`) : null
  );
  card.append(breakdown);

  return card;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN RENDER FUNCTION
   ═══════════════════════════════════════════════════════════════════════════ */

export async function renderTransferOptimizer(main) {
  const shell = utils.el("div", { class: "to-container" });
  shell.append(ui.spinner("Loading Transfer Optimizer..."));
  ui.mount(main, shell);

  // Load saved preferences
  let lockedPlayerIds = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_LOCKED) || "[]"));
  let excludedTeamIds = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_EXCLUDED_TEAMS) || "[]"));
  let hitThreshold = parseInt(localStorage.getItem(STORAGE_KEY_HIT_THRESHOLD) || OPTIMIZER_DEFAULTS.hitThreshold);
  let allowHits = localStorage.getItem(STORAGE_KEY_ALLOW_HITS) !== "false";
  let horizonLen = parseInt(localStorage.getItem(STORAGE_KEY_HORIZON) || "3");

  // Processing state
  let isProcessing = false;
  let cancelRequested = false;

  // Data holders
  let bootstrap = null;
  let squad = [];
  let allPlayers = [];
  let teamsById = new Map();
  let posById = new Map();
  let fixtures = [];
  let bank = 0;
  let freeTransfers = 1;
  let horizonGwIds = [];
  let fixturesByTeam = new Map();
  let optimizationResults = null;

  try {
    // Load bootstrap data
    bootstrap = state.bootstrap || (await fplClient.bootstrap()).data;
    state.bootstrap = bootstrap;

    if (!state.entryId) {
      shell.innerHTML = "";
      shell.append(utils.el("div", { class: "card" },
        "Enter your Entry ID in the sidebar to use the Transfer Optimizer."
      ));
      return;
    }

    allPlayers = bootstrap.elements || [];
    teamsById = new Map((bootstrap.teams || []).map(t => [t.id, t]));
    posById = new Map((bootstrap.element_types || []).map(p => [p.id, p.singular_name_short]));

    const events = bootstrap.events || [];
    const currentEvent = events.find(e => e.is_current);
    const nextEvent = events.find(e => e.is_next);
    const lastFinished = events.filter(e => e.data_checked).slice(-1)[0];
    const planGw = nextEvent?.id || ((currentEvent?.id || lastFinished?.id || 1) + 1);
    const maxGw = Math.max(...events.map(e => e.id));

    // Load fixtures
    const fixturesResult = await fplClient.fixtures();
    fixtures = Array.isArray(fixturesResult.data) ? fixturesResult.data :
      (fixturesResult.data?.fixtures || []);

    // Get horizon GW IDs
    horizonGwIds = events
      .filter(e => e.id >= planGw && e.id <= maxGw)
      .slice(0, horizonLen)
      .map(e => e.id);

    // Build fixtures by team
    fixturesByTeam = await buildFixturesByTeam(fixtures, horizonGwIds);

    // Load squad
    const picksGw = lastFinished?.id || currentEvent?.id || 1;
    const picksResult = await fplClient.entryPicks(state.entryId, picksGw);
    const picks = picksResult.data;

    if (!picks?.picks?.length) {
      shell.innerHTML = "";
      shell.append(ui.error("Transfer Optimizer", "Could not load your squad picks."));
      return;
    }

    // Get bank and free transfers
    const historyResult = await fplClient.entryHistory(state.entryId);
    const history = historyResult.data;
    const lastHistory = (history?.current || []).find(h => h.event === picksGw) || {};
    bank = (lastHistory.bank || 0) / 10;

    // Calculate free transfers (simplified - would need more logic for exact count)
    const lastTransfers = lastHistory.event_transfers || 0;
    freeTransfers = lastTransfers === 0 ? Math.min((freeTransfers || 1) + 1, 2) : 1;

    // Build squad array
    squad = picks.picks.map(pick => {
      const player = allPlayers.find(p => p.id === pick.element);
      return player;
    }).filter(Boolean);

    // Build the UI
    await buildUI();

  } catch (err) {
    console.error("Transfer Optimizer error:", err);
    shell.innerHTML = "";
    shell.append(ui.error("Transfer Optimizer Error", err));
  }

  async function buildUI() {
    shell.innerHTML = "";

    // Header
    const header = utils.el("div", { class: "to-header" });
    header.append(
      utils.el("h2", {}, "Transfer Optimizer"),
      utils.el("p", { class: "to-subtitle" },
        "Find optimal transfers with explicit reasoning for every suggestion"
      )
    );
    shell.append(header);

    // Status bar
    const statusBar = utils.el("div", { class: "to-status-bar chips" });
    statusBar.append(
      utils.el("span", { class: "chip" }, `Bank: ${money(bank)}`),
      utils.el("span", { class: "chip" }, `FT: ${freeTransfers}`),
      utils.el("span", { class: "chip" }, `Horizon: GW ${horizonGwIds[0]} - ${horizonGwIds[horizonGwIds.length - 1]}`),
      utils.el("span", { class: "chip" }, `Squad: ${squad.length} players`)
    );
    shell.append(statusBar);

    // Controls section
    const controls = utils.el("div", { class: "to-controls card" });
    controls.append(utils.el("h3", {}, "User Controls"));

    const controlsGrid = utils.el("div", { class: "to-controls-grid" });

    // Horizon selector
    const horizonControl = utils.el("div", { class: "to-control-group" });
    horizonControl.append(utils.el("label", {}, "Projection Horizon"));
    const horizonSelect = utils.el("select", { class: "to-select" });
    for (const [val, h] of Object.entries(HORIZONS)) {
      const opt = utils.el("option", { value: val }, h.label);
      if (parseInt(val) === horizonLen) opt.selected = true;
      horizonSelect.append(opt);
    }
    horizonSelect.addEventListener("change", async () => {
      horizonLen = parseInt(horizonSelect.value);
      localStorage.setItem(STORAGE_KEY_HORIZON, horizonLen);
      // Recalculate horizon GWs
      const events = bootstrap.events || [];
      const planGw = horizonGwIds[0] || 1;
      const maxGw = Math.max(...events.map(e => e.id));
      horizonGwIds = events
        .filter(e => e.id >= planGw && e.id <= maxGw)
        .slice(0, horizonLen)
        .map(e => e.id);
      fixturesByTeam = await buildFixturesByTeam(fixtures, horizonGwIds);
      await runOptimization();
    });
    horizonControl.append(horizonSelect);
    controlsGrid.append(horizonControl);

    // Allow hits toggle
    const hitsControl = utils.el("div", { class: "to-control-group" });
    hitsControl.append(utils.el("label", {}, "Allow Hits"));
    const hitsToggle = utils.el("input", { type: "checkbox", checked: allowHits });
    hitsToggle.addEventListener("change", async () => {
      allowHits = hitsToggle.checked;
      localStorage.setItem(STORAGE_KEY_ALLOW_HITS, allowHits);
      await runOptimization();
    });
    const hitsLabel = utils.el("label", { class: "to-toggle-label" });
    hitsLabel.append(hitsToggle, utils.el("span", {}, "Consider -4 hit transfers"));
    hitsControl.append(hitsLabel);
    controlsGrid.append(hitsControl);

    // Hit threshold slider
    const thresholdControl = utils.el("div", { class: "to-control-group" });
    thresholdControl.append(utils.el("label", {}, "Hit Threshold"));
    const thresholdValue = utils.el("span", { class: "to-threshold-value" }, `${hitThreshold} xP`);
    const thresholdSlider = utils.el("input", {
      type: "range",
      min: "2",
      max: "10",
      value: hitThreshold,
      class: "to-slider",
    });
    thresholdSlider.addEventListener("input", () => {
      hitThreshold = parseInt(thresholdSlider.value);
      thresholdValue.textContent = `${hitThreshold} xP`;
      localStorage.setItem(STORAGE_KEY_HIT_THRESHOLD, hitThreshold);
    });
    thresholdSlider.addEventListener("change", async () => {
      await runOptimization();
    });
    const thresholdRow = utils.el("div", { class: "to-slider-row" });
    thresholdRow.append(
      utils.el("span", {}, "2"),
      thresholdSlider,
      utils.el("span", {}, "10"),
      thresholdValue
    );
    thresholdControl.append(thresholdRow);
    controlsGrid.append(thresholdControl);

    controls.append(controlsGrid);

    // Locked players section
    const lockSection = utils.el("div", { class: "to-lock-section" });
    lockSection.append(utils.el("h4", {}, "Lock Players (won't be suggested for transfer)"));
    const lockGrid = utils.el("div", { class: "to-lock-grid" });

    for (const player of squad) {
      const isLocked = lockedPlayerIds.has(player.id);
      const lockItem = utils.el("div", { class: `to-lock-item ${isLocked ? "locked" : ""}` });
      const checkbox = utils.el("input", { type: "checkbox", checked: isLocked });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          lockedPlayerIds.add(player.id);
        } else {
          lockedPlayerIds.delete(player.id);
        }
        localStorage.setItem(STORAGE_KEY_LOCKED, JSON.stringify([...lockedPlayerIds]));
        lockItem.classList.toggle("locked", checkbox.checked);
      });
      lockItem.append(
        checkbox,
        utils.el("span", { class: "to-lock-name" }, player.web_name),
        utils.el("span", { class: "to-lock-team" }, teamsById.get(player.team)?.short_name || "?")
      );
      lockGrid.append(lockItem);
    }
    lockSection.append(lockGrid);
    controls.append(lockSection);

    // Exclude teams section
    const excludeSection = utils.el("div", { class: "to-exclude-section" });
    excludeSection.append(utils.el("h4", {}, "Exclude Teams (won't suggest players from)"));
    const teamGrid = utils.el("div", { class: "to-team-grid" });

    for (const [id, team] of teamsById) {
      const isExcluded = excludedTeamIds.has(id);
      const teamItem = utils.el("div", { class: `to-team-item ${isExcluded ? "excluded" : ""}` });
      const checkbox = utils.el("input", { type: "checkbox", checked: isExcluded });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          excludedTeamIds.add(id);
        } else {
          excludedTeamIds.delete(id);
        }
        localStorage.setItem(STORAGE_KEY_EXCLUDED_TEAMS, JSON.stringify([...excludedTeamIds]));
        teamItem.classList.toggle("excluded", checkbox.checked);
      });
      teamItem.append(
        checkbox,
        utils.el("span", {}, team.short_name)
      );
      teamGrid.append(teamItem);
    }
    excludeSection.append(teamGrid);
    controls.append(excludeSection);

    // Run button
    const runBtn = utils.el("button", { class: "btn-primary to-run-btn" }, "Run Optimization");
    runBtn.addEventListener("click", runOptimization);
    controls.append(runBtn);

    shell.append(controls);

    // Results sections (will be populated by runOptimization)
    const resultsContainer = utils.el("div", { class: "to-results", id: "toResults" });
    shell.append(resultsContainer);

    // Initial run
    await runOptimization();
  }

  async function runOptimization() {
    if (isProcessing) {
      cancelRequested = true;
      return;
    }

    isProcessing = true;
    const resultsContainer = document.getElementById("toResults");
    if (!resultsContainer) return;

    resultsContainer.innerHTML = "";
    resultsContainer.append(ui.spinner("Analyzing squad and finding optimal transfers..."));

    try {
      // Run the optimization
      optimizationResults = await simulateTransferScenarios(
        squad,
        allPlayers,
        teamsById,
        posById,
        horizonGwIds,
        bank,
        freeTransfers,
        fixturesByTeam,
        {
          lockedPlayerIds,
          excludeTeamIds: excludedTeamIds,
          excludePlayerIds: new Set(),
          allowHits,
          hitThreshold,
        }
      );

      if (cancelRequested) {
        cancelRequested = false;
        isProcessing = false;
        return;
      }

      // Render results
      await renderResults(resultsContainer);

    } catch (err) {
      console.error("Optimization error:", err);
      resultsContainer.innerHTML = "";
      resultsContainer.append(ui.error("Optimization Error", err));
    }

    isProcessing = false;
  }

  async function renderResults(container) {
    container.innerHTML = "";

    if (!optimizationResults) {
      container.append(utils.el("div", { class: "card" }, "No results yet. Click 'Run Optimization'."));
      return;
    }

    // Section 1: Weakest Contributors
    const weakestSection = utils.el("div", { class: "card to-section" });
    weakestSection.append(utils.el("h3", {}, "7.1 Weakest Contributors"));
    weakestSection.append(utils.el("p", { class: "to-section-desc" },
      "Players ranked by expendability score. Higher score = more expendable."
    ));

    const weakestGrid = utils.el("div", { class: "to-weakest-grid" });

    // Show top 5 most expendable
    const topExpendable = optimizationResults.rankedSquad
      .filter(r => !r.isLocked)
      .slice(0, 5);

    for (const { player, expendability } of topExpendable) {
      const card = utils.el("div", { class: "to-expendable-card" });

      const header = utils.el("div", { class: "to-expendable-header" });
      header.append(
        utils.el("span", { class: "to-player-name" }, player.web_name),
        createBadge(`${expendability.score}`, expendability.score >= 50 ? "danger" : expendability.score >= 30 ? "warning" : "default")
      );
      card.append(header);

      const meta = utils.el("div", { class: "to-expendable-meta" });
      meta.append(
        utils.el("span", {}, teamsById.get(player.team)?.short_name || "?"),
        utils.el("span", {}, money(player.now_cost / 10)),
        utils.el("span", {}, `${expendability.xpPerGw.toFixed(2)} xP/GW`)
      );
      card.append(meta);

      const reasons = utils.el("div", { class: "to-reasons" });
      for (const reason of expendability.reasons.slice(0, 3)) {
        reasons.append(createReasonChip(reason, "danger"));
      }
      card.append(reasons);

      weakestGrid.append(card);
    }

    weakestSection.append(weakestGrid);
    container.append(weakestSection);

    // Section 2: Transfer Recommendations
    const transfersSection = utils.el("div", { class: "card to-section" });
    transfersSection.append(utils.el("h3", {}, "7.2 Transfer Recommendations"));

    // Subsection: Roll Transfer
    const rollSection = utils.el("div", { class: "to-subsection" });
    rollSection.append(utils.el("h4", {}, "Option A: Roll Transfer"));
    const rollCard = utils.el("div", { class: "to-roll-card" });
    rollCard.append(
      utils.el("div", { class: "to-roll-action" }, "Save your free transfer"),
      utils.el("div", { class: "to-roll-desc" },
        `Next GW you'll have ${optimizationResults.rollTransfer.newFreeTransfers} FT. No changes to squad xP.`
      )
    );
    rollSection.append(rollCard);
    transfersSection.append(rollSection);

    // Subsection: Best 1FT Options
    const ftSection = utils.el("div", { class: "to-subsection" });
    ftSection.append(utils.el("h4", {}, `Option B: Best ${freeTransfers === 1 ? "1" : freeTransfers} Free Transfer${freeTransfers > 1 ? "s" : ""}`));

    if (optimizationResults.oneTransferOptions.length === 0) {
      ftSection.append(utils.el("div", { class: "to-no-results" },
        "No profitable transfers found. Consider rolling your transfer."
      ));
    } else {
      const ftGrid = utils.el("div", { class: "to-transfers-list" });

      for (const transfer of optimizationResults.oneTransferOptions.slice(0, 5)) {
        const formatted = formatTransferSuggestion(transfer, bank);
        ftGrid.append(createTransferCard(formatted, horizonGwIds.length));
      }

      ftSection.append(ftGrid);
    }
    transfersSection.append(ftSection);

    // Subsection: Hit Options (if allowed)
    if (allowHits && optimizationResults.hitOptions.length > 0) {
      const hitSection = utils.el("div", { class: "to-subsection" });
      hitSection.append(utils.el("h4", {}, "Option C: Transfers with Hit (-4)"));
      hitSection.append(utils.el("p", { class: "to-hit-warning" },
        `Only showing transfers where net gain exceeds ${hitThreshold} xP threshold.`
      ));

      const hitGrid = utils.el("div", { class: "to-transfers-list" });

      for (const transfer of optimizationResults.hitOptions.slice(0, 3)) {
        const formatted = formatTransferSuggestion(transfer, bank);
        hitGrid.append(createTransferCard(formatted, horizonGwIds.length));
      }

      hitSection.append(hitGrid);
      transfersSection.append(hitSection);
    } else if (allowHits) {
      const hitSection = utils.el("div", { class: "to-subsection" });
      hitSection.append(utils.el("h4", {}, "Option C: Transfers with Hit (-4)"));
      hitSection.append(utils.el("div", { class: "to-no-results" },
        `No transfers meet the ${hitThreshold} xP threshold to justify a hit.`
      ));
      transfersSection.append(hitSection);
    }

    container.append(transfersSection);

    // Section 3: Squad Overview
    const overviewSection = utils.el("div", { class: "card to-section" });
    overviewSection.append(utils.el("h3", {}, "Squad Overview"));

    const overviewStats = utils.el("div", { class: "to-overview-stats" });
    overviewStats.append(
      utils.el("div", { class: "stat-card" }, [
        utils.el("div", { class: "stat-value" }, optimizationResults.squadXpTotal.toFixed(2)),
        utils.el("div", { class: "stat-label" }, `Total xP (${horizonGwIds.length} GW${horizonGwIds.length > 1 ? "s" : ""})`),
      ]),
      utils.el("div", { class: "stat-card" }, [
        utils.el("div", { class: "stat-value" }, optimizationResults.squadXpPerGw.toFixed(2)),
        utils.el("div", { class: "stat-label" }, "Avg xP/GW"),
      ]),
      utils.el("div", { class: "stat-card" }, [
        utils.el("div", { class: "stat-value" }, money(bank)),
        utils.el("div", { class: "stat-label" }, "In the Bank"),
      ]),
      utils.el("div", { class: "stat-card" }, [
        utils.el("div", { class: "stat-value" }, lockedPlayerIds.size.toString()),
        utils.el("div", { class: "stat-label" }, "Locked Players"),
      ])
    );
    overviewSection.append(overviewStats);

    // Full squad table
    const squadTable = utils.el("div", { class: "to-squad-table" });
    const tableHeader = utils.el("div", { class: "to-squad-row to-squad-header" });
    tableHeader.append(
      utils.el("span", {}, "Player"),
      utils.el("span", {}, "Team"),
      utils.el("span", {}, "Price"),
      utils.el("span", {}, "xP/GW"),
      utils.el("span", {}, "Status"),
      utils.el("span", {}, "Expendability")
    );
    squadTable.append(tableHeader);

    for (const { player, expendability, isLocked } of optimizationResults.rankedSquad) {
      const row = utils.el("div", { class: `to-squad-row ${isLocked ? "locked" : ""}` });

      const statusClass = player.status === "a" ? "st-okay" :
        player.status === "d" ? "st-doubt" :
          player.status === "i" ? "st-inj" : "st-out";
      const statusText = player.status === "a" ? "OK" :
        player.status === "d" ? "?" :
          player.status === "i" ? "INJ" :
            player.status === "s" ? "SUS" : "N/A";

      row.append(
        utils.el("span", { class: "to-squad-name" }, [
          isLocked ? utils.el("span", { class: "lock-icon", "data-tooltip": "Locked" }, "🔒") : null,
          player.web_name,
        ]),
        utils.el("span", {}, teamsById.get(player.team)?.short_name || "?"),
        utils.el("span", {}, money(player.now_cost / 10)),
        utils.el("span", {}, expendability.xpPerGw.toFixed(2)),
        utils.el("span", { class: `status-pill ${statusClass}` }, statusText),
        utils.el("span", {}, isLocked ? "LOCKED" : expendability.score.toString())
      );
      squadTable.append(row);
    }
    overviewSection.append(squadTable);

    container.append(overviewSection);

    // Assumptions/Disclaimer
    const assumptions = utils.el("div", { class: "card to-section to-assumptions" });
    assumptions.append(utils.el("h4", {}, "Model Assumptions"));
    const assumptionsList = utils.el("ul", { class: "to-assumptions-list" });
    assumptionsList.append(
      utils.el("li", {}, `xP calculated over ${horizonGwIds.length} GW${horizonGwIds.length > 1 ? "s" : ""} (GW ${horizonGwIds[0]}-${horizonGwIds[horizonGwIds.length - 1]})`),
      utils.el("li", {}, "Minutes projection based on recent form and player status"),
      utils.el("li", {}, "Fixture difficulty from FPL's FDR (2-5 scale)"),
      utils.el("li", {}, "Club limit enforced (max 3 players per team)"),
      utils.el("li", {}, `Hit threshold: ${hitThreshold} xP gain required to recommend a -4 hit`),
      utils.el("li", {}, "Locked players will not be suggested for transfer out")
    );
    assumptions.append(assumptionsList);
    container.append(assumptions);
  }
}
