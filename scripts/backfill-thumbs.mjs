#!/usr/bin/env node
/**
 * Napravi WebP thumbnail i zapiši dimenzije za sve već skinute Facebook slike —
 * i za album fotke (galerija) i za slike uz objave (novosti).
 *
 * Isti posao rade i scraperi u sklopu normalnog scrapea, ali oni traže
 * Facebook token. Ova skripta radi isključivo s onim što je već u repou, pa se
 * može pokrenuti lokalno — za prvo popunjavanje arhive ili kad se promijeni
 * širina thumba pa treba pregenerirati.
 *
 * Pokretanje:  npm run thumbs
 * Postojeći thumbovi se preskaču; `--force` ih pregenerira.
 */

import { readFile, access, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { writeJsonIfChanged } from "./lib/write-json.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Širine moraju ostati usklađene sa scraperima koji rade iste thumbove. */
const SOURCES = [
  {
    label: "albumi",
    json: resolve(ROOT, "src/data/facebook-albums.json"),
    imagesRoot: resolve(ROOT, "public/images/facebook-albums"),
    publicPath: "/images/facebook-albums",
    width: 500, // scrape-facebook-albums.mjs → THUMB_WIDTH
  },
  {
    label: "objave",
    json: resolve(ROOT, "src/data/facebook.json"),
    imagesRoot: resolve(ROOT, "public/images/facebook"),
    publicPath: "/images/facebook",
    width: 700, // scrape-facebook.mjs → THUMB_WIDTH
  },
];

const QUALITY = 78;
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

/**
 * Skupi sve slike iz jednog JSON-a kao zadatke.
 *
 * Album fotke su oduvijek objekti sa `src`, a slike uz objavu su u starijem
 * formatu obični stringovi — te usput pretvaramo u objekte, na mjestu.
 */
function collectJobs(data, source) {
  const jobs = [];

  const add = (list, index) => {
    const value = list[index];
    const photo = typeof value === "string" ? { src: value } : value;
    if (!photo?.src) return;
    list[index] = photo;

    const rel = photo.src.replace(`${source.publicPath}/`, "");
    const base = rel.replace(/\.[^./]+$/, "");
    jobs.push({
      photo,
      file: resolve(source.imagesRoot, rel),
      target: resolve(source.imagesRoot, `${base}.webp`),
      publicThumb: `${source.publicPath}/${base}.webp`,
    });
  };

  for (const album of data.albums ?? []) {
    (album.photos ?? []).forEach((_, i) => add(album.photos, i));
  }
  for (const post of data.posts ?? []) {
    (post.images ?? []).forEach((_, i) => add(post.images, i));
  }
  return jobs;
}

async function processSource(source) {
  let data;
  try {
    data = JSON.parse(await readFile(source.json, "utf8"));
  } catch {
    console.log(`[thumbs] ${source.label}: nema ${source.json}, preskačem`);
    return;
  }

  const jobs = collectJobs(data, source);
  if (jobs.length === 0) {
    console.log(`[thumbs] ${source.label}: nema slika`);
    return;
  }

  let made = 0;
  let reused = 0;
  let missing = 0;
  let failed = 0;

  await inParallel(jobs, CONCURRENCY, async (job) => {
    if (!(await exists(job.file))) {
      missing++;
      return;
    }
    if (FORCE && (await exists(job.target))) await unlink(job.target);

    try {
      if (await exists(job.target)) {
        reused++;
      } else {
        await sharp(job.file)
          .resize({ width: source.width, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(job.target);
        made++;
      }
      const { width, height } = await sharp(job.target).metadata();
      job.photo.thumb = job.publicThumb;
      job.photo.width = width ?? null;
      job.photo.height = height ?? null;
    } catch (err) {
      console.warn(`[thumbs] WARN ${job.publicThumb}: ${err.message}`);
      failed++;
    }
  });

  await writeJsonIfChanged(source.json, data, { label: "[thumbs]" });
  console.log(
    `[thumbs] ${source.label}: ${jobs.length} slika · novih ${made} · ` +
      `postojećih ${reused} · bez originala ${missing} · greške ${failed}`,
  );
}

async function main() {
  const startedAt = Date.now();
  for (const source of SOURCES) {
    console.log(`[thumbs] ${source.label} · širina ${source.width}px q${QUALITY}`);
    await processSource(source);
  }
  console.log(`[thumbs] gotovo za ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("[thumbs] GREŠKA:", err);
  process.exit(1);
});
