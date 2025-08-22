// js/pages/mini-league.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

/**
 * Mini-League
 * - Table of standings (page 1 of each classic league you added)
 * - Line chart: cumulative TOTAL points by GW (0 → max)
 * - Line chart: GW POINTS by GW (0 → max)
 * - League Top XI (most-picked 3-4-3 from that league for last finished GW)
 *
 * Notes:
 * - We keep requests polite via a small concurrency pool.
 * - Tooltips show: Manager — Team
 * - Works with multiple league IDs (comma in sidebar)
 */

export async function renderMiniLeague(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading leagues…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;

    const finished = events.filter(e=>e.data_checked);
    const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;
    if (!lastFinished){
      ui.mount(main, utils.el("div",{class:"card"},"No finished Gameweeks yet."));
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
      // FPL returns player_name (preferred); fall back to "First Last" if available later, else "—"
      return r.player_name || r.player_first_name && r.player_last_name
        ? `${r.player_first_name||""} ${r.player_last_name||""}`.trim()
        : "—";
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

    // UI container for all leagues
    const deck = utils.el("div");
    wrap.innerHTML = "";
    wrap.append(deck);
    ui.mount(main, wrap);

    for (const lid of leagues){
      const card = utils.el("div",{class:"card"});
      card.append(utils.el("h3",{},`League ${lid}`), ui.spinner("Loading…"));
      deck.append(card);

      try{
        const data = await api.leagueClassic(lid, 1);
        const leagueName = data?.league?.name || `League ${lid}`;
        const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];

        // --------- table rows
        const rows = results.map(r=>({
          rank: r.rank,
          manager: safeManager(r),
          team: r.entry_name || "—",
          gw: r.event_total ?? null,
          total: r.total ?? null,
          entry: r.entry
        }));

        // --------- charts datasets: build history for each entry (cumulative + per-GW)
        const labels = Array.from({length:lastFinished}, (_,i)=>`GW${i+1}`);
        const datasetsTotal = [];
        const datasetsGW = [];

        await poolMap(rows, 6, async (r)=>{
          if (!r?.entry) return;
          try{
            const h = await api.entryHistory(r.entry);
            // total_points is cumulative after each GW; points is per GW
            const totals = [];
            const perGW  = [];
            for (let gw=1; gw<=lastFinished; gw++){
              const rec = h.current.find(x=>x.event===gw);
              totals.push(rec ? rec.total_points : (totals[totals.length-1] ?? null));
              perGW.push(rec ? rec.points : null);
            }
            datasetsTotal.push({
              label: `${r.manager} — ${r.team}`,
              data: totals
            });
            datasetsGW.push({
              label: `${r.manager} — ${r.team}`,
              data: perGW
            });
            await utils.sleep(40);
          }catch{/* ignore single manager failure */}
        });

        // y-axis bounds 0 → max
        const yMaxTotal = Math.max(
          0,
          ...datasetsTotal.flatMap(d => (d.data||[]).filter(v=>Number.isFinite(v)))
        );
        const yMaxGW = Math.max(
          0,
          ...datasetsGW.flatMap(d => (d.data||[]).filter(v=>Number.isFinite(v)))
        );

        // --------- render UI
        const table = ui.table([
          {header:"#", accessor:r=>r.rank, sortBy:r=>r.rank},
          {header:"Manager", accessor:r=>r.manager, sortBy:r=>r.manager},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:`GW${lastFinished}`, accessor:r=>r.gw, sortBy:r=>r.gw},
          {header:"Total", accessor:r=>r.total, sortBy:r=>r.total}
        ], rows);

        // charts
        const canvasTotal = utils.el("canvas");
        const canvasGW    = utils.el("canvas");

        const commonOpts = {
          animation:false,
          responsive:true,
          maintainAspectRatio:false,
          plugins:{
            legend:{ position:"bottom", labels:{ boxWidth:10, boxHeight:10 } },
            tooltip:{
              callbacks:{
                // Title shows the manager — team
                title:(items)=> items?.[0]?.dataset?.label || "",
                // Label shows "GWx: y pts"
                label:(ctx)=>{
                  const gwIndex = ctx.dataIndex + 1;
                  const val = ctx.parsed.y;
                  return `GW${gwIndex}: ${val ?? "—"} pts`;
                }
              }
            }
          },
          scales:{
            x:{ title:{display:false} },
            y:{ beginAtZero:true, suggestedMin:0 }
          }
        };

        const cfgTotal = {
          type:"line",
          data:{ labels, datasets: datasetsTotal },
          options:{
            ...commonOpts,
            scales:{ ...commonOpts.scales, y:{ ...commonOpts.scales.y, suggestedMax: Math.ceil((yMaxTotal+5)/10)*10, title:{display:true,text:"Total points"} } }
          }
        };
        const cfgGW = {
          type:"line",
          data:{ labels, datasets: datasetsGW },
          options:{
            ...commonOpts,
            scales:{ ...commonOpts.scales, y:{ ...commonOpts.scales.y, suggestedMax: Math.max(10, Math.ceil((yMaxGW+5)/5)*5), title:{display:true,text:"GW points"} } }
          }
        };

        // --------- League Top XI (most-picked, 3-4-3)
        const xiBox = utils.el("div",{class:"card"});
        xiBox.append(utils.el("h4",{},"League Top XI (most picked — last finished GW)"), ui.spinner("Building XI…"));

        // get all picks for page-1 managers (concurrent, polite)
        const counts = new Map(); // element_id -> count
        const caps   = new Map(); // element_id -> captain votes
        await poolMap(rows, 6, async (r)=>{
          try{
            const picks = await api.entryPicks(r.entry, lastFinished);
            for (const p of (picks?.picks||[])){
              counts.set(p.element, (counts.get(p.element)||0) + 1);
              if (p.is_captain) caps.set(p.element, (caps.get(p.element)||0) + 1);
            }
            await utils.sleep(40);
          }catch{/* ignore */}
        });

        // turn into arrays by position
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
        const GK  = bucket(1);
        const DEF = bucket(2);
        const MID = bucket(3);
        const FWD = bucket(4);

        const pickN = (arr,n)=> arr.slice(0, Math.max(0,n));
        const xi = [
          ...pickN(GK,1),
          ...pickN(DEF,3),
          ...pickN(MID,4),
          ...pickN(FWD,3),
        ];

        const xiTable = ui.table([
          {header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos},
          {header:"Player", accessor:r=>r.name, sortBy:r=>r.name},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:"Picked", accessor:r=>r.ct, cell:r=>`${r.ct}`, sortBy:r=>r.ct},
          {header:"Cap", accessor:r=>r.cap, sortBy:r=>r.cap},
          {header:"£m", accessor:r=>+r.price, cell:r=>`£${r.price}m`, sortBy:r=>+r.price},
        ], xi);

        xiBox.innerHTML = "";
        xiBox.append(utils.el("h4",{},"League Top XI (3-4-3, by pick count)"), xiTable);

        // assemble card
        card.innerHTML = "";
        card.append(
          utils.el("h3",{},`${leagueName} (ID ${lid})`),
          table,
          utils.el("div",{class:"grid cols-2", style:"margin-top:12px; min-height:360px;"},
            [
              utils.el("div",{class:"card"},[
                utils.el("h4",{},"Cumulative total points by GW"),
                utils.el("div",{style:"height:300px;margin-top:8px;"}, [canvasTotal])
              ]),
              utils.el("div",{class:"card"},[
                utils.el("h4",{},"GW points by GW"),
                utils.el("div",{style:"height:300px;margin-top:8px;"}, [canvasGW])
              ])
            ]
          ),
          utils.el("div",{style:"height:10px"}),
          xiBox
        );

        // draw charts
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
