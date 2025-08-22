// js/pages/my-team.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";

export async function renderMyTeam(main){
  if (!state.entryId) {
    ui.mount(main, utils.el("div",{class:"card"}, "Enter your Entry ID to see your team."));
    return;
  }
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading team…"));
  ui.mount(main, wrap);

  const bs = state.bootstrap || await api.bootstrap();
  state.bootstrap = bs;

  const events = bs.events;
  const players = bs.elements;
  const teams = bs.teams;
  const positions = bs.element_types;

  const lastFinished = (()=>{
    const f = events.filter(e=>e.data_checked);
    return f.length? Math.max(...f.map(e=>e.id)) : null;
  })();

  if (!lastFinished){
    ui.mount(main, utils.el("div",{class:"card"},"No finished gameweeks yet."));
    return;
  }

  const [profile, hist, picks, live] = await Promise.all([
    api.entry(state.entryId),
    api.entryHistory(state.entryId),
    api.entryPicks(state.entryId, lastFinished),
    api.eventLive(lastFinished)
  ]);

  const thisGwHist = hist.current.find(h => h.event === lastFinished);
  const teamVal = thisGwHist ? (thisGwHist.value/10).toFixed(1) : "—";
  const bank = thisGwHist ? (thisGwHist.bank/10).toFixed(1) : "—";

  const header = utils.el("div",{class:"grid cols-4"});
  header.append(
    ui.metric("Manager", `${profile.player_first_name} ${profile.player_last_name}`),
    ui.metric("Team", profile.name),
    ui.metric("Team Value", `£${teamVal}m`),
    ui.metric("Bank", `£${bank}m`)
  );

  const liveMap = new Map(live.elements.map(e => [e.id, e.stats]));
  const byId = new Map(players.map(p => [p.id, p]));

  const rows = picks.picks.map(p => {
    const pl = byId.get(p.element);
    const stats = liveMap.get(pl.id) || {};
    const team = teams.find(t=>t.id===pl.team);
    const pos = positions.find(pt=>pt.id===pl.element_type);
    return {
      id: pl.id,
      name: pl.web_name,
      team: team.short_name,
      pos: pos.singular_name_short,
      price: +(pl.now_cost/10).toFixed(1),
      sel: +Number(pl.selected_by_percent).toFixed(1),
      status: pl.status,
      news: pl.news || "",
      cap: p.is_captain ? "C" : (p.is_vice_captain ? "VC" : ""),
      points: stats.total_points ?? 0,
      minutes: stats.minutes ?? 0,
      breakdown: stats
    };
  });

  const flags = rows.filter(r => r.status !== "a");
  const extras = utils.el("div",{class:"grid cols-2"});
  extras.append(utils.el("div",{class:"card"}, [
    utils.el("h3",{},"Injury / Availability"),
    flags.length ? utils.el("ul",{}, flags.map(f=>{
      const li = utils.el("li");
      li.innerHTML = `<span class="status-${f.status}">●</span> ${f.name} — ${f.news||"No news"}`;
      return li;
    })) : utils.el("div",{class:"tag"},"All selected players available")
  ]));

  const cols = [
    { header:"", cell:r=>{
      if (r.cap==="C") return utils.el("span",{class:"badge c-badge"},"C");
      if (r.cap==="VC") return utils.el("span",{class:"badge vc-badge"},"VC");
      return "";
    }},
    { header:"Name", accessor:r=>r.name, sortBy:r=>r.name },
    { header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos },
    { header:"Team", accessor:r=>r.team, sortBy:r=>r.team },
    { header:"Price", accessor:r=>r.price, cell:r=>`£${r.price.toFixed(1)}m`, sortBy:r=>r.price },
    { header:"Own%", accessor:r=>r.sel, cell:r=>`${r.sel.toFixed(1)}%`, sortBy:r=>r.sel },
    { header:`GW${lastFinished} Pts`,
      accessor:r=>r.points,
      sortBy:r=>r.points,
      tdClass:r=>{
        if (r.points >= 10) return "points-high";
        if (r.points === 0) return "points-low";
        return "";
      }
    },
    { header:"Min",
      accessor:r=>r.minutes,
      sortBy:r=>r.minutes,
      tdClass:r=> r.minutes===0 ? "minutes-zero" : ""
    },
    { header:"Status", accessor:r=>r.status, cell:r=> utils.el("span",{class:`status-${r.status}`}, r.status.toUpperCase()) },
    { header:"Details", cell:r=>{
      const btn = utils.el("button",{class:"btn-ghost"},"Breakdown");
      btn.addEventListener("click",()=>{
        const st = r.breakdown;
        const box = utils.el("div");
        box.append(utils.el("div",{}, `${r.name} (${r.team}, ${r.pos})`));
        box.append(utils.el("div",{}, `GW points: ${st.total_points||0}`));
        const tbl = ui.table([
          {header:"Goals", accessor:x=>st.goals_scored||0, sortBy:x=>st.goals_scored||0},
          {header:"Assists", accessor:x=>st.assists||0, sortBy:x=>st.assists||0},
          {header:utils.abbr("CS","Clean sheets"), accessor:x=>st.clean_sheets||0, sortBy:x=>st.clean_sheets||0},
          {header:utils.abbr("Pens +","Penalties saved"), accessor:x=>st.penalties_saved||0, sortBy:x=>st.penalties_saved||0},
          {header:utils.abbr("Pens -","Penalties missed"), accessor:x=>st.penalties_missed||0, sortBy:x=>st.penalties_missed||0},
          {header:"Saves", accessor:x=>st.saves||0, sortBy:x=>st.saves||0},
          {header:utils.abbr("GC","Goals conceded"), accessor:x=>st.goals_conceded||0, sortBy:x=>st.goals_conceded||0},
          {header:utils.abbr("YC","Yellow cards"), accessor:x=>st.yellow_cards||0, sortBy:x=>st.yellow_cards||0},
          {header:utils.abbr("RC","Red cards"), accessor:x=>st.red_cards||0, sortBy:x=>st.red_cards||0},
          {header:"Bonus", accessor:x=>st.bonus||0, sortBy:x=>st.bonus||0},
          {header:utils.abbr("BPS","Bonus Point System"), accessor:x=>st.bps||0, sortBy:x=>st.bps||0}
        ], [{}]);
        box.append(tbl);
        openModal(`Breakdown — ${r.name}`, box);
      });
      return btn;
    }},
  ];

  const table = ui.table(cols, rows);

  ui.mount(main, utils.el("div",{}, [
    utils.el("div",{class:"card"},[utils.el("h3",{},"Overview"), header]),
    extras,
    utils.el("div",{class:"card"},[utils.el("h3",{},`Your Squad — GW${lastFinished}`), table])
  ]));
}
