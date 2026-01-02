// js/pages/planner.js
import { fplClient, legacyApi } from "../api/fplClient.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";
import { getCacheAge, CacheKey } from "../api/fetchHelper.js";

/* ───────────────── helpers & constants ───────────────── */
const FORMATIONS = ["3-4-3","3-5-2","4-4-2","4-3-3","5-4-1","4-5-1","5-3-2"];
const money = (n)=> `£${(+n).toFixed(1)}m`;

const badgeXMins = (val)=>{
  const b = utils.el("span",{class:"badge"},"—");
  const r90 = (val||0)/90;
  b.textContent = r90>=0.9 ? "NAILED" : (r90>=0.7 ? "RISK" : "CAMEO?");
  b.className = "badge " + (r90>=0.9 ? "badge-green" : (r90>=0.7 ? "badge-amber" : "badge-red"));
  b.dataset.tooltip = `Projected ${Math.round(val||0)}'`;
  return b;
};

function parseFormation(f){ const [d,m,fw] = f.split("-").map(Number); return {GKP:1, DEF:d, MID:m, FWD:fw}; }
function cloneSquad(list){ return list.map(p=>({...p})); }
function sum(list, key){ return list.reduce((a,b)=> a + (b[key]||0), 0); }

/* mini FIFA style vertical player card */
function playerCard(p, size="md"){
  const w = size==="sm" ? 90 : 110;
  const h = size==="sm" ? 130 : 150;
  const card = utils.el("div",{
    class: "player-card",
    style: `
      width:${w}px;height:${h}px;border-radius:14px;
      background:linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
      box-shadow:0 2px 10px rgba(0,0,0,0.25);
      display:flex;flex-direction:column;align-items:center;justify-content:space-between;
      padding:8px; text-align:center; border:1px solid rgba(255,255,255,0.06);
    `
  });

  const top = utils.el("div",{style:"display:flex;gap:6px;align-items:center"});
  top.append(utils.el("span",{class:"team-chip"}, p.team));
  top.append(utils.el("span",{class:"badge small"}, p.pos));
  const name = utils.el("div",{style:"font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%"}, p.name);
  const meta = utils.el("div",{class:"small",style:"opacity:.85"}, `${money(p.price)} • xP:${(p._xpNext??0).toFixed(2)}`);
  const mins = utils.el("div",{}, badgeXMins(p._xmins||0));

  card.append(top, name, mins, meta);
  return card;
}

/* formation → best XI from squad */
function bestXIForFormation(squad, fstr){
  const need = parseFormation(fstr);
  const pickTop = (arr, n)=> arr.slice().sort((a,b)=> (b._xpNext||0)-(a._xpNext||0)).slice(0,n);

  const gk  = pickTop(squad.filter(p=>p.pos==="GKP"), 1);
  const def = pickTop(squad.filter(p=>p.pos==="DEF"), need.DEF);
  const mid = pickTop(squad.filter(p=>p.pos==="MID"), need.MID);
  const fwd = pickTop(squad.filter(p=>p.pos==="FWD"), need.FWD);

  if (gk.length<1 || def.length<need.DEF || mid.length<need.MID || fwd.length<need.FWD) return null;
  const xi = [...gk, ...def, ...mid, ...fwd];
  return { formation:fstr, xi, xiIds: new Set(xi.map(p=>p.id)), need, total: xi.reduce((a,b)=>a+(b._xpNext||0),0) };
}

/* try all formations */
function autoPickBestXI(squad){
  const picks = [];
  for (const f of FORMATIONS){
    const k = bestXIForFormation(squad, f);
    if (k) picks.push(k);
  }
  if (!picks.length) return null;
  picks.sort((a,b)=> b.total - a.total);
  return picks[0];
}

/* ── cancellation ── */
class CancelError extends Error { constructor(){ super("cancelled"); this.name="CancelError"; this.isCancel=true; } }
let cancelFlag = { value:false };
const checkCancel = ()=> { if (cancelFlag.value) throw new CancelError(); };

/* compute (and cache) xMins + xP(next) for given window */
async function enrichXPForSquad(squad, wins, byId){
  for (const s of squad){
    checkCancel();
    try{
      const pl = byId.get(s.id);
      if (s._winStamp !== wins.join(",")){
        s._xmins  = await estimateXMinsForPlayer(pl);
        const one = await xPWindow(pl, wins.slice(0,1));
        s._xpNext = one.total;
        s._winStamp = wins.join(",");
      }
    }catch{ s._xmins = 0; s._xpNext = 0; s._winStamp = wins.join(","); }
    await utils.sleep(3);
  }
}

/* apply per-club cap (3), no duplicates, and budget */
function clubCounts(list){ const m=new Map(); list.forEach(p=> m.set(p.teamId,(m.get(p.teamId)||0)+1)); return m; }

