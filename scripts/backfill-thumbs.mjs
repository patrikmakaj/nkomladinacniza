#!/usr/bin/env node
/**
 * Napravi thumbnail za svaku već skinutu album fotku i upiši `thumb` putanje
 * u src/data/facebook-albums.json.
 *
 * Isti posao radi i `scrape-facebook-albums.mjs` u sklopu normalnog scrapea,
 * ali on traži Facebook token. Ova skripta radi isključivo s onim što je već
 * u repou, pa se može pokrenuti lokalno — za prvo popunjavanje arhive ili kad
 * se promijeni THUMB_WIDTH pa treba pregenerirati.
 *
 * Pokretanje:  npm run thumbs
 * Postojeći thumbovi se preskaču; `--force` ih pregenerira.
 */

import { readFile, writeFile, access, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const JSON_PATH = resolve(ROOT, "src/data/facebook-albums.json");
const IMAGES_ROOT = resolve(ROOT, "public/images/facebook-albums");
const PUBLIC_IMAGE_PATH = "/images/facebook-albums";

// Mora ostati usklađeno sa scrape-facebook-albums.mjs
const THUMB_WIDTH = 500;
const THUMB_QUALITY = 78;
const CONCURRENCY = 8;

const FORCE = process.argv.includes("--force");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Obrađuje `items` s najviše `limit` paralelnih zadataka. */
async function inParallel(items, limit, worker) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await worker(items[idx], idx);
      }
    }),
  );
}

async function main() {
  const startedAt = Date.now();
  const data = JSON.parse(await readFile(JSON_PATH, "utf8"));
  const albums = data.albums ?? [];

  // Sve fotke iz JSON-a, uz album kojem pripadaju
  const jobs = [];
  for (const album of albums) {
    for (const photo of album.photos ?? []) {
      // `src` je oblika /images/facebook-albums/<albumDir>/<file>.jpg
      const rel = photo.src.replace(`${PUBLIC_IMAGE_PATH}/`, "");
      const source = resolve(IMAGES_ROOT, rel);
      const base = rel.replace(/\.[^./]+$/, "");
      jobs.push({
        photo,
        source,
        target: resolve(IMAGES_ROOT, `${base}.webp`),
        publicPath: `${PUBLIC_IMAGE_PATH}/${base}.webp`,
      });
    }
  }

  console.log(`[thumbs] ${jobs.length} fotki u JSON-u · širina ${THUMB_WIDTH}px q${THUMB_QUALITY}`);

  let made = 0;
  let reused = 0;
  let missing = 0;
  let failed = 0;

  await inParallel(jobs, CONCURRENCY, async (job) => {
    if (!(await exists(job.source))) {
      missing++;
      return;
    }
    if (FORCE && (await exists(job.target))) await unlink(job.target);

    if (await exists(job.target)) {
      reused++;
    } else {
      try {
        await sharp(job.source)
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY })
          .toFile(job.target);
        made++;
      } catch (err) {
        console.warn(`[thumbs] WARN ${job.publicPath}: ${err.message}`);
        failed++;
        return;
      }
    }
    job.photo.thumb = job.publicPath;
  });

  await writeFile(JSON_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[thumbs] gotovo za ${secs}s · novih ${made} · postojećih ${reused} · ` +
      `bez originala ${missing} · greške ${failed}`,
  );
  console.log(`[thumbs] zapisano: ${JSON_PATH}`);
}

main().catch((err) => {
  console.error("[thumbs] GREŠKA:", err);
  process.exit(1);
});
