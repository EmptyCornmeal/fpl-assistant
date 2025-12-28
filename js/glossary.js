// Known abbreviations -> human definitions with FPL decision context
export const GLOSSARY = {
    // Core game concepts
    "GW": "Gameweek — a round of Premier League fixtures. Deadline is when you must finalize your team.",
    "DGW": "Double Gameweek — a team has two fixtures in one GW. Great for captain picks and Bench Boost.",
    "BGW": "Blank Gameweek — no fixture for a team. Avoid these players unless you have bench cover.",
    "FT": "Free Transfers — you get 1 per week (max 2). Extra transfers cost -4 points each.",
    "BB": "Bench Boost chip — all 15 players score. Best used in DGWs when bench has good fixtures.",
    "FH": "Free Hit chip — unlimited transfers for one GW only. Great for BGWs or DGWs.",
    "TC": "Triple Captain chip — captain earns 3× points instead of 2×. Best on a fixture-proof premium in a DGW.",
    "WC": "Wildcard chip — unlimited free transfers that persist. Use to restructure your squad.",
    "H/A": "Home/Away indicator — home teams historically score more points due to crowd advantage.",

    // Key metrics explained with FPL decision context
    "PPG": "Points Per Game — average FPL points scored per match played. Use this to compare value between players across different price brackets. Higher PPG = more consistent returns.",
    "Form": "Recent form — average points over the last 5 gameweeks. Shows current hot/cold streaks. High form (5+) suggests the player is in good rhythm; low form (<3) may indicate poor fitness or tactics.",
    "FDR": "Fixture Difficulty Rating — FPL's 1-5 scale for opponent strength. 1-2 = easy (target these), 3 = neutral, 4-5 = hard (avoid or bench). Plan transfers around favorable fixture swings.",
    "EO": "Effective Ownership — % of managers owning a player, with captaincy weighted 2×. High EO (>30%) = template pick (safe), Low EO (<10%) = differential (high risk/reward).",
    "CS": "Clean Sheet — 4 pts for DEF/GKP, 1 pt for MID if their team concedes 0 goals. Target defenders from top-6 teams with easy fixtures.",

    // Advanced stats
    "BPS": "Bonus Points System — the underlying score that determines 1-3 bonus points per match. Key actions: goals, assists, tackles, clearances, saves. High BPS means consistent bonus potential.",
    "ICT": "Influence, Creativity, Threat Index — FPL's combined metric measuring match impact. Influence = goal involvement, Creativity = chance creation, Threat = goal likelihood. Higher ICT suggests underlying performance even without returns.",
    "xG": "Expected Goals — statistical measure of shot quality. xG of 0.3 means a 30% chance of scoring from that shot. Useful to spot players who are 'due' returns or overperforming.",
    "xA": "Expected Assists — probability that a pass leads to a goal based on the resulting shot quality. High xA shows a player creates quality chances.",
    "xGI": "Expected Goal Involvement (xG + xA) — combined attacking threat. Compare to actual G+A: if xGI > actual, player is unlucky and may improve; if xGI < actual, they're overperforming.",
    "xGI/90": "Expected goal involvements per 90 minutes — normalizes xGI by playing time. Essential for comparing part-time starters to regulars.",

    // Projections
    "xP": "Expected Points — projected points based on xGI, clean sheet probability, minutes expectation, and bonus likelihood. Use to identify optimal captain picks and transfer targets.",
    "xPts": "Expected Points — same as xP. Our model considers form, fixture difficulty, and historical data to estimate upcoming returns.",
    "xMins": "Projected Minutes — estimated playing time based on recent starts, sub patterns, and availability status. 90 = nailed, 60-89 = rotation risk, <60 = bench player.",
    "PP90": "Points per 90 minutes — standardizes scoring rate regardless of minutes played. Good for identifying effective players with limited gametime who might play more.",

    // Other useful terms
    GC: "Goals Conceded — negative for defenders (affects CS). Target defenders from teams with low GC.",
    YC: "Yellow Cards — costs -1 point. Avoid serial offenders, especially DEF/MID.",
    RC: "Red Cards — costs -3 points. Rare but devastating; check player discipline history.",
  };
  