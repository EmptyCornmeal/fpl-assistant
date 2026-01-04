#!/usr/bin/env node
// Generate placeholder headshots for a fixed ID range into assets/players.
// This avoids broken faces even when CDN fetches fail or are blocked offline.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "players");
const START_ID = 1;
const END_ID = 900; // Covers current season headshots comfortably

const colors = ["#10B981", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#22D3EE", "#F43F5E"];

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  for (let id = START_ID; id <= END_ID; id++) {
    const file = path.join(OUT_DIR, `p${id}.svg`);
    if (fs.existsSync(file)) continue;
    const color = colors[id % colors.length];
    const initials = `P${id}`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>
      <defs>
        <linearGradient id='g${id}' x1='0%' y1='0%' x2='100%' y2='100%'>
          <stop stop-color='${color}' offset='0%'/>
          <stop stop-color='#0f172a' offset='100%'/>
        </linearGradient>
      </defs>
      <rect width='120' height='120' rx='16' fill='url(#g${id})'/>
      <circle cx='60' cy='48' r='24' fill='rgba(255,255,255,0.16)'/>
      <rect x='32' y='76' width='56' height='32' rx='12' fill='rgba(255,255,255,0.08)'/>
      <text x='60' y='70' text-anchor='middle' fill='#E2E8F0' font-family='Inter, sans-serif' font-size='22' font-weight='700'>${initials}</text>
    </svg>`;
    await fs.promises.writeFile(file, svg, "utf8");
  }
  console.log(`Generated placeholders for IDs ${START_ID}-${END_ID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
