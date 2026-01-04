# Contributing Guide

Thanks for helping improve FPL Assistant! This document outlines expectations for contributions so we can ship quickly and safely.

## Development Workflow
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create a feature branch** off `main`.
3. **Write code + tests**. Keep functions small and single-purpose; avoid duplication.
4. **Lint & format**
   ```bash
   npm run lint
   npm run format
   ```
5. **Run tests**
   ```bash
   npm test
   ```
6. **Commit with a clear message** and open a PR.

## Code Style
- ES modules, modern syntax (ES2022).
- Prettier formatting (`npm run format`).
- ESLint rules live in `eslint.config.js`; fix or justify warnings.
- No inline styles; prefer CSS variables and shared classes.
- Use shared button/card styles and respect the design tokens in `styles.css`.
- Never wrap imports in `try/catch`.

## UI & Accessibility
- Ensure touch targets are comfortable (≥40px where possible).
- Provide focus states and `aria-label` where appropriate.
- Avoid text clipping; allow wrapping or provide tooltips.
- Use the image proxy helper (`getPlayerImage`) for all player photos.

## Testing
- Add unit tests for non-trivial logic using the lightweight runner in `tests/`.
- Prefer pure functions and deterministic outputs.
- Keep network interactions behind the API layer so they can be mocked or stubbed.

## Pull Requests
- Include a summary of changes and testing performed.
- Link issues when applicable.
- Avoid unrelated refactors in the same PR.

## Reporting Issues
Please include:
- Expected vs actual behaviour
- Steps to reproduce
- Environment (browser, OS)
- Screenshots or logs if relevant

Thank you for contributing!
