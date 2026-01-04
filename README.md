# FPL Assistant

Modern, live-aware Fantasy Premier League companion that runs entirely in the browser and talks to the official API through a Cloudflare Worker proxy.

## Highlights
- **Reliable headshots** via the built-in player photo proxy (no CORS issues).
- **Live-aware dashboards** for portals, fixtures, and player profiles.
- **Rich player explorer** with filters, comparisons, and EO/xP helpers.
- **Offline-friendly** with service-worker caching and clear status badges.
- **Accessible UI** with consistent typography, spacing, and button styles.

## Screenshots
- Portal and navigation: _TBD_ (add updated screenshots after deployment).
- Player profile with live GW breakdown: _TBD_.

## Getting Started
```bash
git clone https://github.com/EmptyCornmeal/fpl-assistant.git
cd fpl-assistant
npm install
npm run test      # optional: run unit tests
npm run lint      # lint the codebase
npm run format    # format with Prettier
```

To run locally, serve the repo root (e.g., with `npx serve .`) and point `window.__FPL_API_BASE__` to your deployed worker (or use the same-origin `/api` path when running behind Wrangler).

## Usage
- Configure your API base via `window.__FPL_API_BASE__` or `localStorage.setItem('fpl.apiBase', '<worker-url>/api')`.
- Enter your FPL entry ID and optional classic league IDs in the sidebar.
- Click any player name or image to open the canonical player profile with live/previous GW breakdowns.
- Use the global search (`/` shortcut) to jump to players, teams, or pages quickly.

## Features
- Portal with deadline timer, cached/offline awareness, and pinned items.
- My Team view with EO/xP hints, fixture ease, and captaincy nudges.
- All Players explorer with comparisons, filters, and price change hints.
- Fixtures, GW Explorer, Stat Picker, Mini-League, and Help pages.
- Robust image proxy for player photos and team badges.

## Roadmap
- Add snapshot downloads for squads and transfer plans.
- Dark/light theme persistence upgrades.
- Extended accessibility audit and keyboard coverage.
- Automated visual regression coverage.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, branching, and review expectations.

## License
MIT License. See [LICENSE](LICENSE) for details (or add your preferred license here).
