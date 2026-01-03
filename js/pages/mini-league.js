// js/pages/mini-league.js
// PHASE 3: League page with Selector Grid + Detail View (no scrolling)
// PHASE 10: Fix infinite loading - robust error handling with partial failure support
import { fplClient, legacyApi } from "../api/fplClient.js";
import { state, validateState, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { log } from "../logger.js";
import { getCacheAge, CacheKey, loadFromCache, formatCacheAge } from "../api/fetchHelper.js";

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
  // Show loading state
  ui.mount(main, ui.loadingWithTimeout("Loading leagues..."));

  // Fetch bootstrap
  const bootstrapResult = state.bootstrap
    ? { ok: true, data: state.bootstrap, fromCache: false, cacheAge: 0 }
    : await fplClient.bootstrap();

  if (!bootstrapResult.ok) {
    const cacheAge = getCacheAge(CacheKey.BOOTSTRAP);
    const hasCache = cacheAge !== null;

    ui.mount(main, ui.degradedCard({
      title: "Failed to Load Leagues",
      errorType: bootstrapResult.errorType,
      message: bootstrapResult.message,
      cacheAge: hasCache ? cacheAge : null,
      onRetry: () => renderMiniLeague(main),
      onUseCached: hasCache ? async () => {
        state.bootstrap = fplClient.loadBootstrapFromCache().data;
        await renderMiniLeague(main);
      } : null,
    }));
    return;
  }

  const page = utils.el("div", { class: "league-page" });

  try {
    const bs = bootstrapResult.data;
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
        const liveResult = await fplClient.eventLive(liveGwId);
        const live = liveResult.ok ? liveResult.data : { elements: [] };
        extraMap = new Map((live?.elements || []).map(e => [e.id, e.stats || {}]));
      } catch { extraMap = new Map(); }
    }

    // Helpers
    const byPlayerId = new Map(players.map(p => [p.id, p]));
    const teamShort = new Map(teams.map(t => [t.id, t.short_name]));
    const posShort = new Map(positions.map(p => [p.id, p.singular_name_short]));

    const buildCachedSummary = (lid, markStale = true) => {
      const cached = loadFromCache(CacheKey.LEAGUE_CLASSIC, lid, 1);
      if (!cached) return null;

      const cacheAge = Date.now() - cached.timestamp;
      const data = cached.data;
      const leagueName = data?.league?.name || `League ${lid}`;
      const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];
      const me = results.find(r => state.entryId && Number(state.entryId) === Number(r.entry));
      const myRank = me ? results.indexOf(me) + 1 : null;
      const leaderPts = results[0]?.total || 0;
      const myPts = me?.total || 0;
      const gapToLeader = myRank > 1 ? leaderPts - myPts : 0;

      return {
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
        isLive,
        fromCache: true,
        cacheAge,
        stale: markStale,
      };
    };

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
    // Phase 10: Enhanced error handling with cache fallback
    async function fetchLeagueSummary(lid) {
      if (leagueDataCache.has(lid)) return leagueDataCache.get(lid);

      try {
        const leagueResult = await fplClient.leagueClassic(lid, 1);

        if (!leagueResult.ok) {
          const cached = buildCachedSummary(lid);
          if (cached) return cached;
          return {
            id: lid,
            name: `League ${lid}`,
            error: true,
            errorType: leagueResult.errorType,
            errorMessage: leagueResult.message
          };
        }

        const data = leagueResult.data;
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
          isLive,
          fromCache: leagueResult.fromCache,
          cacheAge: leagueResult.cacheAge || 0
        };

        leagueDataCache.set(lid, summary);
        return summary;
      } catch (e) {
        log.error(`Failed to fetch league ${lid}:`, e);
        const cached = buildCachedSummary(lid);
        if (cached) return cached;
        return {
          id: lid,
          name: `League ${lid}`,
          error: true,
          errorMessage: e?.message || "Failed to load"
        };
      }
    }

    // Render selector view (grid of league cards)
    // Phase 10: Parallel fetch with partial failure handling
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

      // Fetch all leagues in parallel with a global timeout to prevent infinite loading
      const LOAD_TIMEOUT = 20000; // 20 seconds max for all leagues to load

      const summaries = (await Promise.allSettled(
        leagues.map((lid) =>
          Promise.race([
            fetchLeagueSummary(lid),
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ id: lid, name: `League ${lid}`, error: true, errorMessage: "Loading timed out" }),
                LOAD_TIMEOUT
              )
            ),
          ]).catch((err) => ({
            id: lid,
            name: `League ${lid}`,
            error: true,
            errorMessage: err?.message || "Failed to load league",
          }))
        )
      )).map((res, idx) => {
        const fallback = {
          id: leagues[idx],
          name: `League ${leagues[idx]}`,
          error: true,
          errorMessage: res.reason?.message || "Failed to load league",
        };
        const summary = res.status === "fulfilled" ? res.value : fallback;
        if (summary && !summary.error) return summary;

        const cached = buildCachedSummary(leagues[idx]);
        return cached || summary || fallback;
      });

      // Check for total failure (all leagues failed without cache)
      const successfulLeagues = summaries.filter(s => !s.error);
      const failedLeagues = summaries.filter(s => s.error);
      const staleLeagues = summaries.filter(s => s.stale);

      // If all leagues failed completely (no cache available), show error state
      if (successfulLeagues.length === 0 && failedLeagues.length === leagues.length) {
        // Check if any cached data is available
        const anyCache = leagues.some(lid => {
          const cached = loadFromCache(CacheKey.LEAGUE_CLASSIC, lid, 1);
          return cached !== null;
        });

        page.innerHTML = "";
        const errorCard = utils.el("div", { class: "league-all-failed" });
        errorCard.innerHTML = `
          <div class="error-card">
            <div class="error-card-header">
              <span class="error-card-icon">⚠️</span>
              <span class="error-card-title">Failed to Load Leagues</span>
            </div>
            <p class="error-card-message">
              Unable to load your mini-league standings. This could be a network issue or the FPL API may be temporarily unavailable.
            </p>
            ${failedLeagues[0]?.errorMessage ? `<div class="error-card-details">${failedLeagues[0].errorMessage}</div>` : ""}
            <div class="error-card-actions">
              <button class="btn-retry" id="retryBtn">Retry</button>
              ${anyCache ? `<button class="btn-use-cached" id="useCachedBtn">Use Cached Data</button>` : ""}
            </div>
          </div>
        `;
        page.appendChild(errorCard);

        page.querySelector("#retryBtn")?.addEventListener("click", () => {
          leagueDataCache.clear();
          renderMiniLeague(main);
        });

        page.querySelector("#useCachedBtn")?.addEventListener("click", async () => {
          // Force use of cached data
          for (const lid of leagues) {
            const cachedSummary = buildCachedSummary(lid);
            if (cachedSummary) leagueDataCache.set(lid, cachedSummary);
          }
          await renderSelectorView();
        });
        return;
      }

      // Show stale data banner if using cached data
      if (staleLeagues.length > 0) {
        const oldestCache = Math.max(...staleLeagues.map(s => s.cacheAge || 0));
        const banner = utils.el("div", { class: "cached-banner league-stale-banner" });
        banner.innerHTML = `
          <div class="cached-banner-content">
            <span class="cached-banner-icon">📡</span>
            <span class="cached-banner-text">
              <strong>Using cached data</strong> — Some leagues may be outdated (${formatCacheAge(oldestCache)})
            </span>
          </div>
          <div class="cached-banner-actions">
            <button class="btn-banner-refresh" id="refreshBtn">Refresh</button>
          </div>
        `;
        const header = page.querySelector(".league-header");
        header?.after(banner);

        banner.querySelector("#refreshBtn")?.addEventListener("click", () => {
          leagueDataCache.clear();
          renderMiniLeague(main);
        });
      }

      // Render each league card
      for (const summary of summaries) {
        const cardEl = page.querySelector(`.league-card[data-lid="${summary.id}"]`);
        if (!cardEl) continue;

        cardEl.classList.remove("league-card-loading");

        if (summary.error) {
          // Failed league card with retry button
          cardEl.classList.add("league-card-error-state");
          cardEl.innerHTML = `
            <div class="league-card-header"><h3>${summary.name}</h3></div>
            <div class="league-card-error-content">
              <span class="league-card-error-icon">⚠️</span>
              <span class="league-card-error-text">Failed to load</span>
              ${summary.errorMessage ? `<span class="league-card-error-detail">${summary.errorMessage}</span>` : ""}
            </div>
            <button class="league-card-retry-btn">Retry</button>
          `;
          cardEl.querySelector(".league-card-retry-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            cardEl.classList.add("league-card-loading");
            cardEl.innerHTML = '<div class="league-card-skeleton">Loading...</div>';
            leagueDataCache.delete(summary.id);
            const newSummary = await fetchLeagueSummary(summary.id);
            // Re-render just this card
            renderLeagueCard(cardEl, newSummary);
          });
          continue;
        }

        renderLeagueCard(cardEl, summary);
      }
    }

    // Helper to render a single league card
    function renderLeagueCard(cardEl, summary) {
      cardEl.classList.remove("league-card-loading", "league-card-error-state");

      if (summary.error) {
        cardEl.classList.add("league-card-error-state");
        cardEl.innerHTML = `
          <div class="league-card-header"><h3>${summary.name}</h3></div>
          <div class="league-card-error-content">
            <span class="league-card-error-icon">⚠️</span>
            <span class="league-card-error-text">Failed to load</span>
          </div>
          <button class="league-card-retry-btn">Retry</button>
        `;
        return;
      }

      const staleIndicator = summary.stale ?
        `<span class="league-card-stale" title="Using cached data from ${formatCacheAge(summary.cacheAge)}">📡</span>` : "";

      cardEl.innerHTML = `
        <div class="league-card-header">
          <h3>${summary.name}${staleIndicator}</h3>
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

      cardEl.addEventListener("click", () => renderDetailView(summary.id));
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
          const histResult = await fplClient.entryHistory(r.entry);
          const hist = histResult.ok ? histResult.data : { current: [] };
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
              const picksResult = await fplClient.entryPicks(r.entry, liveGwId);
              const picks = picksResult.ok ? picksResult.data : { picks: [] };
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
          const picksResult = await fplClient.entryPicks(r.entry, gwRef);
          const picks = picksResult.ok ? picksResult.data : { picks: [] };
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
