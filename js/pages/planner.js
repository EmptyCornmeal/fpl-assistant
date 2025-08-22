// js/pages/planner.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

/* ---------- small helpers ---------- */
const FORMATIONS = ["3-4-3","3-5-2","4-4-2","4-3-3","5-4-1"];

function parseFormation(f){
  const [d,m,fw] = f.split("-").map(n=>+n);
  return { GKP:1, DEF:d, MID:m, FWD:fw };
}
function badgeXMins(val){
  const b = utils.el("span",{class:"badge"},"—");
  const r90 = (val||0)/90;
  b.textContent = r90>=0.9 ? "NAILED" : (r90>=0.7 ? "RISK" : "CAMEO?");
  b.className = "badge " + (r90>=0.9 ? "badge-green" : (r90>=0.7 ? "badge-amber" : "badge-red"));
  b.dataset.tooltip = `Projected ${Math.round(val||0)}'`;
  return b;
}
function money(n){ return `£${(+n).toFixed(1)}m`; }

/* ---------- page ---------- */

export async function renderPlanner(main){
  const shell = utils.el("div");
  shell.append(ui.spinner("Loading planner…"));
  ui.mount(main, shell);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;

    const { elements: players, teams, element_types: positions, events } = bs;
    const teamById = new Map(teams.map(t=>[t.id,t]));
    const posById  = new Map(positions.map(p=>[p.id,p.singular_name_short]));

    const finished = events.filter(e=>e.data_checked);
    const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;
    const nextGw = Math.max(1, lastFinished + 1);

    if (!state.entryId){
      ui.mount(main, utils.el("div",{class:"card"},"Enter your Entry ID (left sidebar) to use the planner."));
      return;
    }

    const [profile, hist, picks] = await Promise.all([
      api.entry(state.entryId),
      api.entryHistory(state.entryId),
      api.entryPicks(state.entryId, Math.max(1,lastFinished))
    ]);

    const bank0 = (hist.current.find(h=>h.event===lastFinished)?.bank || 0)/10;
    let bank = +bank0.toFixed(1);

    /* ---------- working squad ---------- */
    const byId = new Map(players.map(p=>[p.id,p]));
    const ordered = picks.picks.slice().sort((a,b)=>a.position-b.position);
    const startSet = new Set(ordered.slice(0,11).map(x=>x.element));

    let squad = ordered.map(pk=>{
      const pl = byId.get(pk.element);
      return {
        id: pl.id,
        name: pl.web_name,
        posId: pl.element_type,
        pos: posById.get(pl.element_type) || "?",
        teamId: pl.team,
        team: teamById.get(pl.team)?.short_name || "?",
        price: +(pl.now_cost/10).toFixed(1),
        isStart: startSet.has(pl.id),
        isC: !!pk.is_captain,
        isVC: !!pk.is_vice_captain,
        _xmins: null,
        _xpNext: null,
        _xpWin: null,
        _winLen: null
      };
    });

    let formation = inferFormationFromXI(squad) || "4-3-3";
    let windowLen = 5;

    /* ---------- header ---------- */
    const head = utils.el("div",{class:"card"},[
      utils.el("h3",{},"Transfer Planner"),
      utils.el("div",{class:"chips"},[
        utils.el("span",{class:"chip"},`Manager: ${profile.player_first_name} ${profile.player_last_name}`),
        utils.el("span",{class:"chip chip-accent", id:"bankChip"},`Bank: ${money(bank)}`),
        utils.el("span",{class:"chip"},`Next GW: ${nextGw}`),
        utils.el("span",{class:"chip"},"Window:"),
      ])
    ]);
    const windowSel = utils.el("select");
    windowSel.innerHTML = `
      <option value="1">Next 1</option>
      <option value="3">Next 3</option>
      <option value="5" selected>Next 5</option>
      <option value="8">Next 8</option>`;
    windowSel.addEventListener("change", ()=>{ windowLen = +windowSel.value; recalcBoard(); });

    head.querySelector(".chips").append(windowSel);
    shell.innerHTML = "";
    shell.append(head);

    /* ---------- layout ---------- */
    const grid = utils.el("div",{class:"grid cols-2"});
    const boardCard = utils.el("div",{class:"card"});
    const buildCard = utils.el("div",{class:"card"});
    grid.append(boardCard, buildCard);
    shell.append(grid);

    /* ---------- board ---------- */
    const formationSel = utils.el("select");
    formationSel.innerHTML = FORMATIONS.map(f=>`<option value="${f}" ${f===formation?"selected":""}>${f}</option>`).join("");
    formationSel.addEventListener("change", ()=>{
      formation = formationSel.value;
      enforceFormation();
      recalcBoard();
    });

    const boardHeader = utils.el("div",{},[
      utils.el("h3",{},"Your Squad Board"),
      utils.el("div",{class:"board-controls"},[
        utils.el("div",{},[utils.el("span",{class:"lbl"},"Formation"), formationSel]),
        utils.el("div",{},[utils.el("span",{class:"lbl"},"Window (same as above)"), utils.el("div",{class:"tag"},"Use the header selector")])
      ])
    ]);

    const boardTotals = utils.el("div",{class:"chips"});
    const boardXI = utils.el("div");
    const boardBench = utils.el("div");
    boardCard.append(boardHeader, utils.el("div",{class:"mt-8"},boardTotals), boardXI, utils.el("h4",{class:"mt-8"},"Bench"), boardBench);

    /* ---------- builder ---------- */
    const outSel = utils.el("select");
    const posSel = utils.el("select");
    posSel.innerHTML = `<option value="">Any position</option>`+positions.map(p=>`<option value="${p.id}">${p.singular_name_short}</option>`).join("");
    const search = utils.el("input",{placeholder:"Search name"});
    const maxPrice = utils.el("input",{placeholder:"Max price (£m)", inputmode:"decimal", class:"w90"});
    const nailedChk = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox",checked:true}),
      utils.el("span",{class:"tag"}," Prefer nailed (xMins ≥ 60)")
    ]);

    const scoutBtn = utils.el("button",{class:"btn-primary"},"Suggest");
    const autoBtn  = utils.el("button",{class:"btn-ghost"},"Auto-recommend (1 FT)");
    const clearBtn = utils.el("button",{class:"btn-ghost"},"Reset plan");

    const subhead = utils.el("div",{class:"chips"},[
      utils.el("span",{class:"chip", id:"bankChip2"},`Bank: ${money(bank)}`),
      utils.el("span",{class:"chip"},`Clubs max 3 applies`)
    ]);

    buildCard.append(
      utils.el("h3",{},"Transfer Builder"),
      subhead,
      utils.el("div",{class:"ap-toolbar-row", style:"margin-top:8px"},[
        utils.el("span",{class:"chip chip-dim"},"Out:"), outSel,
        utils.el("span",{class:"chip chip-dim"},"In filters:"), posSel, search, maxPrice, nailedChk,
        scoutBtn, autoBtn, clearBtn
      ])
    );

    const suggestCard = utils.el("div",{class:"card"}, [utils.el("h4",{},"Suggestions")]);
    const recsCard    = utils.el("div",{class:"card"}, [utils.el("h4",{},"Recommendations (Top 3)")]);
    const planCard    = utils.el("div",{class:"card"}, [utils.el("h4",{},"Plan Summary")]);
    buildCard.append(suggestCard, recsCard, planCard);

    /* ---------- utils ---------- */
    function refreshOutSel(){
      outSel.innerHTML = squad
        .map(s=>`<option value="${s.id}">${s.name} — ${s.pos} ${s.team} (${s.isStart?"XI":"Bench"}, ${money(s.price)})</option>`)
        .join("");
    }
    function clubCounts(list){
      const m = new Map();
      list.forEach(p => m.set(p.teamId, (m.get(p.teamId)||0) + 1));
      return m;
    }
    function enforceFormation(){
      const need = parseFormation(formation);
      // bench extras per position
      ["GKP","DEF","MID","FWD"].forEach(k=>{
        const cap = need[k];
        const cur = squad.filter(p=>p.isStart && p.pos===k);
        if (cur.length > cap){
          cur.slice(cap).forEach(p => p.isStart=false);
        }
      });
      // ensure 11 starters if possible
      while (squad.filter(p=>p.isStart).length < 11){
        const pick = squad.find(p=>!p.isStart);
        if (!pick) break;
        const cap = need[pick.pos];
        const cur = squad.filter(x=>x.isStart && x.pos===pick.pos).length;
        if (cur < cap) pick.isStart = true; else break;
      }
    }
    function inferFormationFromXI(list){
      const d = list.filter(p=>p.isStart&&p.pos==="DEF").length;
      const m = list.filter(p=>p.isStart&&p.pos==="MID").length;
      const f = list.filter(p=>p.isStart&&p.pos==="FWD").length;
      const fstr = `${d}-${m}-${f}`;
      return FORMATIONS.includes(fstr) ? fstr : null;
    }

    async function recalcBoard(){
      const wins = events.filter(e=>e.id>=nextGw).slice(0,windowLen).map(e=>e.id);
      for (const s of squad){
        if (s._xpNext == null || s._xpWin == null || s._winLen !== windowLen){
          try{
            const pl = byId.get(s.id);
            s._xmins = await estimateXMinsForPlayer(pl);
            const one = await xPWindow(pl, wins.slice(0,1));
            const win = await xPWindow(pl, wins);
            s._xpNext = one.total;
            s._xpWin  = win.total;
            s._winLen = windowLen;
          }catch{
            s._xmins = 0; s._xpNext = 0; s._xpWin = 0; s._winLen = windowLen;
          }
          await utils.sleep(10);
        }
      }

      const xi = squad.filter(p=>p.isStart);
      const bench = squad.filter(p=>!p.isStart);
      const sum = arr => arr.reduce((a,b)=>a+(b._xpNext||0),0);
      const sumW = arr => arr.reduce((a,b)=>a+(b._xpWin||0),0);

      boardTotals.innerHTML = "";
      boardTotals.append(
        utils.el("span",{class:"chip chip-accent"},`XI xP (Next): ${sum(xi).toFixed(2)}`),
        utils.el("span",{class:"chip"},`XI xP (Next ${windowLen}): ${sumW(xi).toFixed(2)}`),
        utils.el("span",{class:"chip"},`Bench xP (Next): ${sum(bench).toFixed(2)}`)
      );

      const need = parseFormation(formation);
      const xiOf = (k,count) => squad.filter(p=>p.isStart && p.pos===k).slice(0,count);
      const renderRow = (key,label,count)=>{
        const row = utils.el("div",{class:"chips"});
        xiOf(key,count).forEach(p => row.append(playerPill(p,true)));
        while (row.children.length < count) row.append(utils.el("span",{class:"chip chip-dim"},"—"));
        return utils.el("div",{},[utils.el("div",{class:"legend small mb-8"},label), row]);
      };

      boardXI.innerHTML = "";
      boardXI.append(
        renderRow("GKP","Goalkeeper (1)", 1),
        renderRow("DEF",`Defenders (${need.DEF})`, need.DEF),
        renderRow("MID",`Midfielders (${need.MID})`, need.MID),
        renderRow("FWD",`Forwards (${need.FWD})`, need.FWD),
      );

      boardBench.innerHTML = "";
      const benchRow = utils.el("div",{class:"chips"});
      bench.forEach(p => benchRow.append(playerPill(p,false)));
      boardBench.append(benchRow);

      refreshOutSel();
      const bankChip = document.getElementById("bankChip");
      if (bankChip) bankChip.textContent = `Bank: ${money(bank)}`;
      const bankChip2 = document.getElementById("bankChip2");
      if (bankChip2) bankChip2.textContent = `Bank: ${money(bank)}`;
    }

    function playerPill(p, inXI){
      const pill = utils.el("span",{class:"chip"});
      const nm = utils.el("span",{class:"b"}, `${p.name}`);
      const meta = utils.el("span",{class:"tag"}, ` ${p.pos} ${p.team} • ${money(p.price)} • xP:${(p._xpNext??0).toFixed(2)}`);
      const tog = utils.el("button",{class:"btn-ghost",style:"margin-left:8px"}, inXI?"Bench":"Start");
      tog.addEventListener("click", ()=>{
        if (inXI){
          p.isStart = false;
        }else{
          const cap = parseFormation(formation)[p.pos];
          const cur = squad.filter(x=>x.isStart && x.pos===p.pos).length;
          if (cur >= cap) return;
          p.isStart = true;
        }
        enforceFormation();
        recalcBoard();
      });

      pill.append(
        utils.el("span",{class:"team-chip"}, p.team),
        nm,
        utils.el("span",{style:"margin-left:6px"}, badgeXMins(p._xmins||0)),
        meta,
        tog
      );
      return pill;
    }

    /* ---------- suggestions & recommendations ---------- */

    async function suggest(){
      const outId = +outSel.value;
      const out = byId.get(outId);
      const preferNailed = nailedChk.querySelector("input").checked;
      const budget = maxPrice.value ? parseFloat(maxPrice.value) : +(bank + (out.now_cost/10)).toFixed(1);
      const posFilter = +posSel.value || null;
      const q = search.value.trim().toLowerCase();

      const wins = events.filter(e=>e.id>=nextGw).slice(0,windowLen).map(e=>e.id);
      const baseXP = await xPWindow(out, wins);

      suggestCard.innerHTML = "";
      suggestCard.append(
        utils.el("h4",{},"Suggestions"),
        ui.spinner("Scouting candidates…")
      );

      let pool = players.filter(p=>{
        if (p.id===outId) return false;
        if (posFilter && p.element_type!==posFilter) return false;
        if (q && !(`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q))) return false;
        if ((p.now_cost/10) > budget + 1e-6) return false;
        if (preferNailed && (p.status==="i" || p.status==="n")) return false;
        return true;
      }).sort((a,b)=> (parseFloat(b.form||0)-parseFloat(a.form||0)) || (b.total_points-a.total_points)).slice(0,300);

      // obey 3-per-club given current squad minus OUT
      const futureCounts = clubCounts(squad.filter(x=>x.id!==outId));
      pool = pool.filter(p => (futureCounts.get(p.team)||0) < 3 || p.team === out.team);

      const rows = [];
      for (const cand of pool){
        try{
          const xp = await xPWindow(cand, wins);
          const xmins = await estimateXMinsForPlayer(cand);
          rows.push({
            id: cand.id,
            name: cand.web_name,
            pos: posById.get(cand.element_type) || "?",
            team: teamById.get(cand.team)?.short_name || "?",
            price: +(cand.now_cost/10).toFixed(1),
            _xmins: xmins,
            _xp: xp.total,
            _delta: xp.total - baseXP.total
          });
        }catch{}
        await utils.sleep(8);
      }

      rows.sort((a,b)=> b._delta - a._delta);
      const cols = [
        { header:"", cell:r=>{
          const b = utils.el("button",{class:"btn-primary"},"Add move");
          b.addEventListener("click", ()=> applyMove(outId, r));
          return b;
        }},
        { header:"Name", accessor:r=>r.name, sortBy:r=>r.name },
        { header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos },
        { header:"Team", accessor:r=>r.team, sortBy:r=>r.team },
        { header:"Price", accessor:r=>r.price, cell:r=>money(r.price), sortBy:r=>r.price },
        { header:"xMins", cell:r=>badgeXMins(r._xmins||0), sortBy:r=>r._xmins??0 },
        { header:`xP (Next ${windowLen})`, accessor:r=>r._xp, cell:r=>r._xp.toFixed(2), sortBy:r=>r._xp },
        { header:"ΔxP vs out", accessor:r=>r._delta, cell:r=>r._delta.toFixed(2), sortBy:r=>r._delta }
      ];

      suggestCard.innerHTML = "";
      suggestCard.append(
        utils.el("h4",{},`Suggestions (budget ≤ ${money(budget)})`),
        ui.table(cols, rows)
      );
    }

    async function autoRecommend(){
      // scan XI only; for each, find best one-candidate improvement
      const wins = events.filter(e=>e.id>=nextGw).slice(0,windowLen).map(e=>e.id);
      const xi = squad.filter(s=>s.isStart);

      recsCard.innerHTML = "";
      recsCard.append(
        utils.el("h4",{},"Recommendations (Top 3)"),
        ui.spinner("Evaluating XI…")
      );

      const results = [];

      for (const outSlot of xi){
        const out = byId.get(outSlot.id);
        const baseXP = await xPWindow(out, wins);
        const budget = +(bank + outSlot.price).toFixed(1);

        let pool = players.filter(p=>{
          if (p.id===out.id) return false;
          if ((p.now_cost/10) > budget + 1e-6) return false;
          return true;
        }).sort((a,b)=> (parseFloat(b.form||0)-parseFloat(a.form||0)) || (b.total_points-a.total_points)).slice(0,200);

        // 3-per-club with current squad minus OUT
        const futureCounts = clubCounts(squad.filter(x=>x.id!==outSlot.id));
        pool = pool.filter(p => (futureCounts.get(p.team)||0) < 3 || p.team === out.team);

        let best = null;
        for (const cand of pool){
          try{
            if (cand.element_type !== out.element_type) continue; // keep same position for auto
            const xp = await xPWindow(cand, wins);
            const delta = xp.total - baseXP.total;
            if (!best || delta > best.delta){
              best = {
                outId: outSlot.id,
                outName: outSlot.name,
                outPos: outSlot.pos,
                outTeam: outSlot.team,
                inId: cand.id,
                inName: cand.web_name,
                inPos: posById.get(cand.element_type)||"?",
                inTeam: teamById.get(cand.team)?.short_name||"?",
                price: +(cand.now_cost/10).toFixed(1),
                delta,
                xpIn: xp.total
              };
            }
          }catch{}
          await utils.sleep(6);
        }
        if (best) results.push(best);
      }

      results.sort((a,b)=> b.delta - a.delta);
      const top = results.slice(0,3);

      const cols = [
        { header:"Apply", cell:r=>{
          const b = utils.el("button",{class:"btn-primary"},"Apply");
          b.addEventListener("click", ()=> {
            applyMove(r.outId, {
              id: r.inId, name: r.inName, pos: r.inPos, team: r.inTeam,
              price: r.price, _xmins: null, _xp: r.xpIn, _delta: r.delta
            });
          });
          return b;
        }},
        { header:"OUT", cell:r=> `${r.outName} (${r.outPos} ${r.outTeam})` },
        { header:"IN", cell:r=> `${r.inName} (${r.inPos} ${r.inTeam})` },
        { header:"Price", accessor:r=>r.price, cell:r=> money(r.price), sortBy:r=>r.price },
        { header:`ΔxP (Next ${windowLen})`, accessor:r=>r.delta, cell:r=> r.delta.toFixed(2), sortBy:r=>r.delta }
      ];

      recsCard.innerHTML = "";
      recsCard.append(
        utils.el("h4",{},"Recommendations (Top 3)"),
        ui.table(cols, top)
      );
    }

    function applyMove(outId, inRow){
      const out = squad.find(s=>s.id===outId);
      const newBank = +(bank + out.price - inRow.price).toFixed(1);
      const after = squad.filter(s=>s.id!==outId);
      const cnt = clubCounts(after);
      const inTeamId = byId.get(inRow.id)?.team ?? players.find(p=>p.id===inRow.id)?.team;
      const future = (cnt.get(inTeamId)||0) + 1;

      const warnings = [];
      if (newBank < 0) warnings.push("Budget would be negative.");
      if (future > 3) warnings.push("3-per-club limit exceeded.");

      const idx = squad.findIndex(s=>s.id===outId);
      const replacing = squad[idx];
      const pl = byId.get(inRow.id);

      squad[idx] = {
        id: pl.id,
        name: pl.web_name,
        posId: pl.element_type,
        pos: posById.get(pl.element_type) || "?",
        teamId: pl.team,
        team: teamById.get(pl.team)?.short_name || "?",
        price: +(pl.now_cost/10).toFixed(1),
        isStart: replacing.isStart,
        isC: false,
        isVC: false,
        _xmins: inRow._xmins ?? null,
        _xpNext: null,
        _xpWin: null,
        _winLen: null
      };
      bank = newBank;

      if (warnings.length){
        const box = utils.el("div",{},[
          utils.el("div",{class:"tag"},"Plan applied but check:"),
          utils.el("ul",{},warnings.map(w=>utils.el("li",{},w)))
        ]);
        openModal("Warnings", box);
      }

      enforceFormation();
      recalcBoard();
      renderPlanSummary();
    }

    function renderPlanSummary(){
      const xi = squad.filter(s=>s.isStart);
      const bench = squad.filter(s=>!s.isStart);
      const sum = a=>a.reduce((x,y)=>x+(y._xpNext||0),0);
      const sumW=a=>a.reduce((x,y)=>x+(y._xpWin||0),0);

      planCard.innerHTML = "";
      planCard.append(utils.el("h4",{},"Plan Summary"));
      planCard.append(utils.el("div",{class:"chips"},[
        utils.el("span",{class:"chip chip-accent"},`XI xP (Next): ${sum(xi).toFixed(2)}`),
        utils.el("span",{class:"chip"},`XI xP (Next ${windowLen}): ${sumW(xi).toFixed(2)}`),
        utils.el("span",{class:"chip"},`Bank after moves: ${money(bank)}`)
      ]));

      const copy = ui.copyButton(()=>{
        const lines = [];
        lines.push(`FPL Planner — window GW${nextGw}→${nextGw+windowLen-1}`);
        lines.push(`Bank after moves: ${money(bank)}`);
        lines.push(`XI xP next: ${sum(xi).toFixed(2)} | next ${windowLen}: ${sumW(xi).toFixed(2)}`);
        lines.push("XI:");
        xi.forEach(p=> lines.push(`- ${p.name} ${p.pos} ${p.team} — xP(next) ${p._xpNext?.toFixed(2)||"0.00"}`));
        lines.push("Bench:");
        bench.forEach(p=> lines.push(`- ${p.name} ${p.pos} ${p.team}`));
        lines.push("Please validate: captain/vice, bench order, and 2 alternative transfer paths within budget.");
        return lines.join("\n");
      },"Copy plan for ChatGPT");
      planCard.append(utils.el("div",{style:"margin-top:8px"}, copy));
    }

    clearBtn.addEventListener("click", async ()=>{
      bank = +bank0.toFixed(1);
      squad = ordered.map(pk=>{
        const pl = byId.get(pk.element);
        return {
          id: pl.id,
          name: pl.web_name,
          posId: pl.element_type,
          pos: posById.get(pl.element_type) || "?",
          teamId: pl.team,
          team: teamById.get(pl.team)?.short_name || "?",
          price: +(pl.now_cost/10).toFixed(1),
          isStart: startSet.has(pl.id),
          isC: !!pk.is_captain,
          isVC: !!pk.is_vice_captain,
          _xmins: null,
          _xpNext: null,
          _xpWin: null,
          _winLen: null
        };
      });
      formation = inferFormationFromXI(squad) || formation;
      formationSel.value = formation;
      enforceFormation();
      await recalcBoard();
      suggestCard.innerHTML = "<h4>Suggestions</h4>";
      recsCard.innerHTML = "<h4>Recommendations (Top 3)</h4>";
      planCard.innerHTML = "<h4>Plan Summary</h4>";
    });

    scoutBtn.addEventListener("click", suggest);
    autoBtn .addEventListener("click", autoRecommend);

    // kick off
    enforceFormation();
    await recalcBoard();
    refreshOutSel();
    renderPlanSummary();

  }catch(err){
    ui.mount(main, ui.error("Failed to load Planner", err));
  }
}
