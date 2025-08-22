// js/pages/mini-league.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

export async function renderMiniLeague(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading leagues…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events } = bs;

    const finished = events.filter(e=>e.data_checked);
    const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;

    const leagues = (state.leagueIds && state.leagueIds.length) ? state.leagueIds : [];
    if (!leagues.length){
      ui.mount(main, utils.el("div",{class:"card"},"Add at least one Classic League ID in the sidebar (comma-separated)."));
      return;
    }

    // simple promise pool to avoid hammering the API
    async function poolMap(items, limit, worker){
      const ret = new Array(items.length);
      let i = 0;
      const run = async ()=>{
        while (i < items.length){
          const idx = i++;
          try{ ret[idx] = await worker(items[idx], idx); }
          catch(e){ ret[idx] = null; }
        }
      };
      await Promise.all(Array.from({length:limit}, run));
      return ret;
    }

    const deck = utils.el("div");
    for (const lid of leagues){
      const card = utils.el("div",{class:"card"});
      card.append(utils.el("h3",{},`League ${lid}`), ui.spinner("Loading…"));
      deck.append(card);

      try{
        const data = await api.leagueClassic(lid, 1);
        const results = data?.standings?.results || [];

        const rows = results.map(r=>({
          rank: r.rank,
          manager: r.player_name || "—",
          team: r.entry_name || "—",
          gw: r.event_total ?? null,
          total: r.total ?? null,
          entry: r.entry
        }));

        const table = ui.table([
          {header:"#", accessor:r=>r.rank, sortBy:r=>r.rank},
          {header:"Manager", accessor:r=>r.manager, sortBy:r=>r.manager},
          {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
          {header:`GW${lastFinished || "—"}`, accessor:r=>r.gw, sortBy:r=>r.gw},
          {header:"Total", accessor:r=>r.total, sortBy:r=>r.total},
        ], rows);

        const canvas = utils.el("canvas");

        // Build datasets for ALL entries (throttled, 6 concurrent)
        const datasets = [];
        const labelCount = lastFinished || 0;
        const labels = Array.from({length:labelCount}, (_,i)=>`GW${i+1}`);

        await poolMap(rows, 6, async (r)=>{
          try{
            const h = await api.entryHistory(r.entry);
            const ptsByGw = h.current
              .filter(x=> labelCount ? x.event<=labelCount : true)
              .map(x=>x.total_points);
            datasets.push({ label: `${r.manager} — ${r.team}`, data: ptsByGw });
            await utils.sleep(60);
          }catch{/* ignore */}
        });

        const cfg = {
          type:"line",
          data:{ labels, datasets },
          options:{
            animation:false,
            plugins:{
              legend:{position:"bottom"},
              tooltip:{
                callbacks:{
                  title:(items)=> items?.[0]?.dataset?.label || "",
                }
              }
            },
            scales:{ y:{ title:{display:true,text:"Total Points"}, beginAtZero:true } }
          }
        };

        card.innerHTML="";
        card.append(
          utils.el("h3",{},`${data?.league?.name || "League"} (ID ${lid})`),
          table,
          utils.el("div",{style:"height:10px"}),
          canvas
        );
        await ui.chart(canvas, cfg);
      }catch(e){
        card.innerHTML="";
        card.append(utils.el("h3",{},`League ${lid}`), utils.el("div",{class:"tag"},"Failed to load league."));
      }
    }

    ui.mount(main, deck);
  }catch(err){
    ui.mount(main, ui.error("Failed to load Mini-League", err));
  }
}
