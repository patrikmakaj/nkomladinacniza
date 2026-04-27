#!/usr/bin/env node
/**
 * Facebook Graph API scraper za FB albume NK Omladinac Niza
 *
 * Dohvaća sve albume sa Facebook stranice kluba kroz Graph API,
 * skida fotografije (cover + sve photos) lokalno i sprema strukturiran
 * JSON u src/data/facebook-albums.json.
 *
 * Pokreće se kroz GitHub Action kao dio `npm run scrape`, ili
 * lokalno preko `npm run scrape:fb-albums`.
 *
 * Environment varijable (obje obavezne za stvarni scrape):
 *   FB_PAGE_ID       — ID Facebook stranice
 *   FB_ACCESS_TOKEN  — Long-lived Page Access Token (treba pages_show_list)
 *
 * Ako varijable nisu postavljene, script piše prazan JSON i izlazi
 * uspješno (build se ne ruši).
 */

import { writeFile, mkdir, access, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_JSON = resolve(ROOT, "src/data/facebook-albums.json");
const IMAGES_ROOT = resolve(ROOT, "public/images/facebook-albums");
const PUBLIC_IMAGE_PATH = "/images/facebook-albums";

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_ACCESS_TOKEN;
const API_VERSION = "v21.0";

// Koliko albuma i fotki po albumu maksimalno povlačimo
const ALBUM_LIMIT = 30;
const PHOTOS_PER_ALBUM = 60;

// Fields query: nestane sve što trebamo u jednom requestu
const FIELDS = [
  "id",
  "name",
  "created_time",
  "updated_time",
  "count",
  "link",
  "cover_photo{id,picture,images}",
  `photos.limit(${PHOTOS_PER_ALBUM}){id,name,created_time,images,picture}`,
].join(",");

// ───────── Helpers ─────────────────────────────────────────────

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function safeId(id) {
  return String(id).replace(/[^0-9A-Za-z_-]/g, "_");
}

/** Skida sliku ako još ne postoji. Vraća public/web putanju ili null. */
async function downloadImage(url, albumId, filename) {
  if (!url) return null;
  const albumDir = resolve(IMAGES_ROOT, safeId(albumId));
  const target = resolve(albumDir, filename);
  const publicPath = `${PUBLIC_IMAGE_PATH}/${safeId(albumId)}/${filename}`;

  if (await exists(target)) return publicPath;

  await mkdir(albumDir, { recursive: true });

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.warn(`[fb-albums] WARN ${url} → HTTP ${res.status}, preskačem`);
      return null;
    }
    if (!res.body) return null;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
    return publicPath;
  } catch (err) {
    console.warn(`[fb-albums] WARN download fail za ${url}: ${err.message}`);
    return null;
  }
}

/** Iz FB images array uzme najveću (prva je obično najveća, ali sortiramo za sigurnost). */
function pickLargest(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
  );
  return sorted[0]?.source || null;
}

// ───────── Output helpers ──────────────────────────────────────

async function writeEmpty(reason) {
  const empty = {
    lastUpdated: new Date().toISOString(),
    enabled: false,
    reason,
    albums: [],
  };
  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(empty, null, 2) + "\n", "utf8");
  console.log(`[fb-albums] ${reason} — zapisan prazan JSON.`);
}

async function preserveExisting(reason) {
  // Ako već imamo facebook-albums.json s validnim albumima, ostavi ih.
  // Time čuvamo galeriju funkcionalnu kad token expire-a.
  try {
    const existing = JSON.parse(await readFile(OUT_JSON, "utf8"));
    if (existing.albums && existing.albums.length > 0) {
      existing.lastUpdated = new Date().toISOString();
      existing.lastError = reason;
      await writeFile(OUT_JSON, JSON.stringify(existing, null, 2) + "\n", "utf8");
      console.warn(
        `[fb-albums] ⚠️  ${reason}\n` +
          `[fb-albums] zadržavam postojeći facebook-albums.json (${existing.albums.length} albuma)`,
      );
      return;
    }
  } catch {
    // datoteka ne postoji — pišemo prazan
  }
  await writeEmpty(reason);
}

