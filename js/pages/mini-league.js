// js/pages/mini-league.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

/**
 * Mini-League (live-aware + deltas + my-team highlight)
 * - Standings (page 1 of each classic league)
 *   • GW column = current live GW if applicable
 *   • Manager cell shows rank movement badge vs last finished GW
 *   • "You" chip if your entry is present
 * - Charts (x2): totals & per-GW, include live point,
 *   very translucent lines, visible hoverable points, double height
 * - League Top XI: most-picked 3-4-3 in current GW if live, else last finished
 */

export async function renderMiniLeague(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading leagues…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;

    // GW markers
    const prevEvent = events.find(e=>e.is_previous) || null;
    const currEvent = events.find(e=>e.is_current)  || null;
    const lastFinished = prevEvent?.id || (events.filter(e=>e.data_checked).map(e=>e.id).pop() ?? 0);
    const liveNow = !!(currEvent && !currEvent.data_checked);
    const gwLiveId = currEvent?.id || null;

    if (!lastFinished && !liveNow){
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
    const teamShort   = new Map(teams.map(t=>[t.id,t.short_name]));
    const posShort    = new Map(positions.map(p=>[p.id,p.singular_name_short]));

    function safeManager(r){
      return r.player_name || (r.player_first_name || r.player_last_name
        ? `${r.player_first_name||""} ${r.player_last_name||""}`.trim()
        : "—");
    }

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

    // Preload live map once if needed
    let liveMap = null; // Map<elementId, stats>
    if (liveNow && gwLiveId){
      try{
        const live = await api.eventLive(gwLiveId);
        liveMap = new Map((live?.elements||[]).map(e=>[e.id, e.stats||{}]));
      }catch{ liveMap = new Map(); }
    }

    // Color generator: very translucent lines + stronger points
    const colorFor = (i, strong=false)=>{
      const hue = (i * 137.508) % 360; // golden angle
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
        liveNow ? utils.el("span",{class:"chip chip-accent"}, `LIVE — GW${gwLiveId}`) : utils.el("span",{class:"chip"}, `Last finished: GW${lastFinished}`)
      ]);
      card.append(utils.el("h3",{},`League ${lid}`), headRow, ui.spinner("Loading…"));
      deck.append(card);

      try{
        const data = await api.leagueClassic(lid, 1);
        const leagueName = data?.league?.name || `League ${lid}`;
        const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];

        // ---- build rows skeleton from league table
        const rows = results.map(r=>({
          rank: r.rank,
          manager: safeManager(r),
          team: r.entry_name || "—",
          gw: r.event_total ?? null,   // will override with live if liveNow
          total: r.total ?? null,      // will override with live cumulative if liveNow
          entry: r.entry,
          my: (state.entryId && Number(state.entryId) === Number(r.entry)) || false,
          prevTotal: null,
          currTotal: null,
          prevRank: null,
          currRank: null,
          mov: null
        }));

        // ---- per-entry history + live gw points (if live)
        const labelsFinished = Array.from({length:lastFinished}, (_,i)=>`GW${i+1}`);
        const labels = liveNow && gwLiveId
          ? [...labelsFinished, `GW${gwLiveId} (live)`]
          : labelsFinished;

        const datasetsTotal = [];
        const datasetsGW = [];

        await poolMap(rows, 6, async (r, idx)=>{
          if (!r?.entry) return;
          try{
            const hist = await api.entryHistory(r.entry);

            // Cumulative up to last finished
            let totals = [];
            let perGW  = [];
            for (let gw=1; gw<=lastFinished; gw++){
              const rec = hist.current.find(x=>x.event===gw);
              const prev = totals[totals.length-1] ?? 0;
              totals.push(rec ? rec.total_points : prev);
              perGW.push(rec ? rec.points : 0);
            }

            r.prevTotal = totals[totals.length-1] ?? 0;

            // Live GW points (approx) via picks × live stats
            let livePts = 0;
            if (liveNow && gwLiveId && liveMap){
              try{
                const picks = await api.entryPicks(r.entry, gwLiveId);
                for (const p of (picks?.picks||[])){
                  const mult = p.multiplier ?? (p.is_captain ? 2 : (p.position<=11 ? 1 : 0));
                  const pts = (liveMap.get(p.element)?.total_points) ?? 0;
                  livePts += mult * pts;
                }
              }catch{/* ignore single entry */}
            }

            if (liveNow && gwLiveId){
              totals.push((totals[totals.length-1] ?? 0) + livePts);
              perGW.push(livePts);
              r.gw = livePts;
              r.total = totals[totals.length-1];
              r.currTotal = r.total;
            }else{
              const lastRec = hist.current.find(x=>x.event===lastFinished);
              r.gw = lastRec?.points ?? r.gw ?? 0;
              r.total = lastRec?.total_points ?? r.total ?? 0;
              r.currTotal = r.total;
            }

            const me = r.my;
            const { line, point } = colorFor(idx, me);
            const dsStyle = {
              borderColor: line,
              backgroundColor: "transparent",
              borderWidth: me ? 3 : 2,
              pointRadius: me ? 3 : 2,           // <-- visible orbs
              pointHoverRadius: me ? 6 : 5,      // nicer on hover
              pointHitRadius: 6,
              pointBackgroundColor: point,       // stronger than line
              pointBorderColor: point,
              spanGaps: true,
              tension: 0.3
            };

            datasetsTotal.push({ label: `${r.manager} — ${r.team}`, data: totals, ...dsStyle });
            datasetsGW.push({    label: `${r.manager} — ${r.team}`, data: perGW,  ...dsStyle });

            await utils.sleep(40);
          }catch{/* keep row even if charts missing */}
        });

        // ---- compute rank movement within this page (prev vs current)
        const prevSorted = rows.slice().sort((a,b)=> (b.prevTotal??0) - (a.prevTotal??0));
        const currSorted = rows.slice().sort((a,b)=> (b.currTotal??0) - (a.currTotal??0));
        const setRanks = (arr, key) => {
          let rank = 1, lastVal = null, sameRankCount = 0;
          arr.forEach((r,i)=>{
            const v = r[key] ?? 0;
            if (lastVal !== null && v === lastVal) {
              sameRankCount++;
            } else {
              rank = i + 1;
              sameRankCount = 0;
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

        // ---- UI: standings table
        const gwHdr = liveNow && gwLiveId ? `GW${gwLiveId} (live)` : `GW${lastFinished}`;

        function managerCell(r){
          const wrap = utils.el("div",{class:"name-cell"});
          const name = utils.el("span",{class:"nm"}, r.manager);
          wrap.append(name);
          if (r.my){
            wrap.append(utils.el("span",{class:"chip chip-accent chip-dim", style:"margin-left:6px"},"You"));
          }
          if (typeof r.mov === "number" && (liveNow || r.mov !== 0)){
            const good = r.mov > 0, bad = r.mov < 0;
            const badge = utils.el("span",{
              class:"chip",
              style:`margin-left:6px; ${good?"background:var(--accent-faded)":""
                    }; ${bad?"background:var(--error-faded)":""}`
            }, `${r.mov>0?"▲":r.mov<0?"▼":"•"} ${r.mov===0?"0":Math.abs(r.mov)}`);
            wrap.append(badge);
          }
          return wrap;
        }

        const table = ui.table([
          {header:"#", accessor:r=>r.currRank ?? r.rank, sortBy:r=>r.currRank ?? r.rank},
          {header:"Manager", cell:managerCell, sortBy:r=>r.manager},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:gwHdr, accessor:r=>r.gw ?? 0, sortBy:r=>r.gw ?? -1,
            tdClass:r=> (r.gw>=80?"points-high":(r.gw<=10?"points-low":""))},
          {header:"Total" + (liveNow?" (live)":""),
            accessor:r=>r.currTotal ?? r.total ?? 0, sortBy:r=>r.currTotal ?? r.total ?? -1}
        ], rows);

        // ---- charts
        const canvasTotal = utils.el("canvas");
        const canvasGW    = utils.el("canvas");

        const commonOpts = {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
        
          // <-- THIS makes tooltips single-point
          interaction: { mode: "nearest", intersect: true },   // pick just the nearest element
          hover:       { mode: "nearest", intersect: true },   // (redundant but safe)
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
            tooltip: {
              mode: "nearest",
              intersect: true,                                  // <-- important
              callbacks: {
                title: (items) => items?.[0]?.dataset?.label || "",
                label: (ctx) => {
                  const lbl = (liveNow && ctx.dataIndex === ctx.chart.data.labels.length - 1)
                    ? `${ctx.chart.data.labels[ctx.dataIndex]}`
                    : `GW${ctx.dataIndex + 1}`;
                  const val = ctx.parsed.y;
                  return `${lbl}: ${val ?? "—"} pts`;
                }
              }
            }
          },
        
          // keep orbs visible and easy to hit
          elements: {
            point: { radius: 2, hoverRadius: 6, hitRadius: 6 },
            line:  { borderWidth: 2 }
          },
        
          scales: {
            x: { title: { display: false }, ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
            y: { beginAtZero: true, suggestedMin: 0 }
          }
        };
        

        // y-axis bounds
        const yMaxTotal = Math.max(0, ...datasetsTotal.flatMap(d => (d.data||[]).filter(v=>Number.isFinite(v))));
        const yMaxGW = Math.max(0, ...datasetsGW.flatMap(d => (d.data||[]).filter(v=>Number.isFinite(v))));

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

        // ---- League Top XI (most picked)
        const gwForXI = (liveNow && gwLiveId) ? gwLiveId : lastFinished;
        const xiTitle = (liveNow && gwLiveId)
          ? `League Top XI (most picked — GW${gwLiveId} live)`
          : `League Top XI (most picked — GW${lastFinished})`;

        const xiBox = utils.el("div",{class:"card"});
        xiBox.append(utils.el("h4",{}, xiTitle), ui.spinner("Building XI…"));

        // count picks across managers
        const counts = new Map(); // element_id -> count
        const caps   = new Map(); // element_id -> captain votes
        await poolMap(rows, 6, async (r)=>{
          try{
            const picks = await api.entryPicks(r.entry, gwForXI);
            for (const p of (picks?.picks||[])){
              counts.set(p.element, (counts.get(p.element)||0) + 1);
              if (p.is_captain) caps.set(p.element, (caps.get(p.element)||0) + 1);
            }
            await utils.sleep(40);
          }catch{/* ignore */}
        });

        function bucket(posId){
          return [...counts.entries()]
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
        }
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

        // ---- assemble card (double-height charts)
        card.innerHTML = "";
        card.append(
          utils.el("h3",{},`${leagueName}`),
          headRow,
          (()=>{
            const me = rows.find(r=>r.my);
            return me ? utils.el("div",{class:"chips", style:"margin:6px 0"},[
              utils.el("span",{class:"chip chip-accent"}, `You: ${me.manager} — ${me.team} (rank ${me.currRank})`)
            ]) : utils.el("div")
          })(),
          table,
          utils.el("div",{class:"grid cols-2", style:"margin-top:12px; min-height:640px;"},
            [
              utils.el("div",{class:"card"},[
                utils.el("h4",{},"Cumulative total points by GW"),
                utils.el("div",{style:"height:600px;margin-top:8px;"}, [canvasTotal])
              ]),
              utils.el("div",{class:"card"},[
                utils.el("h4",{},"GW points by GW"),
                utils.el("div",{style:"height:600px;margin-top:8px;"}, [canvasGW])
              ])
            ]
          ),
          utils.el("div",{style:"height:10px"}),
          xiBox
        );

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
