// js/pages/mini-league.js
// PHASE 3: League page with Selector Grid + Detail View (no scrolling)
import { api } from "../api.js";
import { state, validateState, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { log } from "../logger.js";

/**
 * Mini-League - Two-view model:
 * 1. Selector View (default): Grid of league cards showing summary stats
 * 2. Detail View (on click): Full standings, charts, Top XI with back button
 */

// Module state for view management
let currentView = "selector"; // "selector" | "detail"
let selectedLeagueId = null;
let leagueDataCache = new Map();

export async function renderMiniLeague(main) {
  const page = utils.el("div", { class: "league-page" });
  page.innerHTML = '<div class="league-loading">Loading leagues...</div>';
  ui.mount(main, page);

  try {
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;

    // GW markers
    const finishedIds = events.filter(e => e.data_checked).map(e => e.id);
    const lastFinished = finishedIds.length ? Math.max(...finishedIds) : 0;
    const liveEvent = events.find(e => e.is_current && !e.data_checked) || null;
    const liveGwId = liveEvent?.id || null;
    const gwRef = liveGwId || lastFinished || 0;
    const isLive = !!liveGwId && gwRef === liveGwId;

    if (!gwRef) {
      page.innerHTML = '<div class="league-empty">No Gameweeks yet.</div>';
      return;
    }

    const leagues = Array.isArray(state.leagueIds) && state.leagueIds.length ? state.leagueIds : [];
    if (!leagues.length) {
      log.info("Mini-League: Setup required - missing leagueIds");
      const setupPrompt = ui.setupPrompt({
        missing: ['leagueIds'],
        context: "to view your mini-leagues",
        onSave: ({ entryId, leagueIds }) => {
          if (entryId) state.entryId = entryId;
          if (leagueIds.length > 0) {
            state.leagueIds = leagueIds;
            log.info("League IDs configured - reloading page");
            renderMiniLeague(main);
          }
        },
        onSkip: () => {
          location.hash = "#/";
        }
      });
      ui.mount(main, setupPrompt);
      return;
    }

    // Preload event_live for the extra GW (live/provisional)
    let extraMap = null;
    if (liveGwId) {
      try {
        const live = await api.eventLive(liveGwId);
        extraMap = new Map((live?.elements || []).map(e => [e.id, e.stats || {}]));
      } catch { extraMap = new Map(); }
    }

    // Helpers
    const byPlayerId = new Map(players.map(p => [p.id, p]));
    const teamShort = new Map(teams.map(t => [t.id, t.short_name]));
    const posShort = new Map(positions.map(p => [p.id, p.singular_name_short]));

    const safeManager = (r) =>
      r.player_name || (r.player_first_name || r.player_last_name
        ? `${r.player_first_name || ""} ${r.player_last_name || ""}`.trim()
        : "—");

    // Pool map helper for parallel API calls
    async function poolMap(items, limit, worker) {
      const res = new Array(items.length);
      let i = 0;
      const runners = Array.from({ length: Math.max(1, limit) }, async () => {
        while (i < items.length) {
          const idx = i++;
          try { res[idx] = await worker(items[idx], idx); }
          catch { res[idx] = null; }
        }
      });
      await Promise.all(runners);
      return res;
    }

    // Fetch league summary for selector view
    async function fetchLeagueSummary(lid) {
      if (leagueDataCache.has(lid)) return leagueDataCache.get(lid);

      try {
        const data = await api.leagueClassic(lid, 1);
        const leagueName = data?.league?.name || `League ${lid}`;
        const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];

        // Find your position
        const me = results.find(r => state.entryId && Number(state.entryId) === Number(r.entry));
        const myRank = me ? results.indexOf(me) + 1 : null;
        const leaderPts = results[0]?.total || 0;
        const myPts = me?.total || 0;
        const gapToLeader = myRank > 1 ? leaderPts - myPts : 0;

        const summary = {
          id: lid,
          name: leagueName,
          teamCount: results.length,
          myRank,
          myPts,
          myGwPts: me?.event_total || 0,
          gapToLeader,
          leader: results[0]?.entry_name || "—",
          leaderPts,
          results,
          gwRef,
          isLive
        };

        leagueDataCache.set(lid, summary);
        return summary;
      } catch (e) {
        return { id: lid, name: `League ${lid}`, error: true };
      }
    }

    // Render selector view (grid of league cards)
    async function renderSelectorView() {
      currentView = "selector";
      selectedLeagueId = null;

      page.innerHTML = `
        <div class="league-header">
          <h1>My Leagues</h1>
          <span class="league-gw-badge">GW${gwRef}${isLive ? " (live)" : ""}</span>
        </div>
        <div class="league-grid" id="leagueGrid">
          ${leagues.map(lid => `
            <div class="league-card league-card-loading" data-lid="${lid}">
              <div class="league-card-skeleton">Loading...</div>
            </div>
          `).join("")}
        </div>
      `;

      // Load each league summary
      for (const lid of leagues) {
        const summary = await fetchLeagueSummary(lid);
        const cardEl = page.querySelector(`.league-card[data-lid="${lid}"]`);
        if (!cardEl) continue;

        cardEl.classList.remove("league-card-loading");

        if (summary.error) {
          cardEl.innerHTML = `
            <div class="league-card-header"><h3>${summary.name}</h3></div>
            <div class="league-card-error">Failed to load</div>
          `;
          continue;
        }

        cardEl.innerHTML = `
          <div class="league-card-header">
            <h3>${summary.name}</h3>
            <span class="league-card-count">${summary.teamCount} teams</span>
          </div>
          <div class="league-card-stats">
            ${summary.myRank ? `
              <div class="league-stat">
                <span class="league-stat-val">#${summary.myRank}</span>
                <span class="league-stat-lbl">Your Rank</span>
              </div>
              <div class="league-stat">
                <span class="league-stat-val ${summary.gapToLeader > 0 ? 'stat-behind' : 'stat-leading'}">${summary.gapToLeader > 0 ? `-${summary.gapToLeader}` : summary.gapToLeader === 0 ? "Leader" : `+${Math.abs(summary.gapToLeader)}`}</span>
                <span class="league-stat-lbl">Gap</span>
              </div>
              <div class="league-stat">
                <span class="league-stat-val">${summary.myGwPts}</span>
                <span class="league-stat-lbl">GW Pts</span>
              </div>
              <div class="league-stat">
                <span class="league-stat-val">${summary.myPts}</span>
                <span class="league-stat-lbl">Total</span>
              </div>
            ` : `
              <div class="league-stat league-stat-full">
                <span class="league-stat-lbl">Set your Entry ID to see your position</span>
              </div>
            `}
          </div>
          <div class="league-card-leader">
            <span>Leader: ${summary.leader}</span>
            <span>${summary.leaderPts} pts</span>
          </div>
        `;

        cardEl.addEventListener("click", () => renderDetailView(lid));
      }
    }

    // Render detail view (full table + charts)
    async function renderDetailView(lid) {
      currentView = "detail";
      selectedLeagueId = lid;

      page.innerHTML = '<div class="league-loading">Loading league details...</div>';

      const summary = await fetchLeagueSummary(lid);
      if (summary.error) {
        page.innerHTML = `
          <div class="league-detail-header">
            <button class="league-back-btn" id="backBtn">← Back</button>
            <h2>${summary.name}</h2>
          </div>
          <div class="league-error">Failed to load league data</div>
        `;
        page.querySelector("#backBtn").addEventListener("click", renderSelectorView);
        return;
      }

      // Build full data with history
      const results = summary.results;
      const rows = results.map(r => ({
        manager: safeManager(r),
        team: r.entry_name || "—",
        entry: r.entry,
        my: state.entryId && Number(state.entryId) === Number(r.entry),
        gw: r.event_total || 0,
        total: r.total || 0,
        rank: r.rank || 0
      }));

      // Fetch history for charts
      const labelsFinished = Array.from({ length: lastFinished }, (_, i) => `GW${i + 1}`);
      const labels = liveGwId ? [...labelsFinished, `GW${liveGwId} (live)`] : labelsFinished;
      const datasetsTotal = [];
      const datasetsGW = [];

      const colorFor = (i, strong = false) => {
        const hue = (i * 137.508) % 360;
        const lineA = strong ? 0.4 : 0.15;
        const pointA = strong ? 0.9 : 0.5;
        return {
          line: `hsla(${hue}, 70%, 45%, ${lineA})`,
          point: `hsla(${hue}, 70%, 45%, ${pointA})`
        };
      };

      // Only load history for first 10 managers to keep it fast
      await poolMap(rows.slice(0, 10), 4, async (r, idx) => {
        if (!r?.entry) return;
        try {
          const hist = await api.entryHistory(r.entry);
          const totals = [];
          const perGW = [];

          for (let gw = 1; gw <= lastFinished; gw++) {
            const rec = hist.current.find(x => x.event === gw);
            const prev = totals[totals.length - 1] ?? 0;
            totals.push(rec ? rec.total_points : prev);
            perGW.push(rec ? rec.points : 0);
          }

          // Add live GW if available
          if (liveGwId && extraMap) {
            let extraPts = 0;
            try {
              const picks = await api.entryPicks(r.entry, liveGwId);
              for (const p of (picks?.picks || [])) {
                const mult = p.multiplier ?? (p.is_captain ? 2 : (p.position <= 11 ? 1 : 0));
                const pts = (extraMap.get(p.element)?.total_points) ?? 0;
                extraPts += mult * pts;
              }
            } catch {}
            totals.push((totals[totals.length - 1] ?? 0) + extraPts);
            perGW.push(extraPts);
          }

          const { line, point } = colorFor(idx, r.my);
          const dsStyle = {
            borderColor: line,
            backgroundColor: "transparent",
            borderWidth: r.my ? 3 : 2,
            pointRadius: r.my ? 3 : 2,
            pointBackgroundColor: point,
            tension: 0.3
          };

          datasetsTotal.push({ label: r.team, data: totals, ...dsStyle });
          datasetsGW.push({ label: r.team, data: perGW, ...dsStyle });
        } catch {}
      });

      // League Top XI
      const counts = new Map();
      const caps = new Map();
      await poolMap(rows.slice(0, 20), 4, async (r) => {
        try {
          const picks = await api.entryPicks(r.entry, gwRef);
          for (const p of (picks?.picks || [])) {
            counts.set(p.element, (counts.get(p.element) || 0) + 1);
            if (p.is_captain) caps.set(p.element, (caps.get(p.element) || 0) + 1);
          }
        } catch {}
      });

      const bucket = (posId) =>
        [...counts.entries()]
          .map(([id, ct]) => {
            const pl = byPlayerId.get(id);
            return pl ? {
              id, ct,
              cap: caps.get(id) || 0,
              name: pl.web_name,
              pos: posShort.get(pl.element_type) || "?",
              team: teamShort.get(pl.team) || "?",
              price: (pl.now_cost / 10).toFixed(1)
            } : null;
          })
          .filter(Boolean)
          .filter(x => (byPlayerId.get(x.id)?.element_type) === posId)
          .sort((a, b) => b.ct - a.ct || b.cap - a.cap);

      const GK = bucket(1), DEF = bucket(2), MID = bucket(3), FWD = bucket(4);
      const xi = [...GK.slice(0, 1), ...DEF.slice(0, 3), ...MID.slice(0, 4), ...FWD.slice(0, 3)];

      // Render detail page
      page.innerHTML = `
        <div class="league-detail-header">
          <button class="league-back-btn" id="backBtn">← Back to Leagues</button>
          <h2>${summary.name}</h2>
          <span class="league-gw-badge">GW${gwRef}${isLive ? " (live)" : ""}</span>
        </div>
        <div class="league-detail-grid">
          <div class="league-detail-col league-detail-left">
            <div class="league-detail-card">
              <h3>Standings</h3>
              <div class="league-standings" id="standingsTable"></div>
            </div>
            <div class="league-detail-card">
              <h3>League Top XI (GW${gwRef})</h3>
              <div class="league-xi" id="topXI"></div>
            </div>
          </div>
          <div class="league-detail-col league-detail-center">
            <div class="league-detail-card league-chart-card">
              <h3>Cumulative Points</h3>
              <div class="league-chart-wrap"><canvas id="chartTotal"></canvas></div>
            </div>
            <div class="league-detail-card league-chart-card">
              <h3>GW Points</h3>
              <div class="league-chart-wrap"><canvas id="chartGW"></canvas></div>
            </div>
          </div>
        </div>
      `;

      page.querySelector("#backBtn").addEventListener("click", renderSelectorView);

      // Build standings table
      const standingsEl = page.querySelector("#standingsTable");
      const table = ui.table([
        { header: "#", accessor: r => r.rank, sortBy: r => r.rank },
        {
          header: "Team", cell: r => {
            const wrap = utils.el("div", { class: "name-cell" });
            wrap.append(utils.el("span", {}, r.team));
            if (r.my) wrap.append(utils.el("span", { class: "chip chip-accent" }, "You"));
            return wrap;
          }, sortBy: r => r.team
        },
        { header: "Manager", accessor: r => r.manager, sortBy: r => r.manager },
        { header: `GW${gwRef}`, accessor: r => r.gw, sortBy: r => r.gw, tdClass: r => r.gw >= 60 ? "points-high" : r.gw < 30 ? "points-low" : "" },
        { header: "Total", accessor: r => r.total, sortBy: r => r.total }
      ], rows);
      standingsEl.append(table);

      // Build Top XI
      const xiEl = page.querySelector("#topXI");
      if (xi.length > 0) {
        xiEl.innerHTML = xi.map(p => `
          <div class="league-xi-row">
            <span class="league-xi-pos">${p.pos}</span>
            <span class="league-xi-name">${p.name}</span>
            <span class="league-xi-team">${p.team}</span>
            <span class="league-xi-picked">${p.ct} picked</span>
          </div>
        `).join("");
      } else {
        xiEl.innerHTML = '<p class="league-xi-empty">No data</p>';
      }

      // Draw charts
      const chartOpts = {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 8, boxHeight: 8, font: { size: 10 } } }
        },
        scales: {
          x: { ticks: { font: { size: 9 } } },
          y: { beginAtZero: true, ticks: { font: { size: 9 } } }
        }
      };

      await ui.chart(page.querySelector("#chartTotal"), {
        type: "line",
        data: { labels, datasets: datasetsTotal },
        options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, title: { display: true, text: "Total pts", font: { size: 10 } } } } }
      });

      await ui.chart(page.querySelector("#chartGW"), {
        type: "line",
        data: { labels, datasets: datasetsGW },
        options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, title: { display: true, text: "GW pts", font: { size: 10 } } } } }
      });
    }

    // Initial render
    await renderSelectorView();

  } catch (err) {
    log.error("Mini-League: Failed to load", err);
    const errorCard = ui.errorCard({
      title: "Failed to load leagues",
      message: "There was a problem fetching league data. Please check your league IDs and try again.",
      error: err,
      onRetry: async () => {
        await renderMiniLeague(main);
      }
    });
    ui.mount(main, errorCard);
  }
}