// ───────── Main ────────────────────────────────────────────────

async function main() {
  if (!PAGE_ID || !TOKEN) {
    await writeEmpty("FB_PAGE_ID / FB_ACCESS_TOKEN nisu postavljeni");
    return;
  }

  await mkdir(IMAGES_ROOT, { recursive: true });

  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${PAGE_ID}/albums`);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(ALBUM_LIMIT));
  url.searchParams.set("access_token", TOKEN);

  console.log(`[fb-albums] dohvaćam albume (limit=${ALBUM_LIMIT})…`);
  const startedAt = Date.now();

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    await preserveExisting(`Network error: ${err.message}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    const reason = `Graph API HTTP ${res.status}: ${body.slice(0, 200)}`;
    await preserveExisting(reason);
    console.warn(
      `[fb-albums] Provjeri da je FB_ACCESS_TOKEN valjan i da app ima ` +
        `pristup pages_show_list + pages_read_engagement.`,
    );
    return;
  }

  const json = await res.json();
  const rawAlbums = Array.isArray(json.data) ? json.data : [];

  // Skip "Profile Pictures", "Cover Photos" i slične default albume bez korisnog sadržaja
  const SKIP_NAMES = new Set([
    "Profile Pictures",
    "Cover Photos",
    "Profilne slike",
    "Naslovne fotografije",
    "Mobile Uploads",
    "Timeline Photos",
    "Untitled Album",
  ]);

  const usable = rawAlbums.filter((a) => {
    const photoCount = a.photos?.data?.length ?? 0;
    if (photoCount === 0) return false;
    if (a.name && SKIP_NAMES.has(a.name)) return false;
    return true;
  });

  console.log(
    `[fb-albums] dobio ${rawAlbums.length} albuma, koristim ${usable.length}`,
  );

  const albums = [];
  for (const a of usable) {
    const albumId = a.id;
    const photosRaw = a.photos?.data || [];

    // Skini cover (može biti odvojeno polje ili prva fotka)
    let coverUrl =
      pickLargest(a.cover_photo?.images) ||
      a.cover_photo?.picture ||
      pickLargest(photosRaw[0]?.images) ||
      photosRaw[0]?.picture;
    const cover = await downloadImage(coverUrl, albumId, "cover.jpg");

    // Skini sve fotke
    const photos = [];
    for (let i = 0; i < photosRaw.length; i++) {
      const p = photosRaw[i];
      const src = pickLargest(p.images) || p.picture;
      const local = await downloadImage(src, albumId, `${i}.jpg`);
      if (local) {
        photos.push({
          id: p.id,
          src: local,
          caption: p.name || "",
          createdAt: p.created_time,
        });
      }
    }

    if (photos.length === 0) continue;

    albums.push({
      id: albumId,
      name: a.name || "Album",
      createdAt: a.created_time,
      updatedAt: a.updated_time,
      permalink: a.link || null,
      cover: cover || photos[0].src,
      count: a.count ?? photos.length,
      photos,
    });
  }

  // Sortiraj albume po updated_time desc (najnoviji prvi)
  albums.sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));

  const data = {
    lastUpdated: new Date().toISOString(),
    enabled: true,
    pageId: PAGE_ID,
    albums,
  };
  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ms = Date.now() - startedAt;
  const totalPhotos = albums.reduce((s, a) => s + a.photos.length, 0);
  console.log(
    `[fb-albums] gotovo za ${ms}ms · ${albums.length} albuma · ${totalPhotos} fotki ukupno`,
  );
  console.log(`[fb-albums] zapisano: ${OUT_JSON}`);
}

main().catch((err) => {
  console.error("[fb-albums] GREŠKA:", err.message || err);
  process.exit(1);
});
