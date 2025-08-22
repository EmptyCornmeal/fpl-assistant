export function renderHelp(main){
    main.innerHTML = "";
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <h3>How to Use This Dashboard</h3>
      <ul>
        <li><b>My Team</b> — Your current squad: captain/vice, prices, status, GW points. Click <i>Breakdown</i> for point sources.</li>
        <li><b>All Players</b> — Filter & sort the full player pool. Chart updates with filters. Hover dots to see player names; size = ownership. Optional xGI/90 (last 5) estimator.</li>
        <li><b>Fixtures</b> — Difficulty matrix for upcoming GWs. Generates a clean planner prompt (readable, plus optional JSON appendix) tailored to your squad.</li>
        <li><b>GW Explorer</b> — Per-GW points table across all players. Sortable with conditional highlights (double-digits, bonus, DNP).</li>
        <li><b>Planner</b> — Simulate 1-FT transfers. Suggestions rank by form, last-5 p/90, and fixture ease. Enforces budget and 3-per-team rule.</li>
        <li><b>Mini-League</b> — See standings for all the league IDs you enter (comma-separated). Includes a points-over-time chart (top 5 + you).</li>
      </ul>
      <p>Tips: Use the <b>Theme</b> button (top right). Hover acronyms (FDR, EO, CS, xGI…) for definitions. Data refreshes on page load; confirmed GWs only.</p>
    `;
    main.append(div);
  }
  