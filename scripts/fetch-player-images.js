#!/usr/bin/env node
// Fetch all player headshots and cache into assets/players/p<photoId>.png
// Uses the public FPL bootstrap for the list of photo IDs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "players");

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const bootstrapUrl = "https://fantasy.premierleague.com/api/bootstrap-static/";
  console.log("Fetching bootstrap ...");
  const bsRes = await fetch(bootstrapUrl, { headers: { "User-Agent": "fpl-assistant/worker" } });
  if (!bsRes.ok) throw new Error(`Bootstrap fetch failed: ${bsRes.status}`);
  const bs = await bsRes.json();
  const photos = Array.from(new Set((bs.elements || []).map((el) => String(el.photo || "").replace(/\.jpg$/i, "")))).filter(Boolean);
  console.log(`Found ${photos.length} players.`);

  const limit = 6;
  let idx = 0;
  let fetched = 0;
  const queue = [...photos];

  const worker = async () => {
    while (queue.length) {
      const photoId = queue.shift();
      idx += 1;
      const filename = `p${photoId}.png`;
      const dest = path.join(OUT_DIR, filename);
      if (fs.existsSync(dest)) {
        continue;
      }
      const url = `https://resources.premierleague.com/premierleague/photos/players/250x250/p${photoId}.png`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "fpl-assistant/cache" } });
        if (!res.ok) {
          console.warn(`Skip ${photoId} (${res.status})`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(dest, buf);
        fetched += 1;
        if (fetched % 25 === 0) console.log(`Saved ${fetched} images so far...`);
      } catch (err) {
        console.warn(`Fetch failed for ${photoId}: ${err.message}`);
        await delay(100);
      }
      await delay(40); // gentle pacing
    }
  };

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  console.log(`Done. Downloaded ${fetched} new images.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