/* 3 suggestions for a specific OUT under constraints */
async function suggestReplacements(out, players, teamsById, posById, wins, preferNailed, budget, q, posFilter, squadAfterOut){
  const existingIds = new Set(squadAfterOut.map(p=>p.id)); // prevent duplicates
  const cnt = clubCounts(squadAfterOut);

  let pool = players.filter(p=>{
    if (existingIds.has(p.id)) return false;
    if (posFilter && p.element_type !== posFilter) return false;
    if (q && !(`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q))) return false;
    if ((p.now_cost/10) > budget + 1e-6) return false;
    if (preferNailed && (p.status==="i" || p.status==="n")) return false;
    if ((cnt.get(p.team)||0) >= 3) return false;
    return true;
  }).sort((a,b)=> (parseFloat(b.form||0)-parseFloat(a.form||0)) || (b.total_points-a.total_points)).slice(0,220);

  const rows = [];
  for (const cand of pool){
    checkCancel();
    try{
      const xp = await xPWindow(cand, wins);
      const xmins = await estimateXMinsForPlayer(cand);
      rows.push({
        id: cand.id, name: cand.web_name, posId: cand.element_type,
        pos: posById.get(cand.element_type) || "?",
        teamId: cand.team, team: teamsById.get(cand.team)?.short_name || "?",
        price: +(cand.now_cost/10).toFixed(1),
        _xmins: xmins, _xp: xp.total,
        _delta: xp.total - (out._xpNext||0)
      });
    }catch{}
    await utils.sleep(3);
  }

  rows.sort((a,b)=> b._delta - a._delta);
  return rows.slice(0,3);
}

/* Optimize XI: up to N moves, no dups, respect budget/club caps */
async function greedyImproveXI(base, players, byId, teamsById, posById, wins, N, bank){
  const plan = cloneSquad(base);
  let planBank = bank;

  await enrichXPForSquad(plan, wins, byId);
  let best = autoPickBestXI(plan);
  if (!best) return { plan, applied: [], best, bank: planBank };

  const applied = [];

  for (let step=0; step<N; step++){
    checkCancel();
    best = autoPickBestXI(plan);
    const xi = best.xi;

    let bestMove = null;

    for (const out of xi){
      checkCancel();
      const budget = +(planBank + out.price).toFixed(1);
      const after  = plan.filter(p=>p.id!==out.id);
      const ranks = (await suggestReplacements(out, players, teamsById, posById, wins, true, budget, "", null, after))
        .filter(r => !after.some(p=>p.id===r.id) && r.pos===out.pos);

      for (const r of ranks){
        checkCancel();
        const draft = cloneSquad(after);
        draft.push({ id:r.id,name:r.name,pos:r.pos,team:r.team,teamId:r.teamId,price:r.price,isStart:out.isStart,_xmins:r._xmins,_xpNext:r._xp });
        await enrichXPForSquad(draft, wins, byId);
        const pick = autoPickBestXI(draft);
        if (!pick) continue;
        const delta = pick.total - best.total;
        if (!bestMove || delta > bestMove.delta) bestMove = { out, inRow:r, pick, delta };
      }
    }

    if (!bestMove || bestMove.delta <= 1e-6) break;

    if (plan.some(p=>p.id===bestMove.inRow.id)) break; // safety
    const idx = plan.findIndex(p=>p.id===bestMove.out.id);
    plan[idx] = {
      id: bestMove.inRow.id, name: bestMove.inRow.name, pos: bestMove.inRow.pos,
      team: bestMove.inRow.team, teamId: bestMove.inRow.teamId, price: bestMove.inRow.price,
      isStart: plan[idx].isStart, _xmins: bestMove.inRow._xmins, _xpNext: bestMove.inRow._xp
    };
    planBank = +(planBank + bestMove.out.price - bestMove.inRow.price).toFixed(1);
    applied.push(bestMove);
    await utils.sleep(6);
  }

  await enrichXPForSquad(plan, wins, byId);
  const finalPick = autoPickBestXI(plan);
  return { plan, applied, best: finalPick, bank: planBank };
}

/* Wildcard/Free Hit: greedy, under derived XI budget, club cap enforced */
async function wildcardXI(players, teamsById, posById, wins, xiBudget){
  const rows = [];
  for (const p of players){
    checkCancel();
    try{
      const xp = await xPWindow(p, wins);
      const xmins = await estimateXMinsForPlayer(p);
      rows.push({
        id: p.id, name: p.web_name, posId: p.element_type,
        pos: posById.get(p.element_type) || "?", teamId: p.team,
        team: teamsById.get(p.team)?.short_name || "?", price: +(p.now_cost/10).toFixed(1),
        _xmins: xmins, _xpNext: xp.total
      });
    }catch{}
    await utils.sleep(2);
  }

  const by = {
    GKP: rows.filter(r=>r.pos==="GKP").sort((a,b)=> (b._xpNext/(b.price||1e-9)) - (a._xpNext/(a.price||1e-9)) || (b._xpNext-a._xpNext)),
    DEF: rows.filter(r=>r.pos==="DEF").sort((a,b)=> (b._xpNext/(b.price||1e-9)) - (a._xpNext/(a.price||1e-9)) || (b._xpNext-a._xpNext)),
    MID: rows.filter(r=>r.pos==="MID").sort((a,b)=> (b._xpNext/(b.price||1e-9)) - (a._xpNext/(a.price||1e-9)) || (b._xpNext-a._xpNext)),
    FWD: rows.filter(r=>r.pos==="FWD").sort((a,b)=> (b._xpNext/(b.price||1e-9)) - (a._xpNext/(a.price||1e-9)) || (b._xpNext-a._xpNext))
  };

  function greedySet(need){
    const pick = [];
    const clubCap = new Map();
    let spend = 0;

    const add = (arr, want)=>{
      for (const r of arr){
        if (pick.find(x=>x.id===r.id)) continue;
        const c = (clubCap.get(r.teamId)||0);
        if (c >= 3) continue;
        if (spend + r.price > xiBudget + 1e-6) continue;
        pick.push(r);
        clubCap.set(r.teamId, c+1);
        spend += r.price;
        if (--want === 0) break;
      }
      return want<=0;
    };

    if (!add(by.GKP, 1)) return null;
    if (!add(by.DEF, need.DEF)) return null;
    if (!add(by.MID, need.MID)) return null;
    if (!add(by.FWD, need.FWD)) return null;

    return { pick, spend, total: pick.reduce((a,b)=>a+(b._xpNext||0),0) };
  }

  let best = null;
  for (const f of FORMATIONS){
    checkCancel();
    const g = greedySet(parseFormation(f));
    if (!g) continue;
    if (!best || g.total > best.total) best = {...g, formation:f};
    await utils.sleep(1);
  }
  return best;
}

/* Hit-aware: unlimited moves until marginal gain <= hit cost (−4 per extra) */
async function hitAwareImproveUnlimited(base, players, byId, teamsById, posById, wins, bank){
  const FREE_TRANSFERS = 1;
  const MAX_MOVES = 8; // safety cap
  let plan = cloneSquad(base);
  let planBank = bank;

  await enrichXPForSquad(plan, wins, byId);
  let basePick = autoPickBestXI(plan);
  if (!basePick) return { plan, best: null, applied: [], penalty: 0, netGain: 0 };

  let applied = [];
  let moves = 0;
  let currentPick = basePick;
  let improved = true;

  while (improved && moves < MAX_MOVES){
    checkCancel();
    improved = false;

    let bestMove = null;

    for (const out of currentPick.xi){
      checkCancel();
      const budget = +(planBank + out.price).toFixed(1);
      const after  = plan.filter(p=>p.id!==out.id);
      const ranks = (await suggestReplacements(out, players, teamsById, posById, wins, true, budget, "", null, after))
        .filter(r => !after.some(p=>p.id===r.id) && r.pos===out.pos);

      for (const r of ranks){
        checkCancel();
        const draft = cloneSquad(after);
        draft.push({ id:r.id,name:r.name,pos:r.pos,team:r.team,teamId:r.teamId,price:r.price,isStart:out.isStart,_xmins:r._xmins,_xpNext:r._xp });
        await enrichXPForSquad(draft, wins, byId);
        const pick = autoPickBestXI(draft);
        if (!pick) continue;

        const stepPenalty = (moves + 1 > FREE_TRANSFERS) ? 4 : 0;
        const delta = (pick.total - basePick.total) - (applied.reduce((a,b)=>a+b.stepPenalty,0) + stepPenalty);
        if (!bestMove || delta > bestMove.delta){
          bestMove = { out, inRow:r, pick, delta, stepPenalty };
        }
      }
    }

    if (bestMove && bestMove.delta > 1e-6){
      const idx = plan.findIndex(p=>p.id===bestMove.out.id);
      if (idx >= 0 && !plan.some(p=>p.id===bestMove.inRow.id)){
        plan[idx] = {
          id: bestMove.inRow.id, name: bestMove.inRow.name, pos: bestMove.inRow.pos,
          team: bestMove.inRow.team, teamId: bestMove.inRow.teamId, price: bestMove.inRow.price,
          isStart: plan[idx].isStart, _xmins: bestMove.inRow._xmins, _xpNext: bestMove.inRow._xp
        };
        planBank = +(planBank + bestMove.out.price - bestMove.inRow.price).toFixed(1);
        applied.push({
          out: {id:bestMove.out.id, name:bestMove.out.name, pos:bestMove.out.pos, team:bestMove.out.team, price:bestMove.out.price},
          in:  {id:bestMove.inRow.id, name:bestMove.inRow.name, pos:bestMove.inRow.pos, team:bestMove.inRow.team, price:bestMove.inRow.price},
          deltaStep: (bestMove.inRow._xp - (bestMove.out._xpNext||0)),
          stepPenalty: bestMove.stepPenalty
        });
        currentPick = bestMove.pick;
        improved = true;
        moves++;
      } else {
        break; // duplicate detected, stop
      }
    } else {
      break;
    }
  }

  const penalty = applied.reduce((a,b)=> a + b.stepPenalty, 0);
  const netGain = (currentPick.total - basePick.total) - penalty;
  return { plan, best: currentPick, applied, penalty, netGain, bank: planBank };
}

/* write-up under builder */
function writeupExplain(container, title, details){
  container.innerHTML = "";
  container.append(utils.el("h4",{}, title));
  const p = utils.el("div",{class:"small", style:"margin-top:6px; line-height:1.4"});

  const bits = [];
  if (details.context) bits.push(details.context);
  if (details.formation) bits.push(`Chosen formation: ${details.formation}.`);
  if (details.before != null && details.after != null){
    const delta = details.after - details.before;
    bits.push(`XI xP before: ${details.before.toFixed(2)} → after: ${details.after.toFixed(2)} (${delta>=0?"+":""}${delta.toFixed(2)} xP).`);
  }
  if (details.penalty){ bits.push(`Hit penalty applied: -${details.penalty}. Net swing: ${(details.after - details.before - details.penalty).toFixed(2)}.`); }
  if (Array.isArray(details.moves) && details.moves.length){
    bits.push(" Transfers:");
    details.moves.forEach(m=>{
      const d = m.deltaStep!=null ? ` (ΔxP ${m.deltaStep>=0?"+":""}${m.deltaStep.toFixed(2)})` : (m.delta!=null ? ` (ΔxP ${m.delta>=0?"+":""}${m.delta.toFixed(2)})` : "");
      bits.push(` OUT ${m.out.name} → IN ${m.in.name}${d}.`);
    });
  }
  if (details.note) bits.push(details.note);
  p.textContent = bits.join(" ");
  container.append(p);
}

/* ───────────────── page ───────────────── */
export async function renderPlanner(main){
  const shell = utils.el("div");
  shell.append(ui.spinner("Loading planner…"));
  ui.mount(main, shell);

  // full-screen overlay with Cancel
  const overlayMsg = utils.el("div",{style:"font-weight:600; margin-right:10px"},"Please wait…");
  const cancelBtn  = utils.el("button",{class:"btn-ghost"},"Cancel");
  const overlay = utils.el("div",{
    style: `
      position:fixed; inset:0; display:none; z-index:9999;
      align-items:center; justify-content:center;
      background:rgba(0,0,0,0.45); backdrop-filter:blur(2px);
    `
  }, [
    utils.el("div",{class:"card",style:"padding:14px 18px; display:flex; align-items:center;"}, [overlayMsg, cancelBtn])
  ]);
  document.body.appendChild(overlay);

  const lockUI = (msg="Please wait…")=>{
    overlayMsg.textContent = msg;
    cancelBtn.style.display = "inline-block";
    overlay.style.display = "flex";
    cancelFlag.value = false;
    shell.querySelectorAll("button,select,input").forEach(el=> el.disabled = true);
  };
  const unlockUI = ()=>{
    overlay.style.display = "none";
    cancelBtn.style.display = "none";
    shell.querySelectorAll("button,select,input").forEach(el=> el.disabled = false);
  };
  cancelBtn.addEventListener("click", ()=>{
    cancelFlag.value = true;
    overlayMsg.textContent = "Cancelling…";
    cancelBtn.style.display = "none";
  });

  try{
    const bs = state.bootstrap || await legacyApi.bootstrap();
    state.bootstrap = bs;

    const { elements: players, teams, element_types: positions, events } = bs;
    const teamsById = new Map(teams.map(t=>[t.id,t]));
    const posById   = new Map(positions.map(p=>[p.id,p.singular_name_short]));
    const byId      = new Map(players.map(p=>[p.id,p]));

    // === GW refs (always plan for the NEXT GW) ===
    const prevEvent = events.find(e=>e.is_previous) || null;
    const currEvent = events.find(e=>e.is_current)  || null;
    const nextEvent = events.find(e=>e.is_next)     || null;

    const lastFinished   = prevEvent?.id ?? (events.filter(e=>e.data_checked).slice(-1)[0]?.id ?? 0);
    const planGw         = nextEvent?.id ?? ((currEvent?.id ?? lastFinished) + 1);
    const maxGw          = Math.max(...events.map(e=>e.id));
    const planGwClamped  = Math.min(planGw, maxGw);

    if (!state.entryId){
      ui.mount(main, utils.el("div",{class:"card"},"Enter your Entry ID (left sidebar) to use the planner."));
      return;
    }

    // === Picks: try NEXT GW first, then current/last as fallback ===
    let picks = null;
    try { picks = await legacyApi.entryPicks(state.entryId, planGwClamped); } catch {}
    if (!picks?.picks?.length) {
      try { picks = await legacyApi.entryPicks(state.entryId, currEvent?.id ?? lastFinished); } catch {}
    }
    if (!picks?.picks?.length){
      ui.mount(main, ui.error("Planner couldn’t fetch your picks for the next or current GW."));
      return;
    }

    const [profile, hist] = await Promise.all([api.entry(state.entryId), api.entryHistory(state.entryId)]);
    const bank0 = (hist.current.find(h=>h.event===lastFinished)?.bank || 0)/10;
    const bankBaseInit = +(+bank0).toFixed(1);

    // base squad (15)
    const ordered = picks.picks.slice().sort((a,b)=>a.position-b.position);
    const startSet = new Set(ordered.slice(0,11).map(x=>x.element));
    const toItem = (pk)=>{
      const pl = byId.get(pk.element);
      return {
        id: pl.id, name: pl.web_name, posId: pl.element_type,
        pos: posById.get(pl.element_type) || "?", teamId: pl.team,
        team: teamsById.get(pl.team)?.short_name || "?", price: +(pl.now_cost/10).toFixed(1),
        isStart: startSet.has(pl.id),
        _xmins: null, _xpNext: null, _winStamp: null
      };
    };
    const baseSquad = ordered.map(toItem);
    let bankPlan = bankBaseInit;
    let planSquad = cloneSquad(baseSquad);

    // window selector (default next 1, from next GW)
    let windowLen = 1;
    const wins = () => events.filter(e=>e.id>=planGwClamped).slice(0,windowLen).map(e=>e.id);

    /* ───────────────── Transfer Builder ───────────────── */
    shell.innerHTML = "";
    const builder = utils.el("div",{class:"card"});
    const headerRow = utils.el("div",{class:"chips"},[
      utils.el("span",{class:"chip"},`Manager: ${profile.player_first_name} ${profile.player_last_name}`),
      utils.el("span",{class:"chip"},`Plan GW: ${planGwClamped}`),
      utils.el("span",{class:"chip chip-accent", id:"bankChip"},`Bank: ${money(bankPlan)}`),
      utils.el("span",{class:"chip"},"Window:")
    ]);
    const windowSel = utils.el("select");
    windowSel.innerHTML = `
      <option value="1" selected>Next 1</option>
      <option value="3">Next 3</option>
      <option value="5">Next 5</option>
      <option value="8">Next 8</option>`;
    windowSel.addEventListener("change", async ()=>{
      windowLen = +windowSel.value;
      lockUI("Recalculating projections…");
      try { await refreshAll(true); } catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });
    headerRow.append(windowSel);

    const explainBox = utils.el("div",{class:"tag", style:"margin-top:8px"});
    builder.append(utils.el("h3",{},"Transfer Builder"), headerRow, explainBox);

    // Step row: Out + filters + suggest
    const outSel  = utils.el("select");
    const posSel  = utils.el("select");
    posSel.innerHTML = `<option value="">Any position</option>`+positions.map(p=>`<option value="${p.id}">${p.singular_name_short}</option>`).join("");
    const search   = utils.el("input",{placeholder:"Search name"});
    const maxPrice = utils.el("input",{placeholder:"Max price (£m)", inputmode:"decimal", class:"w90"});
    const nailedChk= utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox",checked:true}),
      utils.el("span",{class:"tag"}," Prefer nailed (xMins ≥ 60)")
    ]);
    const scoutBtn     = utils.el("button",{class:"btn-primary"},"Find 3 replacements");
    const resetPlanBtn = utils.el("button",{class:"btn-ghost"},"Reset plan");

    const step1 = utils.el("div",{class:"ap-toolbar-row", style:"margin-top:8px"});
    step1.append(
      utils.el("span",{class:"chip chip-dim"},"Step 1 — Out:"), outSel,
      utils.el("span",{class:"chip chip-dim"},"Step 2 — Filters:"), posSel, search, maxPrice, nailedChk,
      utils.el("span",{style:"flex:1"},""),
      utils.el("span",{class:"chip chip-dim"},"Step 3 —"), scoutBtn, resetPlanBtn
    );

    // Big actions
    const btnPickTeam  = utils.el("button",{class:"btn-ghost"},"Pick My Team (no transfers)");
    const btnOptimize3 = utils.el("button",{class:"btn-primary"},"Optimize XI (≤3 transfers)");
    const btnWildcard  = utils.el("button",{class:"btn-primary"},"Wildcard / Free Hit (unlimited)");
    const btnHitAware  = utils.el("button",{class:"btn-ghost"},"Hit-aware (multi, −4 per extra)");

    const actions = utils.el("div",{class:"ap-toolbar-row", style:"margin-top:6px"});
    actions.append(btnPickTeam, btnOptimize3, btnWildcard, btnHitAware);

    const scoutResults = utils.el("div",{class:"mt-8"});
    builder.append(step1, actions, scoutResults);
    shell.append(builder);

    /* ───────────────── Boards ───────────────── */
    const midGrid = utils.el("div",{class:"grid cols-2"});
    const leftCol  = utils.el("div",{class:"card"});
    const rightCol = utils.el("div",{class:"card"});
    shell.append(midGrid);
    midGrid.append(leftCol, rightCol);

    leftCol.append(utils.el("h3",{},"Current Squad (unchanged)"));
    rightCol.append(utils.el("h3",{},"Future Squad (plan)"));

    const curTotals = utils.el("div",{class:"chips"});
    const planTotals = utils.el("div",{class:"chips"});

    const curPitch = utils.el("div");
    const curBench = utils.el("div");
    const planPitch = utils.el("div");
    const planBench = utils.el("div");

    leftCol.append(curTotals, curPitch, utils.el("h4",{class:"mt-8"},"Bench"), curBench);
    rightCol.append(planTotals, planPitch, utils.el("h4",{class:"mt-8"},"Bench"), planBench);

    function renderPitch(into, pick){
      into.innerHTML = "";
      const pitch = utils.el("div",{
        style: `
          border-radius:14px; padding:12px; margin-top:6px;
          background: linear-gradient(180deg, rgba(46,139,87,0.35), rgba(46,139,87,0.18));
          border:1px solid rgba(255,255,255,0.06);
          display:flex; flex-direction:column; gap:14px;
          min-height: 420px; justify-content:space-between;
        `
      });

      const row = (list, label)=>{
        const r = utils.el("div",{style:"display:flex; justify-content:center; gap:10px; min-height:95px; align-items:center;"});
        list.forEach(p=> r.append(playerCard(p, "md")));
        const wrap = utils.el("div");
        wrap.append(utils.el("div",{class:"legend small mb-8", style:"text-align:center"}, label), r);
        return wrap;
      };

      const need = pick.need;
      const xi = pick.xi;
      const gk  = xi.filter(p=>p.pos==="GKP");
      const def = xi.filter(p=>p.pos==="DEF").slice(0,need.DEF);
      const mid = xi.filter(p=>p.pos==="MID").slice(0,need.MID);
      const fwd = xi.filter(p=>p.pos==="FWD").slice(0,need.FWD);

      pitch.append(
        row(gk,  "Goalkeeper (1)"),
        row(def, `Defenders (${need.DEF})`),
        row(mid, `Midfielders (${need.MID})`),
        row(fwd, `Forwards (${need.FWD})`)
      );
      into.append(pitch);
    }
    function renderBench(into, bench){
      into.innerHTML = "";
      const row = utils.el("div",{style:"display:flex; flex-wrap:wrap; gap:8px;"});
      bench.forEach(p=> row.append(playerCard(p, "sm")));
      into.append(row);
    }

    function updateBankChips(){
      const bankChip = document.getElementById("bankChip");
      if (bankChip) bankChip.textContent = `Bank: ${money(bankPlan)}`;
    }
    function refreshOutSel(){
      outSel.innerHTML = planSquad
        .map(s=>`<option value="${s.id}">${s.name} — ${s.pos} ${s.team} (${s.isStart?"XI":"Bench"}, ${money(s.price)})</option>`)
        .join("");
    }

    async function refreshAll(recompute=false){
      await enrichXPForSquad(baseSquad, wins(), byId);
      await enrichXPForSquad(planSquad, wins(), byId);

      const curPick = autoPickBestXI(baseSquad) || { xi: baseSquad.filter(p=>p.isStart), need:{GKP:1,DEF:4,MID:3,FWD:3}, total: sum(baseSquad.filter(p=>p.isStart), "_xpNext") };
      curTotals.innerHTML = "";
      curTotals.append(utils.el("span",{class:"chip chip-accent"},`XI xP (Next): ${curPick.total.toFixed(2)}`));
      renderPitch(curPitch, curPick);
      const curBenchList = baseSquad.filter(p=>!curPick.xi.some(x=>x.id===p.id)).sort((a,b)=> (b._xpNext||0)-(a._xpNext||0));
      renderBench(curBench, curBenchList);

      const planPick = autoPickBestXI(planSquad);
      planTotals.innerHTML = "";
      planTotals.append(
        utils.el("span",{class:"chip chip-accent"},`XI xP (Next): ${planPick ? planPick.total.toFixed(2) : "—"}`),
        planPick ? utils.el("span",{class:"chip"},`Formation: ${planPick.formation}`) : ""
      );
      if (planPick) renderPitch(planPitch, planPick); else planPitch.innerHTML = "";
      const planBenchList = planPick ? planSquad.filter(p=>!planPick.xi.some(x=>x.id===p.id)).sort((a,b)=> (b._xpNext||0)-(a._xpNext||0)) : [];
      renderBench(planBench, planBenchList);

      refreshOutSel();
      updateBankChips();

      if (!explainBox.textContent?.trim()){
        explainBox.textContent = "Planner ready. Actions only change the Future board; Current board stays as-is. Use Cancel if a run takes too long.";
      }
    }

    /* ── Initialize Future board as BEST XI for NEXT GW ── */
    await enrichXPForSquad(planSquad, wins(), byId);
    const initPick = autoPickBestXI(planSquad);
    if (initPick) {
      const ids = initPick.xiIds;
      planSquad.forEach(p => { p.isStart = ids.has(p.id); });
    }

    /* ───────────────── actions ───────────────── */

    resetPlanBtn.addEventListener("click", async ()=>{
      lockUI("Resetting plan…");
      try{
        planSquad = cloneSquad(baseSquad);
        bankPlan  = bankBaseInit;
        explainBox.textContent = "";
        await enrichXPForSquad(planSquad, wins(), byId);
        const p0 = autoPickBestXI(planSquad);
        if (p0) {
          const ids = p0.xiIds;
          planSquad.forEach(p => { p.isStart = ids.has(p.id); });
        }
        await refreshAll(false);
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    scoutBtn.addEventListener("click", async ()=>{
      const outId = +outSel.value;
      const out = planSquad.find(s=>s.id===outId);
      if (!out) return;

      lockUI("Scouting replacements…");
      try{
        await enrichXPForSquad([{...out}], wins(), byId);
        const preferNailed = nailedChk.querySelector("input").checked;
        const budget = maxPrice.value ? parseFloat(maxPrice.value) : +(bankPlan + out.price).toFixed(1);
        const posFilter = +posSel.value || null;
        const q = search.value.trim().toLowerCase();
        const after = planSquad.filter(p=>p.id!==out.id);

        const rows = await suggestReplacements(out, players, teamsById, posById, wins(), preferNailed, budget, q, posFilter, after);

        const cols = [
          { header:"Apply", cell:r=>{
            const b = utils.el("button",{class:"btn-primary"},"Apply to Plan");
            b.addEventListener("click", async ()=>{
              lockUI("Applying…");
              try{
                const idx = planSquad.findIndex(p=>p.id===out.id);
                if (idx>=0 && !planSquad.some(p=>p.id===r.id)){
                  planSquad[idx] = { id:r.id,name:r.name,pos:r.pos,team:r.team,teamId:r.teamId,price:r.price,isStart:planSquad[idx].isStart,_xmins:r._xmins,_xpNext:r._xp };
                  bankPlan = +(bankPlan + out.price - r.price).toFixed(1);

                  const beforePick = autoPickBestXI(baseSquad);
                  const afterPick  = autoPickBestXI(planSquad);
                  writeupExplain(explainBox, "Applied 1-for-1 suggestion", {
                    context: `Replaced ${out.name} with ${r.name} for GW${planGwClamped}.`,
                    formation: afterPick?.formation,
                    before: beforePick?.total || 0,
                    after: afterPick?.total || 0,
                    moves: [{ out, in: r, delta: (r._xp - (out._xpNext||0)) }]
                  });

                  await refreshAll(false);
                }
              }catch(e){ if (!e.isCancel) console.error(e); }
              unlockUI();
            });
            return b;
          }},
          { header:"Name", accessor:r=>r.name },
          { header:"Pos", accessor:r=>r.pos },
          { header:"Team", accessor:r=>r.team },
          { header:"Price", accessor:r=>r.price, cell:r=> money(r.price) },
          { header:`xP (Next ${windowLen})`, accessor:r=>r._xp, cell:r=> r._xp.toFixed(2) },
          { header:"ΔxP vs out", accessor:r=>r._delta, cell:r=> r._delta.toFixed(2) },
          { header:"xMins", cell:r=> badgeXMins(r._xmins||0) }
        ];

        scoutResults.innerHTML = "";
        scoutResults.append(utils.el("h4",{},"Top 3 suggestions"), ui.table(cols, rows));
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    btnPickTeam.addEventListener("click", async ()=>{
      lockUI("Picking best XI from current squad…");
      try{
        planSquad = cloneSquad(baseSquad);
        bankPlan  = bankBaseInit;
        await enrichXPForSquad(planSquad, wins(), byId);
        const beforePick = autoPickBestXI(baseSquad);
        const afterPick  = autoPickBestXI(planSquad);
        if (afterPick){
          const ids = afterPick.xiIds;
          planSquad.forEach(p => { p.isStart = ids.has(p.id); });
        }
        writeupExplain(explainBox, "Pick My Team (no transfers)", {
          context: `Auto-picked your best XI and formation from your existing 15 for GW${planGwClamped}.`,
          formation: afterPick?.formation,
          before: beforePick?.total || 0,
          after: afterPick?.total || 0,
          note: "Only the Future board is updated."
        });
        await refreshAll(false);
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    btnOptimize3.addEventListener("click", async ()=>{
      lockUI("Optimizing XI (≤3 transfers)…");
      try{
        planSquad = cloneSquad(baseSquad);
        bankPlan  = bankBaseInit;
        await enrichXPForSquad(planSquad, wins(), byId);
        const beforePick = autoPickBestXI(planSquad);
        const { plan, applied, best, bank } = await greedyImproveXI(planSquad, players, byId, teamsById, posById, wins(), 3, bankPlan);
        planSquad = plan; bankPlan = bank;

        writeupExplain(explainBox, "Optimize XI (≤3 transfers)", {
          context: `Chose up to three upgrades that maximized xP for GW${planGwClamped}, respecting budget and 3-per-club. No duplicates allowed.`,
          formation: best?.formation,
          before: beforePick?.total || 0,
          after: best?.total || 0,
          moves: applied.map(m=>({ out:m.out, in:m.inRow, delta:m.delta }))
        });
        await refreshAll(false);
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    btnWildcard.addEventListener("click", async ()=>{
      lockUI("Building wildcard / free hit XI…");
      try{
        await enrichXPForSquad(baseSquad, wins(), byId);
        const curPick  = autoPickBestXI(baseSquad) || {xi:[], total:0};
        const xiBudget = +(sum(curPick.xi,"price") + bankBaseInit).toFixed(1);

        const best = await wildcardXI(players, teamsById, posById, wins(), xiBudget);
        if (!best){ unlockUI(); openModal("Wildcard / Free Hit", utils.el("div",{},"Couldn’t form a valid XI under the derived budget.")); return; }

        const newXIIds = new Set(best.pick.map(p=>p.id));
        planSquad = [
          ...best.pick.map(p=>({ id:p.id,name:p.name,pos:p.pos,team:p.team,teamId:p.teamId,price:p.price,isStart:true,_xmins:p._xmins,_xpNext:p._xpNext })),
          ...baseSquad.filter(b=>!newXIIds.has(b.id)).map(b=>({...b, isStart:false}))
        ];
        bankPlan = +(xiBudget - best.pick.reduce((a,b)=>a+(b.price||0),0)).toFixed(1);

        writeupExplain(explainBox, "Wildcard / Free Hit (unlimited)", {
          context: `Constructed a new XI from the full player pool for GW${planGwClamped}. Budget = current XI value + bank. Club cap 3 enforced.`,
          formation: best.formation,
          before: curPick.total || 0,
          after: best.total || 0,
          note: `Spend: ${money(best.spend)} of ${money(xiBudget)}.`
        });
        await refreshAll(false);
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    btnHitAware.addEventListener("click", async ()=>{
      lockUI("Searching hit-aware upgrades…");
      try{
        planSquad = cloneSquad(baseSquad);
        bankPlan  = bankBaseInit;

        const beforePick = autoPickBestXI(baseSquad);
        const { plan, best, applied, penalty, netGain, bank } =
          await hitAwareImproveUnlimited(baseSquad, players, byId, teamsById, posById, wins(), bankPlan);
        planSquad = plan; bankPlan = bank;

        writeupExplain(explainBox, "Hit-aware optimization (multi, −4 per extra)", {
          context: `Added moves while each step’s ΔxP covered the −4 hit beyond 1 free transfer for GW${planGwClamped}.`,
          formation: best?.formation,
          before: beforePick?.total || 0,
          after: best?.total || 0,
          penalty,
          moves: applied
        });
        await refreshAll(false);
      }catch(e){ if (!e.isCancel) console.error(e); }
      unlockUI();
    });

    // initial render
    lockUI("Preparing planner…");
    try { await refreshAll(false); } catch(e){ if (!e.isCancel) console.error(e); }
    unlockUI();

  }catch(err){
    ui.mount(main, ui.error("Failed to load Planner", err));
  }
}
