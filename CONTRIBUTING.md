# Contributing to FPL Assistant

Thanks for helping improve the dashboard! This guide keeps contributions consistent and production-ready.

## Workflow

1. **Branching:** Use feature branches from `main` (e.g., `feat/player-photos`, `fix/status-bar`).
2. **Proxy config:** Point the app at your Worker via `config.local.js`:
   ```js
   window.__FPL_API_BASE__ = "https://your-worker.example.com/api";
   ```
3. **Run checks locally:**
   ```bash
   npm run lint
   npm run format
   npm test
   ```
4. **Commits:** Write descriptive messages (imperative mood). Keep diffs focused and DRY.
5. **Pull Requests:** Summarize user-facing changes, testing performed, and any caveats. Include screenshots for UI tweaks when possible.

## Coding Standards

- **JavaScript:** ES2023 modules, no globals beyond `window` configuration. Prefer small, single-purpose functions and meaningful naming.
- **Styling:** Use the shared tokens (spacing, typography, color variables) in `styles.css`. Avoid inline styles; prefer utility classes or shared components.
- **Accessibility:** Ensure focusable controls, touch-friendly hit areas, and ARIA labels for navigation/icons.
- **Images:** Always route player photos through the Worker endpoint `/api/player-photo/:photoId`; attach fallbacks via `applyImageFallback`.
- **Error states:** Use the shared state blocks (empty/error/offline) for consistent messaging and retry affordances.
- **Imports:** Never wrap imports in `try/catch`. Keep relative paths explicit.

## Tests

- Unit tests live under `tests/` and run via `npm test` (custom lightweight runner).
- Add tests for critical helpers when changing routing, image resolution, or configuration logic.

## Documentation

- Update the README when you add/modify major behavior, routes, or setup steps.
- Keep comments concise and actionable; prefer clear code over verbose comments.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
