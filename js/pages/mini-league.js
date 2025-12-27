// js/pages/mini-league.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

/**
 * Mini-League (robust live/provisional handling)
 * - GW column = most recent GW that has played/playing (live/provisional/final).
 * - Total = cumulative up to that GW.
 * - Charts include all finished GWs + the extra GW (live/prov) if present.
 * - Sorted by cumulative total. Highlights "You".
 * - League Top XI uses the same reference GW.
 */

export async function renderMiniLeague(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading leagues…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;

    // -------- GW markers (robust) --------
    const nowTs = Date.now();
    const toTs  = (s)=> (s ? new Date(s).getTime() : 0);

    const finishedIds = events.filter(e => e.data_checked).map(e => e.id);
    const lastFinished = finishedIds.length ? Math.max(...finishedIds) : 0;

    const liveEvent = events.find(e => e.is_current && !e.data_checked) || null;
    const liveGwId  = liveEvent?.id || null;

    // "Played or playing" candidates:
    const playedFlags = events
      .filter(e => e.is_current || e.is_previous || e.finished || e.finished_provisional)
      .map(e => e.id);

    // Fallback: any GW whose deadline has passed counts as "played" candidate
    const deadlinePlayed = events
      .filter(e => toTs(e.deadline_time) <= nowTs)
      .map(e => e.id);

    const mostRecentCandidate = Math.max(0, ...playedFlags, ...deadlinePlayed, lastFinished);
    const gwRef = mostRecentCandidate || lastFinished || 0;

    const isLive        = !!liveGwId && gwRef === liveGwId;
    const isProvisional = !isLive && gwRef > lastFinished;
    const extraGwId     = gwRef > lastFinished ? gwRef : null;

    if (!gwRef){
      ui.mount(main, utils.el("div",{class:"card"},"No Gameweeks yet."));
      return;
    }

    const leagues = Array.isArray(state.leagueIds) && state.leagueIds.length ? state.leagueIds : [];
    if (!leagues.length){
      ui.mount(main, utils.el("div",{class:"card"},"Add at least one Classic League ID in the sidebar (comma-separated)."));
      return;
    }

    // helpers
    const byPlayerId = new Map(players.map(p=>[p.id,p]));
    const teamShort  = new Map(teams.map(t=>[t.id,t.short_name]));
    const posShort   = new Map(positions.map(p=>[p.id,p.singular_name_short]));

    const safeManager = (r)=>
      r.player_name || (r.player_first_name || r.player_last_name
        ? `${r.player_first_name||""} ${r.player_last_name||""}`.trim()
        : "—");

    async function poolMap(items, limit, worker){
      const res = new Array(items.length);
      let i = 0;
      const runners = Array.from({length:Math.max(1,limit)}, async ()=>{
        while (i < items.length){
          const idx = i++;
          try{ res[idx] = await worker(items[idx], idx); }
          catch{ res[idx] = null; }
        }
      });
      await Promise.all(runners);
      return res;
    }

    // Preload event_live for the extra GW (live/provisional)
    let extraMap = null; // Map<elementId, stats>
    if (extraGwId){
      try{
        const live = await api.eventLive(extraGwId);
        extraMap = new Map((live?.elements||[]).map(e=>[e.id, e.stats||{}]));
      }catch{ extraMap = new Map(); }
    }

    // nice translucent color set
    const colorFor = (i, strong=false)=>{
      const hue = (i * 137.508) % 360;
      const lineA  = strong ? 0.35 : 0.12;
      const pointA = strong ? 0.9  : 0.55;
      return {
        line:  `hsla(${hue}, 70%, 45%, ${lineA})`,
        point: `hsla(${hue}, 70%, 45%, ${pointA})`
      };
    };

    const deck = utils.el("div");
    wrap.innerHTML = "";
    wrap.append(deck);
    ui.mount(main, wrap);

    for (const lid of leagues){
      const card = utils.el("div",{class:"card"});
      const headRow = utils.el("div",{class:"chips"},[
        utils.el("span",{class:"chip chip-dim"}, `League ID: ${lid}`),
        utils.el("span",{class:"chip"}, `Last finished: GW${lastFinished || "—"}`),
        extraGwId
          ? utils.el("span",{class:"chip chip-accent"},
              `Most recent: GW${gwRef} ${isLive ? "(live)" : "(prov)"}`)
          : utils.el("span",{class:"chip"}, `Most recent: GW${gwRef}`)
      ]);
      card.append(utils.el("h3",{},`League ${lid}`), headRow, ui.spinner("Loading…"));
      deck.append(card);

      try{
        const data = await api.leagueClassic(lid, 1);
        const leagueName = data?.league?.name || `League ${lid}`;
        const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];

        // Skeleton rows
        const rows = results.map(r=>({
          manager: safeManager(r),
          team: r.entry_name || "—",
          entry: r.entry,
          my: (state.entryId && Number(state.entryId) === Number(r.entry)) || false,

          // computed later
          gw: null,
          total: null,
          prevTotal: null,
          currTotal: null,
          prevRank: null,
          currRank: null,
          mov: null
        }));

        // Labels for charts
        const labelsFinished = Array.from({length:lastFinished}, (_,i)=>`GW${i+1}`);
        const labels = extraGwId
          ? [...labelsFinished, `GW${extraGwId}${isLive ? " (live)" : " (prov)"}`]
          : labelsFinished;

        const datasetsTotal = [];
        const datasetsGW = [];

        await poolMap(rows, 6, async (r, idx)=>{
          if (!r?.entry) return;
          try{
            const hist = await api.entryHistory(r.entry);

            // Build arrays through all finished GWs
            const totals = [];
            const perGW  = [];
            for (let gw=1; gw<=lastFinished; gw++){
              const rec = hist.current.find(x=>x.event===gw);
              const prev = totals[totals.length-1] ?? 0;
              totals.push(rec ? rec.total_points : prev);
              perGW.push(rec ? rec.points : 0);
            }
            r.prevTotal = totals[totals.length-1] ?? 0;

            // Add extra GW (live/provisional) from event_live × picks
            if (extraGwId && extraMap){
              let extraPts = 0;
              try{
                const picks = await api.entryPicks(r.entry, extraGwId);
                for (const p of (picks?.picks||[])){
                  const mult = p.multiplier ?? (p.is_captain ? 2 : (p.position<=11 ? 1 : 0));
                  const pts = (extraMap.get(p.element)?.total_points) ?? 0;
                  extraPts += mult * pts;
                }
              }catch{/* ignore individual issues */}

              totals.push((totals[totals.length-1] ?? 0) + extraPts);
              perGW.push(extraPts);
            }

            // What to display in the table
            const gwIndex = totals.length - 1; // corresponds to gwRef
            r.gw = perGW[gwIndex] ?? 0;
            r.total = totals[totals.length-1] ?? 0;
            r.currTotal = r.total;

            // Dataset cosmetics
            const me = r.my;
            const { line, point } = colorFor(idx, me);
            const dsStyle = {
              borderColor: line,
              backgroundColor: "transparent",
              borderWidth: me ? 3 : 2,
              pointRadius: me ? 3 : 2,
              pointHoverRadius: me ? 6 : 5,
              pointHitRadius: 6,
              pointBackgroundColor: point,
              pointBorderColor: point,
              spanGaps: true,
              tension: 0.3
            };

            datasetsTotal.push({ label: `${r.manager} — ${r.team}`, data: totals, ...dsStyle });
            datasetsGW.push({    label: `${r.manager} — ${r.team}`, data: perGW,  ...dsStyle });

            await utils.sleep(20);
          }catch{/* keep row even if charts missing */}
        });

        // Rank movement (prev vs current)
        const prevSorted = rows.slice().sort((a,b)=> (b.prevTotal??0) - (a.prevTotal??0));
        const currSorted = rows.slice().sort((a,b)=> (b.currTotal??0) - (a.currTotal??0));
        const setRanks = (arr, key) => {
          let rank = 1, lastVal = null;
          arr.forEach((r,i)=>{
            const v = r[key] ?? 0;
            if (lastVal !== null && v === lastVal) {
              // tie keeps same rank
            } else {
              rank = i + 1;
              lastVal = v;
            }
            r[key === "prevTotal" ? "prevRank" : "currRank"] = rank;
          });
        };
        setRanks(prevSorted, "prevTotal");
        setRanks(currSorted, "currTotal");
        rows.forEach(r=>{
          if (r.prevRank!=null && r.currRank!=null) r.mov = r.prevRank - r.currRank; // + up
        });

        // Sort table by cumulative total
        rows.sort((a,b)=> (b.currTotal??0) - (a.currTotal??0));
        rows.forEach((r,i)=> r.currRank = i+1);

        // Manager cell
        const managerCell = (r)=>{
          const wrap = utils.el("div",{class:"name-cell"});
          const name = utils.el("span",{class:"nm"}, r.manager);
          wrap.append(name);
          if (r.my){
            wrap.append(utils.el("span",{class:"chip chip-accent chip-dim", style:"margin-left:6px"},"You"));
          }
          if (typeof r.mov === "number" && (isLive || isProvisional || r.mov !== 0)){
            const good = r.mov > 0, bad = r.mov < 0;
            const badge = utils.el("span",{
              class:"chip",
              style:`margin-left:6px; ${good?"background:var(--accent-faded)":""}; ${bad?"background:var(--error-faded)":""}`
            }, `${r.mov>0?"▲":r.mov<0?"▼":"•"} ${r.mov===0?"0":Math.abs(r.mov)}`);
            wrap.append(badge);
          }
          return wrap;
        };

        const gwHdr = `GW${gwRef}${isLive ? " (live)" : (isProvisional ? " (prov)" : "")}`;

        const table = ui.table([
          {header:"#", accessor:r=>r.currRank, sortBy:r=>r.currRank},
          {header:"Manager", cell:managerCell, sortBy:r=>r.manager},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:gwHdr, accessor:r=>r.gw ?? 0, sortBy:r=>r.gw ?? -1,
            tdClass:r=> (r.gw>=80?"points-high":(r.gw<=10?"points-low":""))},
          {header:"Total", accessor:r=>r.currTotal ?? 0, sortBy:r=>r.currTotal ?? -1}
        ], rows);

        // Charts
        const canvasTotal = utils.el("canvas");
        const canvasGW    = utils.el("canvas");

        const commonOpts = {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "nearest", intersect: true },
          hover:       { mode: "nearest", intersect: true },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
            tooltip: {
              mode: "nearest",
              intersect: true,
              callbacks: {
                title: (items) => items?.[0]?.dataset?.label || "",
                label: (ctx) => {
                  const lbl = ctx.chart.data.labels[ctx.dataIndex] || `GW${ctx.dataIndex+1}`;
                  const val = ctx.parsed.y;
                  return `${lbl}: ${val ?? "—"} pts`;
                }
              }
            }
          },
          elements: {
            point: { radius: 2, hoverRadius: 6, hitRadius: 6 },
            line:  { borderWidth: 2 }
          },
          scales: {
            x: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
            y: { beginAtZero: true, suggestedMin: 0 }
          }
        };

        const yMaxTotal = Math.max(0, ...datasetsTotal.flatMap(d => (d.data||[]).filter(Number.isFinite)));
        const yMaxGW    = Math.max(0, ...datasetsGW.flatMap(d => (d.data||[]).filter(Number.isFinite)));

        const cfgTotal = {
          type:"line",
          data:{ labels, datasets: datasetsTotal },
          options:{
            ...commonOpts,
            scales:{ ...commonOpts.scales,
              y:{ ...commonOpts.scales.y, suggestedMax: Math.ceil((yMaxTotal+5)/10)*10, title:{display:true,text:"Total points"} }
            }
          }
        };
        const cfgGW = {
          type:"line",
          data:{ labels, datasets: datasetsGW },
          options:{
            ...commonOpts,
            scales:{ ...commonOpts.scales,
              y:{ ...commonOpts.scales.y, suggestedMax: Math.max(10, Math.ceil((yMaxGW+5)/5)*5), title:{display:true,text:"GW points"} }
            }
          }
        };

        // League Top XI for same GW
        const xiTitle = `League Top XI (most picked — GW${gwRef}${isLive?" live":(isProvisional?" provisional":"")})`;
        const xiBox = utils.el("div",{class:"card"});
        xiBox.append(utils.el("h4",{}, xiTitle), ui.spinner("Building XI…"));

        const counts = new Map(); // element_id -> count
        const caps   = new Map(); // element_id -> captain votes
        await poolMap(rows, 6, async (r)=>{
          try{
            const picks = await api.entryPicks(r.entry, gwRef);
            for (const p of (picks?.picks||[])){
              counts.set(p.element, (counts.get(p.element)||0) + 1);
              if (p.is_captain) caps.set(p.element, (caps.get(p.element)||0) + 1);
            }
            await utils.sleep(20);
          }catch{/* ignore */}
        });

        const bucket = (posId)=>
          [...counts.entries()]
            .map(([id,ct])=>{
              const pl = byPlayerId.get(id);
              return pl ? {
                id, ct,
                cap: caps.get(id)||0,
                name: pl.web_name,
                pos: posShort.get(pl.element_type)||"?",
                team: teamShort.get(pl.team)||"?",
                price: (pl.now_cost/10).toFixed(1)
              } : null;
            })
            .filter(Boolean)
            .filter(x => (byPlayerId.get(x.id)?.element_type) === posId)
            .sort((a,b)=> b.ct - a.ct || b.cap - a.cap);

        const GK  = bucket(1), DEF = bucket(2), MID = bucket(3), FWD = bucket(4);
        const pickN = (arr,n)=> arr.slice(0, Math.max(0,n));
        const xi = [...pickN(GK,1), ...pickN(DEF,3), ...pickN(MID,4), ...pickN(FWD,3)];

        const xiTable = ui.table([
          {header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos},
          {header:"Player", accessor:r=>r.name, sortBy:r=>r.name},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:"Picked", accessor:r=>r.ct, cell:r=>`${r.ct}`, sortBy:r=>r.ct},
          {header:"Cap", accessor:r=>r.cap, sortBy:r=>r.cap},
          {header:"£m", accessor:r=>+r.price, cell:r=>`£${r.price}m`, sortBy:r=>+r.price},
        ], xi);

        xiBox.innerHTML = "";
        xiBox.append(utils.el("h4",{}, xiTitle), xiTable);

        // Assemble card with expand/collapse functionality
        card.innerHTML = "";
        card.className = "league-card";

        // Header bar (always visible, clickable)
        const cardHeader = utils.el("div", { class: "league-card-header" });
        const headerLeft = utils.el("div", { class: "league-header-left" });
        headerLeft.append(
          utils.el("h3", {}, leagueName),
          ...headRow.children
        );
        const me = rows.find(r => r.my);
        const headerRight = utils.el("div", { class: "league-header-right" });
        if (me) {
          headerRight.append(utils.el("span", { class: "chip chip-accent" }, `You: #${me.currRank} (${me.currTotal} pts)`));
        }
        const expandBtn = utils.el("button", { class: "league-expand-btn" }, "Expand");
        headerRight.append(expandBtn);
        cardHeader.append(headerLeft, headerRight);

        // Content (collapsible)
        const cardContent = utils.el("div", { class: "league-card-content" });

        // Standings table (compact)
        const standingsSection = utils.el("div", { class: "league-standings" });
        standingsSection.append(table);

        // Charts (hidden by default, shown on expand)
        const chartsSection = utils.el("div", { class: "league-charts collapsed" });
        chartsSection.append(
          utils.el("div", { class: "chart-wrap" }, [
            utils.el("h4", {}, "Cumulative Total"),
            utils.el("div", { class: "chart-container" }, [canvasTotal])
          ]),
          utils.el("div", { class: "chart-wrap" }, [
            utils.el("h4", {}, "GW Points"),
            utils.el("div", { class: "chart-container" }, [canvasGW])
          ])
        );

        // Top XI (compact)
        xiBox.className = "league-xi";

        cardContent.append(standingsSection, chartsSection, xiBox);

        // Toggle expand
        let isExpanded = false;
        expandBtn.addEventListener("click", () => {
          isExpanded = !isExpanded;
          card.classList.toggle("expanded", isExpanded);
          chartsSection.classList.toggle("collapsed", !isExpanded);
          expandBtn.textContent = isExpanded ? "Collapse" : "Expand";
        });

        card.append(cardHeader, cardContent);

        await ui.chart(canvasTotal, cfgTotal);
        await ui.chart(canvasGW, cfgGW);
      }catch(e){
        card.innerHTML = "";
        card.append(
          utils.el("h3",{},`League ${lid}`),
          utils.el("div",{class:"tag"},"Failed to load this league.")
        );
      }
    }
  }catch(err){
    ui.mount(main, ui.error("Failed to load Mini-League", err));
  }
}
