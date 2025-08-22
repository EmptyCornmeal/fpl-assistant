// js/pages/planner.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";

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

    // Pull baseline
    const [profile, hist, picks] = await Promise.all([
      api.entry(state.entryId),
      api.entryHistory(state.entryId),
      api.entryPicks(state.entryId, Math.max(1,lastFinished))
    ]);

    const bank = (hist.current.find(h=>h.event===lastFinished)?.bank || 0)/10;

    // Squad snapshot (from last finished GW)
    const ordered = picks.picks.slice().sort((a,b)=>a.position-b.position);
    const startIds = new Set(ordered.slice(0,11).map(x=>x.element));
    const squad = ordered.map(pk=>{
      const pl = players.find(p=>p.id===pk.element);
      return {
        id: pl.id,
        name: pl.web_name,
        pos: posById.get(pl.element_type) || "?",
        teamId: pl.team,
        team: teamById.get(pl.team)?.short_name || "?",
        price: +(pl.now_cost/10).toFixed(1),
        isStart: startIds.has(pl.id),
        isC: !!pk.is_captain,
        isVC: !!pk.is_vice_captain
      };
    });

    // UI controls
    const outSel = utils.el("select");
    outSel.innerHTML = squad.map(s=>`<option value="${s.id}">${s.name} — ${s.pos} ${s.team} (£${s.price.toFixed(1)}m)</option>`).join("");

    const inPosSel = utils.el("select");
    inPosSel.innerHTML = `<option value="">Any position</option>` + positions.map(p=>`<option value="${p.id}">${p.singular_name_short}</option>`).join("");

    const windowSel = utils.el("select");
    windowSel.innerHTML = `
      <option value="3" selected>Next 3 GWs</option>
      <option value="5">Next 5 GWs</option>
      <option value="8">Next 8 GWs</option>`;

    const maxPrice = utils.el("input",{placeholder:"Max price £m (blank = auto)", inputmode:"decimal", style:"width:160px"});
    const onlyStarters = utils.el("label",{},[
      utils.el("input",{type:"checkbox", checked:true}),
      utils.el("span",{style:"margin-left:6px"},"Prefer nailed (>=60m avg)")
    ]);

    const findBtn = utils.el("button",{class:"btn-primary"},"Suggest replacements");
    const copyBtn = utils.el("button",{class:"btn-ghost"},"Copy plan prompt");

    const controls = utils.el("div",{class:"controls"},[
      utils.el("span",{class:"chip"},"Bank: £"+bank.toFixed(1)+"m"),
      utils.el("span",{class:"chip"},"Next GW: "+nextGw),
      outSel, inPosSel, windowSel, maxPrice, onlyStarters, findBtn, copyBtn
    ]);

    const suggestionsCard = utils.el("div",{class:"card"});
    suggestionsCard.append(utils.el("h3",{},"Top Suggestions"));

    const planCard = utils.el("div",{class:"card"});
    planCard.append(utils.el("h3",{},"Plan Summary"));
    const planBody = utils.el("div");
    planCard.append(planBody);

    shell.innerHTML = "";
    shell.append(utils.el("div",{class:"card"},[utils.el("h3",{},"Transfer Planner (1 FT)"), controls]));
    shell.append(suggestionsCard, planCard);
    ui.mount(main, shell);

    // Helpers
    function teamCounts(list){
      const m = new Map();
      for (const p of list) m.set(p.teamId, (m.get(p.teamId)||0)+1);
      return m;
    }
    const baseTeamCounts = teamCounts(squad);

    async function getWindowFDRs(teamId, gwCount){
      const future = events.filter(e=>e.id>=nextGw).slice(0,gwCount).map(e=>e.id);
      const fdrs = [];
      for (const eid of future){
        const fx = await api.fixtures(eid);
        const my = fx.filter(f => f.team_h===teamId || f.team_a===teamId);
        my.forEach(m=>{
          const home = m.team_h===teamId;
          fdrs.push(home ? m.team_h_difficulty : m.team_a_difficulty);
        });
        await utils.sleep(35); // polite throttle
      }
      return fdrs;
    }

    function edgeScore(form, fdrAvg, p90){
      const formN = Math.max(0, Math.min(10, parseFloat(form||"0")))/10;
      const fdrEase = (5 - Math.min(5, Math.max(1, fdrAvg||3)))/4; // 0(hard)…1(easy)
      const p90N = p90!=null ? Math.min(1.5, Math.max(0, p90))/1.5 : 0.0;
      return +(0.45*formN + 0.35*fdrEase + 0.20*p90N).toFixed(3);
    }

    function canAddCandidate(outId, inPlayer){
      // enforce 3-per-team rule post-transfer
      const m = new Map();
      for (const p of squad){
        if (p.id===outId) continue;
        m.set(p.teamId, (m.get(p.teamId)||0)+1);
      }
      const futureCount = (m.get(inPlayer.team)||0)+1;
      return futureCount <= 3;
    }

    function fxPreview(teamId, gwCount){
      // small async preview string for modal; best-effort
      return (async()=>{
        const future = events.filter(e=>e.id>=nextGw).slice(0,gwCount).map(e=>e.id);
        const chunks = [];
        for (const eid of future){
          const fx = await api.fixtures(eid);
          const my = fx.filter(f => f.team_h===teamId || f.team_a===teamId);
          my.forEach(m=>{
            const home = m.team_h===teamId;
            const oppId = home ? m.team_a : m.team_h;
            const opp = teamById.get(oppId)?.short_name || "?";
            const fdr = home ? m.team_h_difficulty : m.team_a_difficulty;
            chunks.push(`${home?"H":"A"} ${opp} (FDR ${fdr})`);
          });
          await utils.sleep(20);
        }
        return chunks.slice(0,3).join(", ");
      })();
    }

    let scanId = 0;

    async function suggest(){
      const myScan = ++scanId;
      try{
        suggestionsCard.innerHTML="";
        suggestionsCard.append(utils.el("h3",{},"Top Suggestions"));
        suggestionsCard.append(ui.spinner("Scouting candidates…"));

        const outId = +outSel.value;
        const outPlayer = players.find(p=>p.id===outId);
        const outPrice = (outPlayer.now_cost/10);
        const gwCount = +windowSel.value;
        const preferNailed = onlyStarters.querySelector("input").checked;

        const budget = maxPrice.value ? parseFloat(maxPrice.value) : +(bank + outPrice).toFixed(1);
        const posFilter = +inPosSel.value || null;

        // Candidate universe (budget/pos/availability pre-filter)
        let universe = players.filter(p=>{
          if (p.id===outId) return false;
          if (posFilter && p.element_type!==posFilter) return false;
          if ((p.now_cost/10) > budget + 1e-6) return false;
          if (preferNailed && (p.status==="i" || p.status==="n")) return false;
          // light quality gate
          return (p.total_points>=2) || parseFloat(p.form||"0") >= 1;
        }).map(p=>({
          id:p.id, name:p.web_name, team:p.team,
          teamShort: teamById.get(p.team)?.short_name || "?",
          pos: posById.get(p.element_type) || "?",
          price:+(p.now_cost/10).toFixed(1), form:p.form
        }));

        universe = universe.filter(c => canAddCandidate(outId, c));
        if (scanId !== myScan) return;

        // First pass: fixture ease
        for (const c of universe){
          const fdrs = await getWindowFDRs(c.team, gwCount);
          c._fdrAvg = fdrs.length ? fdrs.reduce((a,b)=>a+b,0)/fdrs.length : 3;
          c._score = edgeScore(c.form, c._fdrAvg, null);
          if (scanId !== myScan) return;
          await utils.sleep(10);
        }

        universe.sort((a,b)=>b._score-a._score);
        const shortlist = universe.slice(0, 30);

        // Second pass: refine with last-5 p/90
        for (const c of shortlist){
          try{
            const sum = await api.elementSummary(c.id);
            const rows = sum.history.filter(h=>h.round<=lastFinished).slice(-5);
            const mins = rows.reduce((a,b)=>a+(b.minutes||0),0);
            const pts  = rows.reduce((a,b)=>a+(b.total_points||0),0);
            c._p90 = mins ? +(pts/(mins/90)).toFixed(2) : 0;
            c._score = edgeScore(c.form, c._fdrAvg, c._p90);
          }catch{ c._p90 = 0; }
          if (scanId !== myScan) return;
          await utils.sleep(25);
        }

        const cols = [
          { header:"", cell:r=>{
            const b = utils.el("button",{class:"btn-primary"},"Select");
            b.addEventListener("click", ()=> applyPlan(r));
            return b;
          }},
          { header:"Name", accessor:r=>r.name, sortBy:r=>r.name },
          { header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos },
          { header:"Team", accessor:r=>r.teamShort, sortBy:r=>r.teamShort },
          { header:"Price", accessor:r=>r.price, cell:r=> `£${r.price.toFixed(1)}m`, sortBy:r=>r.price },
          { header:"Form", accessor:r=>+r.form, sortBy:r=>+r.form },
          { header:`Avg FDR (next ${gwCount})`, accessor:r=>r._fdrAvg, cell:r=> r._fdrAvg?.toFixed(2) ?? "—", sortBy:r=>r._fdrAvg },
          { header:"Last5 p/90", accessor:r=>r._p90 ?? 0, sortBy:r=>r._p90 ?? 0 },
          { header:"Edge Score", accessor:r=>r._score, cell:r=> r._score.toFixed(3), sortBy:r=>r._score },
        ];

        suggestionsCard.innerHTML="";
        suggestionsCard.append(utils.el("h3",{},`Top Suggestions (budget ≤ £${budget.toFixed(1)}m)`));
        suggestionsCard.append(ui.table(cols, shortlist));
      }catch(e){
        suggestionsCard.innerHTML="";
        suggestionsCard.append(utils.el("h3",{},"Top Suggestions"));
        suggestionsCard.append(ui.error("Planner failed to suggest replacements", e));
      }
    }

    async function applyPlan(inCand){
      const outId = +outSel.value;
      const out = squad.find(s=>s.id===outId);
      const newBank = +(bank + out.price - inCand.price).toFixed(1);

      const warn = [];
      if (newBank < 0) warn.push("Budget: exceeds bank.");
      const teamCount = baseTeamCounts.get(inCand.team) || 0;
      if (teamCount >= 3 && inCand.team !== out.team) warn.push("Team limit: would exceed 3 from one club.");

      planBody.innerHTML="";
      const list = utils.el("ul");
      list.append(utils.el("li",{}, `OUT: ${out.name} (${out.pos}, ${out.team}) £${out.price.toFixed(1)}m`));
      list.append(utils.el("li",{}, `IN: ${inCand.name} (${inCand.pos}, ${inCand.teamShort}) £${inCand.price.toFixed(1)}m`));
      list.append(utils.el("li",{}, `New bank: £${newBank.toFixed(1)}m`));
      if (warn.length) list.append(utils.el("li",{class:"tag"}, `Warnings: ${warn.join(" | ")}`));

      const btn = utils.el("button",{class:"btn-ghost"},"View details");
      btn.addEventListener("click", async ()=>{
        const box = utils.el("div");
        const ul = utils.el("ul");
        ul.append(utils.el("li",{}, `Form: ${inCand.form}`));
        ul.append(utils.el("li",{}, `Last5 points/90: ${inCand._p90 ?? "—"}`));
        ul.append(utils.el("li",{}, `Avg FDR next ${+windowSel.value}: ${inCand._fdrAvg?.toFixed(2) ?? "—"}`));
        ul.append(utils.el("li",{}, `Edge Score: ${inCand._score.toFixed(3)}`));
        const fx = await fxPreview(inCand.team, Math.min(+windowSel.value,3)).catch(()=> "");
        if (fx) ul.append(utils.el("li",{}, `Next fixtures: ${fx}`));
        box.append(ul);
        openModal(`Transfer detail — ${out.name} → ${inCand.name}`, box);
      });
      planBody.append(list, utils.el("div",{style:"height:8px"}), btn);

      // Copyable co-pilot prompt
      copyBtn.onclick = ()=>{
        const lines = [];
        lines.push(`FPL Planner — 1 FT for GW${nextGw}`);
        lines.push(`Team: ${profile.name} | Bank: £${bank.toFixed(1)}m`);
        lines.push(`Plan: OUT ${out.name} (${out.pos}, ${out.team}) → IN ${inCand.name} (${inCand.pos}, ${inCand.teamShort})`);
        lines.push(`New bank: £${newBank.toFixed(1)}m`);
        lines.push(`Rationale: Form ${inCand.form}; Last5 p/90 ${inCand._p90 ?? "—"}; Avg FDR (next ${+windowSel.value}) ${inCand._fdrAvg?.toFixed(2) ?? "—"}; Edge Score ${inCand._score.toFixed(3)}.`);
        lines.push(`Please validate formation/limits and suggest captain/vice, bench order, and two alternative plans within budget.`);
        navigator.clipboard.writeText(lines.join("\n"));
        copyBtn.textContent = "Copied!";
        setTimeout(()=> copyBtn.textContent = "Copy plan prompt", 1200);
      };
    }

    findBtn.addEventListener("click", suggest);
  }catch(err){
    ui.mount(main, ui.error("Failed to load Planner", err));
  }
}
