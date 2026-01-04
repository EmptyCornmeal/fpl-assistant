# Player headshot cache

This folder is reserved for pre-bundled player images (`p<photoId>.png`, 250x250). The app will:

- Request photos through the Cloudflare Worker endpoint `/api/player-photo/:photoId`.
- If the worker responds with 404, attempt to load `assets/players/p<photoId>.png`.
- Finally fall back to the shared SVG placeholder.

To keep every player covered for offline/edge cases, drop any missing headshots here using the naming convention above.
