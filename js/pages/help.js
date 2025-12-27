// js/pages/help.js
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { state } from "../state.js";

export function renderHelp(main){
  main.innerHTML = "";

  const page = utils.el("div", { class: "help-page" });

  // --- Quick start ----------------------------------------------------------
  page.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Quick Start"),
    utils.el("ol",{},[
      utils.el("li",{},"Enter your FPL Entry ID in the left sidebar (and press Save)."),
      utils.el("li",{},"Optionally add one or more Classic League IDs (comma-separated)."),
      utils.el("li",{},"Use the top navigation to explore: My Team → Players → Fixtures → Explorer → League."),
      utils.el("li",{},[
        "Use the ", utils.el("b",{},"theme toggle"), " (top right) to switch light/dark mode."
      ]),
    ])
  ]));

  // --- What each page does --------------------------------------------------
  page.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Pages overview"),

    section("My Team", [
      "Your current XI and bench with prices, captain/vice, status and minute-risk badges:",
      bullet([
        ["NAILED / RISK / CAMEO?", "Projected minutes band (hover the badge)."],
        ["Breakdown", "Per-GW point sources (goals, assists, CS, cards, bonus, BPS)."],
        ["Sorting", "Click headers; conditional highlights (big score / zero mins) persist."]
      ])
    ]),

    section("All Players", [
      "Filter & sort the entire pool; the scatter chart updates with filters.",
      bullet([
        ["Chart", "X = price (m), Y = total points; bubble size ≈ ownership; hover shows player + team."],
        ["xP / xMins", "Enable checkboxes to add expected points (next & next-5) and minute-risk for visible rows."],
        ["Tips", "Use search + position + team + price range; then Apply."]
      ])
    ]),

    section("Fixtures", [
      "Upcoming difficulty matrix and a one-click planner prompt tailored to your squad.",
      bullet([
        ["Window", "Next 3 / 5 / 8 GWs."],
        ["View", "Official FDR or model-based xFDR (position-aware)."],
        ["Options", "Pin my teams, show doubles only, show fixture swings."],
        ["Planner prompt", "Copy either a readable prompt or the readable + JSON appendix for deeper tools."]
      ])
    ]),

    section("GW Explorer", [
      "Finished-GW breakdown for every player.",
      bullet([
        ["Filters", "Pick GW, team, position, search by name; toggles for starters only, my squad only, hauls, and cards."],
        ["Highlights", "Green for big GW scores/bonus; red for zero minutes/cards."],
        ["Extras", "Top scorers and a Team-of-the-Week summary appear above the table."]
      ])
    ]),

    section("Mini-League", [
      "View standings, charts, and league statistics for your classic leagues.",
      bullet([
        ["Expand/Collapse", "Click Expand to see detailed charts and Top XI for each league."],
        ["Charts", "Cumulative total points by GW and per-GW points progression."],
        ["League Top XI", "Most-picked 3-4-3 formation for the last finished GW."]
      ])
    ]),
  ]));

  // --- Keyboard Shortcuts ---------------------------------------------------
  page.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Keyboard Shortcuts"),
    grid([
      ["1","My Team"],
      ["2","Players"],
      ["3","Fixtures"],
      ["4","Explorer"],
      ["5","League"],
      ["6","Help"],
      ["S","Toggle sidebar"],
      ["?","Show this help"]
    ])
  ]));

  // --- Glossary -------------------------------------------------------------
  page.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Glossary (hover acronyms in tables too)"),
    grid([
      ["FDR / xFDR","Official fixture difficulty (1–5) / model-based difficulty"],
      ["xP","Expected points (next GW / next N GWs)"],
      ["xMins","Projected minutes band (NAILED / RISK / CAMEO?)"],
      ["xGI/90","Expected goal involvements per 90 (recent sample)"],
      ["PPM","Points per million (value metric)"],
      ["EO","Effective ownership (approx in your league)"],
      ["CS / GC","Clean sheet / Goals conceded"],
      ["YC / RC","Yellow / Red card"],
      ["BPS","Bonus Point System score (drives bonus)"],
      ["BB / FH / WC / TC","Bench Boost / Free Hit / Wildcard / Triple Captain"]
    ])
  ]));

  // --- Tips & Troubleshooting ----------------------------------------------
  page.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Tips & troubleshooting"),
    utils.el("ul",{},[
      li("If you see “ERR_BLOCKED_BY_CLIENT” or requests fail, pause ad-blocking on your local site/workers.dev."),
      li("This app uses confirmed GWs only; numbers update after FPL marks a GW as finished."),
      li("Sorting: click column headers; click again to toggle direction."),
      li("Long computations (xP/xGI) run only for currently visible rows to stay snappy."),
      li("Change theme anytime with the top-right button.")
    ]),
    utils.el("div",{class:"tag"}, `Current Entry ID: ${state.entryId || "—"} | Leagues: ${Array.isArray(state.leagueIds)? state.leagueIds.join(", ") || "—" : "—"}`)
  ]));

  ui.mount(main, page);
}

/* ---------- tiny helpers for nicer layout ---------- */

function section(title, parts){
  const box = utils.el("div",{style:"margin:10px 0"});
  box.append(utils.el("h4",{},title));
  parts.forEach(p=>{
    if (typeof p === "string") box.append(utils.el("p",{},p));
    else box.append(p);
  });
  return box;
}
function bullet(rows){
  const ul = utils.el("ul",{class:"bullets"});
  rows.forEach(([k,v])=>{
    ul.append(utils.el("li",{},[utils.el("b",{},`${k}: `), v]));
  });
  return ul;
}
function grid(items){
  const wrap = utils.el("div",{class:"grid cols-3"});
  items.forEach(([k,v])=>{
    const cell = utils.el("div",{class:"metric"});
    cell.append(utils.el("div",{class:"label"},k), utils.el("div",{class:"value"},v));
    wrap.append(cell);
  });
  return wrap;
}
function li(text){ return utils.el("li",{},text); }
