// js/lib/xp.js
// Lightweight, transparent Expected Points (xP) helpers.
// Uses last-finished GWs only (no live), recent form (last 5), and FDR-based fixture weighting.

import { api } from "../api.js";
import { state } from "../state.js";

// simple in-tab cache
const _memo = new Map();
const getMemo = (k)=> _memo.get(k);
const setMemo = (k,v)=> _memo.set(k,v);

// -------- Minutes risk --------
export function statusMultiplier(code){
  // a=available, d=doubtful, y=yellow, i=injured, n=not available, s=suspended
  const m = { a:1.0, d:0.9, y:0.85, i:0.6, n:0.6, s:0.7 };
  return m[code] ?? 1.0;
}
export function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

export function badgeForXMins(xmins){
  const r = xmins/90;
  if (r >= 0.9) return {label:"NAILED", cls:"badge-green", hint:`Projected ${Math.round(xmins)}'`};
  if (r >= 0.7) return {label:"RISK", cls:"badge-amber", hint:`Projected ${Math.round(xmins)}'`};
  return {label:"CAMEO?", cls:"badge-red", hint:`Projected ${Math.round(xmins)}'`};
}

// -------- Recent form pull (last 5 finished) --------
export async function recentFromSummary(elementId){
  const key = `sum:${elementId}`;
  const cached = getMemo(key);
  if (cached) return cached;

  const lastFinished = state.bootstrap.events.filter(e=>e.data_checked).slice(-1)[0]?.id || 1;
  const sum = await api.elementSummary(elementId);
  const rows = (sum.history || []).filter(h=>h.round <= lastFinished).slice(-5);
  const mins = rows.reduce((a,b)=>a+(b.minutes||0),0);
  const pts  = rows.reduce((a,b)=>a+(b.total_points||0),0);
  const xgi  = rows.reduce((a,b)=>a+Number(b.expected_goal_involvements||0),0);
  const bps  = rows.reduce((a,b)=>a+Number(b.bps||0),0);

  const out = {
    lastFinished,
    mins, pts, xgi,
    gp: rows.length,
    xgi90: mins ? (xgi/(mins/90)) : 0,
    pts90: mins ? (pts/(mins/90)) : 0,
    bps90: mins ? (bps/(mins/90)) : 0,
    avgMins: rows.length ? (mins/rows.length) : 0
  };
  setMemo(key, out);
  return out;
}

// -------- Fixtures helpers --------
export async function fixturesForTeamWindow(teamId, gwIds){
  const key = `fx:${teamId}:${gwIds.join(",")}`;
  const cached = getMemo(key);
  if (cached) return cached;

  const list = [];
  for (const gw of gwIds){
    const fx = await api.fixtures(gw);
    const mine = fx.filter(f=> f.team_h===teamId || f.team_a===teamId)
      .map(f=>{
        const home = f.team_h===teamId;
        const opp  = home ? f.team_a : f.team_h;
        const fdr  = home ? f.team_h_difficulty : f.team_a_difficulty;
        return { gw, home, opp, fdr };
      });
    list.push(...mine);
  }
  setMemo(key, list);
  return list;
}

export function fdrWeight(fdr){
  // Weight for multi-GW aggregation (ease boosts xP a bit)
  // 2: easy, 3: neutral, 4: tough, 5: very tough
  return ({2:1.10, 3:1.00, 4:0.90, 5:0.82}[fdr] || 1.00);
}

export function pCSfromFDR(fdr, home){
  // Proxy clean-sheet probability from fixture difficulty.
  // Gentle home bonus.
  let base = ({2:0.35, 3:0.25, 4:0.15, 5:0.08}[fdr] || 0.20);
  base += home ? 0.02 : -0.02;
  return clamp(base, 0.02, 0.70);
}

// -------- xP computation --------
function appearanceXP(xmins){
  // Approximate appearance points as expectation between 1 (<=59) and 2 (>=60)
  // Smooth with minutes share
  const r = clamp(xmins/90, 0, 1);
  // 0..59 -> ~1, 60..90 -> ~2
  return r < (60/90) ? 1*r/(60/90) : 1 + (r - 60/90)/(30/90);
}

function bonusStub(bps90){
  // Soft cap to 0.6
  return clamp((bps90||0) / 10 * 0.6, 0, 0.6);
}

export async function estimateXMinsForPlayer(player){
  // player from bootstrap elements
  const statusMult = statusMultiplier(player.status);
  const rec = await recentFromSummary(player.id);
  const avg = rec.avgMins || 60;
  return clamp(avg * statusMult, 0, 90);
}

export async function xPForGw(player, gwId){
  const bs = state.bootstrap;
  const teamId = player.team;
  const posId = player.element_type; // 1 GKP,2 DEF,3 MID,4 FWD
  const xmins = await estimateXMinsForPlayer(player);
  const rec = await recentFromSummary(player.id);
  const fx = await fixturesForTeamWindow(teamId, [gwId]);

  // If no fixture (blank), xP is 0
  if (!fx.length) return { gw: gwId, xP: 0, parts: {appearance:0, attack:0, cs:0, bonus:0}, xmins };

  const f = fx[0];
  // Attack part from xGI
  const attack = (rec.xgi90 * (xmins/90)) * 5; // 5 pts per involvement (mixing G/A)

  // CS part
  const pCS = pCSfromFDR(f.fdr, f.home);
  const csPts = (posId===2||posId===1) ? 4 : (posId===3 ? 1 : 0); // DEF/GKP=4, MID=1, FWD=0
  const cs = pCS * csPts;

  const appearance = appearanceXP(xmins);
  const bonus = bonusStub(rec.bps90);

  const raw = appearance + attack + cs + bonus;
  const weighted = raw * fdrWeight(f.fdr);

  return { gw: gwId, xP: weighted, parts: {appearance, attack, cs, bonus}, xmins, fdr:f.fdr, home:f.home };
}

export async function xPWindow(player, gwIds){
  let total = 0;
  const parts = {appearance:0, attack:0, cs:0, bonus:0};
  const perGw = [];
  for (const gw of gwIds){
    const r = await xPForGw(player, gw);
    total += r.xP;
    parts.appearance += r.parts.appearance;
    parts.attack     += r.parts.attack;
    parts.cs         += r.parts.cs;
    parts.bonus      += r.parts.bonus;
    perGw.push(r);
  }
  return { total, parts, perGw };
}
