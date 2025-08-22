// js/pages/gw-explorer.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

export async function renderGwExplorer(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading GW Explorer…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;
    const byId = new Map(players.map(p=>[p.id,p]));
    const teamShort = new Map(teams.map(t=>[t.id,t.short_name]));
    const posShort = new Map(positions.map(p=>[p.id,p.singular_name_short]));

    const finished = events.filter(e=>e.data_checked);
    if (!finished.length){
      ui.mount(main, utils.el("div",{class:"card"},"No finished GWs yet."));
      return;
    }
    const sel = utils.el("select");
    finished.forEach(e=> sel.append(new Option(`GW ${e.id}`, e.id)));
    sel.value = String(Math.max(...finished.map(e=>e.id)));

    const btn = utils.el("button",{class:"btn-primary"},"Load");
    const controls = utils.el("div",{class:"controls"},[sel, btn]);

    const card = utils.el("div",{class:"card"});
    card.append(utils.el("h3",{},"Gameweek Breakdown"));

    ui.mount(main, utils.el("div",{},[
      utils.el("div",{class:"card"},[utils.el("h3",{},"GW Explorer"), controls]),
      card
    ]));

    async function load(){
      card.innerHTML = "";
      card.append(utils.el("h3",{},`GW ${sel.value} — Player Points`), ui.spinner("Fetching…"));
      const live = await api.eventLive(+sel.value);
      const rows = live.elements.map(e=>{
        const pl = byId.get(e.id);
        const st = e.stats || {};
        return {
          name: pl?.web_name || `#${e.id}`,
          team: teamShort.get(pl?.team) || "?",
          pos: posShort.get(pl?.element_type) || "?",
          minutes: st.minutes||0,
          pts: st.total_points||0,
          g: st.goals_scored||0,
          a: st.assists||0,
          cs: st.clean_sheets||0,
          ps: st.penalties_saved||0,
          pm: st.penalties_missed||0,
          saves: st.saves||0,
          gc: st.goals_conceded||0,
          yc: st.yellow_cards||0,
          rc: st.red_cards||0,
          bonus: st.bonus||0,
          bps: st.bps||0
        };
      });

      const cols = [
        {header:"Name", accessor:r=>r.name, sortBy:r=>r.name},
        {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
        {header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos},
        {header:"Min", accessor:r=>r.minutes, sortBy:r=>r.minutes,
          tdClass:r=> r.minutes===0 ? "cell-bad" : "" },
        {header:"Pts", accessor:r=>r.pts, sortBy:r=>r.pts,
          tdClass:r=> r.pts>=10 ? "cell-good" : (r.pts<=1 ? "cell-bad" : "") },
        {header:"G", accessor:r=>r.g, sortBy:r=>r.g},
        {header:"A", accessor:r=>r.a, sortBy:r=>r.a},
        {header:utils.abbr("CS","Clean sheets"), accessor:r=>r.cs, sortBy:r=>r.cs},
        {header:utils.abbr("Pens +","Penalties saved"), accessor:r=>r.ps, sortBy:r=>r.ps},
        {header:utils.abbr("Pens -","Penalties missed"), accessor:r=>r.pm, sortBy:r=>r.pm},
        {header:"Saves", accessor:r=>r.saves, sortBy:r=>r.saves},
        {header:utils.abbr("GC","Goals conceded"), accessor:r=>r.gc, sortBy:r=>r.gc},
        {header:utils.abbr("YC","Yellow cards"), accessor:r=>r.yc, sortBy:r=>r.yc},
        {header:utils.abbr("RC","Red cards"), accessor:r=>r.rc, sortBy:r=>r.rc},
        {header:"Bonus", accessor:r=>r.bonus, sortBy:r=>r.bonus,
          tdClass:r=> r.bonus>0 ? "cell-good" : "" },
        {header:utils.abbr("BPS","Bonus Point System"), accessor:r=>r.bps, sortBy:r=>r.bps},
      ];
      const table = ui.table(cols, rows);

      card.innerHTML = "";
      card.append(utils.el("h3",{},`GW ${sel.value} — Player Points`), table);
    }

    btn.addEventListener("click", load);
    load();
  }catch(e){
    ui.mount(main, ui.error("Failed to load GW Explorer", e));
  }
}
