#!/usr/bin/env node
/**
 * Facebook Graph API scraper za FB albume NK Omladinac Niza
 *
 * Dohvaća SVE albume sa stranice kluba (uz paginaciju), pa za svaki album
 * SVU metapodatke fotki. Zatim sve fotke spoji, sortira po datumu silazno
 * i primijeni kvotu po godini — tako svaka godina u filteru na galeriji
 * ima sadržaj, a repo ne naraste na pola gigabajta.
 *
 * Slike se spremaju pod imenom `<photo-id>.jpg` (stabilno — indeks se mijenja
 * kad se doda nova fotka, ID ne). Već skinute slike koje ispadnu iz kvote
 * i dalje ostaju u galeriji — arhiva tako raste, a git povijest se ne mlati.
 *
 * Pokreće se kroz GitHub Action kao dio `npm run scrape`, ili
 * lokalno preko `npm run scrape:fb-albums`.
 *
 * Environment varijable:
 *   FB_PAGE_ID       — ID Facebook stranice (obavezno)
 *   FB_ACCESS_TOKEN  — Long-lived Page Access Token (obavezno)
 *   FB_PHOTOS_PER_YEAR — koliko fotki po godini najviše skidati (default 200)
 *
 * Ako varijable nisu postavljene, script zadrži postojeće podatke (ili
 * napiše prazan JSON ako ih nema) i izađe uspješno — build se ne ruši.
 */

import { writeFile, mkdir, access, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_JSON = resolve(ROOT, "src/data/facebook-albums.json");
const IMAGES_ROOT = resolve(ROOT, "public/images/facebook-albums");
const PUBLIC_IMAGE_PATH = "/images/facebook-albums";

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_ACCESS_TOKEN;
const API_VERSION = "v21.0";

/** Najviše fotki po kalendarskoj godini koje skidamo lokalno. */
const PHOTOS_PER_YEAR = Number(process.env.FB_PHOTOS_PER_YEAR) || 200;
/** Koliko zapisa tražimo po API stranici. */
const ALBUMS_PAGE_SIZE = 50;
const PHOTOS_PAGE_SIZE = 100;
/** Zaštita od beskonačne petlje ako paging.next nikad ne prestane. */
const MAX_PAGES = 200;
/** Paralelnih downloada slika. */
const DOWNLOAD_CONCURRENCY = 6;
/** Slike šire od ovoga ne trebamo — galerija ih ionako prikazuje manje. */
const MAX_IMAGE_WIDTH = 1600;

/**
 * Uz svaku fotku spremamo i mali WebP thumbnail za mrežu u galeriji.
 *
 * Kartica u mreži je široka 180-280 CSS px, a servirali smo joj sliku od
 * 1600 px — prolazak kroz 100 fotki znao je povući 10 MB. Thumb od 500 px
 * to spušta na 2,8 MB, a lightbox i dalje otvara netaknuti original.
 *
 * Konverzija originala u WebP se NE isplati: fotke su već Facebookovom
 * kompresijom stisnute, pa ista dimenzija u WebP-u štedi samo ~22 % uz
 * slaganje artefakata na već lossy izvor.
 */
const THUMB_WIDTH = 500;
const THUMB_QUALITY = 78;

// Albumi koje ne želimo u galeriji (profilne i naslovne slike).
// Facebook vraća nazive na jeziku stranice, pa pokrivamo obje varijante.
const SKIP_NAMES = new Set([
  "Profile Pictures",
  "Cover Photos",
  "Profilne slike",
  "Slike profila",
  "Naslovne fotografije",
  "Naslovne slike",
]);

// ───────── Helpers ─────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** "2026-08-07T08:01:54+0000" → "2026"; null ako datum fali. */
function yearOf(createdTime) {
  const m = /^(\d{4})-/.exec(createdTime || "");
  return m ? m[1] : null;
}

/**
 * Iz FB `images` niza uzme najveću sliku koja nije šira od MAX_IMAGE_WIDTH.
 * Ako su sve veće, uzme najmanju od njih (bolje nego skidati 2048px original).
 */
function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images]
    .filter((i) => i && i.source)
    .sort((a, b) => (b.width || 0) - (a.width || 0));
  if (sorted.length === 0) return null;
  const fitting = sorted.find((i) => (i.width || 0) <= MAX_IMAGE_WIDTH);
  return (fitting || sorted[sorted.length - 1]).source;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Graph API GET s retryjem na rate-limit i serverske greške. */
async function apiGet(url, { attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * 2 ** (i - 1));
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (res.ok) return await res.json();
    const body = await res.text();
    const err = new Error(`Graph API HTTP ${res.status}: ${body.slice(0, 200)}`);
    if (!RETRY_STATUS.has(res.status)) throw err;
    lastErr = err;
  }
  throw lastErr;
}

/** Prolazi kroz sve stranice jednog edge-a i vraća spojeni `data` niz. */
async function fetchAllPages(firstUrl, label) {
  const all = [];
  let url = firstUrl;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const json = await apiGet(url);
    const batch = Array.isArray(json.data) ? json.data : [];
    all.push(...batch);
    url = json.paging?.next || null;
    if (url) await sleep(120); // budimo pristojni prema API-ju
  }
  console.log(`[fb-albums]   ${label}: ${all.length} zapisa`);
  return all;
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
      console.warn(`[fb-albums] WARN ${filename} → HTTP ${res.status}, preskačem`);
      return null;
    }
    if (!res.body) return null;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
    return publicPath;
  } catch (err) {
    console.warn(`[fb-albums] WARN download fail (${filename}): ${err.message}`);
    return null;
  }
}

/**
 * Napravi thumbnail za već skinutu fotku ako ga još nema.
 * Vraća public putanju do thumba, ili null ako konverzija ne uspije
 * (tada galerija pada natrag na original).
 */
async function ensureThumb(albumId, filename) {
  const dir = safeId(albumId);
  const base = filename.replace(/\.[^.]+$/, "");
  const source = resolve(IMAGES_ROOT, dir, filename);
  const target = resolve(IMAGES_ROOT, dir, `${base}.webp`);
  const publicPath = `${PUBLIC_IMAGE_PATH}/${dir}/${base}.webp`;

  if (await exists(target)) return publicPath;
  if (!(await exists(source))) return null;

  try {
    await sharp(source)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(target);
    return publicPath;
  } catch (err) {
    console.warn(`[fb-albums] WARN thumb fail (${filename}): ${err.message}`);
    return null;
  }
}

/** Obrađuje `items` s najviše `limit` paralelnih zadataka. */
async function inParallel(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
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

/**
 * Zadrži postojeće albume kad scrape ne uspije. Ovo je zaštita zbog koje
 * galerija preživi istekli token, mrežni ispad ili — što se stvarno događa —
 * uspješan HTTP 200 s praznim popisom albuma.
 */
async function preserveExisting(reason) {
  try {
    const existing = JSON.parse(await readFile(OUT_JSON, "utf8"));
    if (existing.albums && existing.albums.length > 0) {
      existing.lastUpdated = new Date().toISOString();
      existing.lastError = reason;
      await writeFile(OUT_JSON, JSON.stringify(existing, null, 2) + "\n", "utf8");
      const n = existing.albums.reduce((s, a) => s + (a.photos?.length ?? 0), 0);
      console.warn(
        `[fb-albums] ⚠️  ${reason}\n` +
          `[fb-albums] zadržavam postojeće podatke (${existing.albums.length} albuma, ${n} fotki)`,
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
    await preserveExisting("FB_PAGE_ID / FB_ACCESS_TOKEN nisu postavljeni");
    return;
  }

  await mkdir(IMAGES_ROOT, { recursive: true });
  const startedAt = Date.now();

  // ── 1. Svi albumi ────────────────────────────────────────────
  const albumsUrl = new URL(
    `https://graph.facebook.com/${API_VERSION}/${PAGE_ID}/albums`,
  );
  albumsUrl.searchParams.set(
    "fields",
    "id,name,created_time,updated_time,count,link,cover_photo{id,images}",
  );
  albumsUrl.searchParams.set("limit", String(ALBUMS_PAGE_SIZE));
  albumsUrl.searchParams.set("access_token", TOKEN);

  console.log("[fb-albums] dohvaćam popis albuma…");
  let rawAlbums;
  try {
    rawAlbums = await fetchAllPages(albumsUrl.href, "albumi");
  } catch (err) {
    await preserveExisting(err.message);
    console.warn(
      "[fb-albums] Provjeri da je FB_ACCESS_TOKEN valjan i da app ima " +
        "pristup pages_show_list + pages_read_engagement.",
    );
    return;
  }

  // Prazan popis uz HTTP 200 nije "nema albuma" — to je greška na FB strani.
  if (rawAlbums.length === 0) {
    await preserveExisting("Graph API vratio prazan popis albuma (HTTP 200)");
    return;
  }

  const usable = rawAlbums.filter((a) => !(a.name && SKIP_NAMES.has(a.name)));
  console.log(
    `[fb-albums] ${rawAlbums.length} albuma, koristim ${usable.length} ` +
      `(preskačem ${rawAlbums.length - usable.length} profilnih/naslovnih)`,
  );

  // ── 2. Metapodaci svih fotki iz svakog albuma ────────────────
  const allPhotos = []; // { albumIdx, id, caption, createdAt, srcUrl }
  for (let ai = 0; ai < usable.length; ai++) {
    const a = usable[ai];
    const photosUrl = new URL(
      `https://graph.facebook.com/${API_VERSION}/${a.id}/photos`,
    );
    photosUrl.searchParams.set("fields", "id,name,created_time,images");
    photosUrl.searchParams.set("limit", String(PHOTOS_PAGE_SIZE));
    photosUrl.searchParams.set("access_token", TOKEN);

    let photos;
    try {
      photos = await fetchAllPages(
        photosUrl.href,
        `"${(a.name || "Album").slice(0, 30)}"`,
      );
    } catch (err) {
      console.warn(`[fb-albums] WARN album "${a.name}" preskočen: ${err.message}`);
      continue;
    }

    for (const p of photos) {
      const srcUrl = pickImage(p.images);
      if (!srcUrl) continue;
      allPhotos.push({
        albumIdx: ai,
        id: p.id,
        caption: p.name || "",
        createdAt: p.created_time,
        srcUrl,
      });
    }
  }

  if (allPhotos.length === 0) {
    await preserveExisting("Graph API nije vratio nijednu fotku");
    return;
  }

  // ── 3. Sortiraj po datumu silazno i primijeni kvotu po godini ─
  allPhotos.sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));

  const perYear = new Map();
  const selected = [];
  const skippedByQuota = [];
  for (const p of allPhotos) {
    const y = yearOf(p.createdAt) || "0000";
    const n = perYear.get(y) || 0;
    if (n < PHOTOS_PER_YEAR) {
      perYear.set(y, n + 1);
      selected.push(p);
    } else {
      skippedByQuota.push(p);
    }
  }

  // Fotke izvan kvote koje su ranije već skinute zadržavamo — arhiva raste,
  // a git povijest se ne mijenja jer datoteke već postoje.
  const extras = [];
  await inParallel(skippedByQuota, 32, async (p) => {
    const album = usable[p.albumIdx];
    const file = resolve(IMAGES_ROOT, safeId(album.id), `${safeId(p.id)}.jpg`);
    if (await exists(file)) extras.push(p);
  });

  const toKeep = [...selected, ...extras].sort((x, y) =>
    (y.createdAt || "").localeCompare(x.createdAt || ""),
  );

  console.log(
    `[fb-albums] ukupno ${allPhotos.length} fotki na FB-u · ` +
      `kvota ${PHOTOS_PER_YEAR}/god → ${selected.length} odabrano` +
      (extras.length ? ` + ${extras.length} već skinutih izvan kvote` : ""),
  );
  const yearSummary = [...perYear.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([y, n]) => `${y}:${n}`)
    .join(" ");
  console.log(`[fb-albums] po godinama → ${yearSummary}`);

  // ── 4. Skini slike ───────────────────────────────────────────
  let downloaded = 0;
  let failed = 0;
  let thumbed = 0;
  const localPath = new Map(); // photo.id → public path originala
  const thumbPath = new Map(); // photo.id → public path thumbnaila

  await inParallel(toKeep, DOWNLOAD_CONCURRENCY, async (p) => {
    const album = usable[p.albumIdx];
    const filename = `${safeId(p.id)}.jpg`;
    const local = await downloadImage(p.srcUrl, album.id, filename);
    if (!local) {
      failed++;
      return;
    }
    localPath.set(p.id, local);
    downloaded++;

    // Thumb se radi i za ranije skinute fotke — tako se arhiva popuni
    // postupno, bez zasebne migracijske skripte.
    const thumb = await ensureThumb(album.id, filename);
    if (thumb) {
      thumbPath.set(p.id, thumb);
      thumbed++;
    }
  });
  console.log(
    `[fb-albums] slike · OK ${downloaded} · neuspjelo ${failed} · thumbova ${thumbed}`,
  );

  // ── 5. Složi izlazni JSON (grupirano po albumima, kao i prije) ─
  const byAlbum = new Map();
  for (const p of toKeep) {
    const local = localPath.get(p.id);
    if (!local) continue;
    if (!byAlbum.has(p.albumIdx)) byAlbum.set(p.albumIdx, []);
    byAlbum.get(p.albumIdx).push({
      id: p.id,
      src: local,
      // Mali WebP za mrežu; null ako konverzija nije uspjela — galerija
      // tada koristi `src`.
      thumb: thumbPath.get(p.id) ?? null,
      caption: p.caption,
      createdAt: p.createdAt,
    });
  }

  const albums = [];
  for (const [ai, photos] of byAlbum) {
    if (photos.length === 0) continue;
    const a = usable[ai];
    const coverUrl = pickImage(a.cover_photo?.images);
    const cover =
      (await downloadImage(coverUrl, a.id, "cover.jpg")) || photos[0].src;
    albums.push({
      id: a.id,
      name: a.name || "Album",
      createdAt: a.created_time,
      updatedAt: a.updated_time,
      permalink: a.link || null,
      cover,
      count: a.count ?? photos.length,
      photos,
    });
  }

  albums.sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));

  const totalPhotos = albums.reduce((s, a) => s + a.photos.length, 0);
  if (totalPhotos === 0) {
    await preserveExisting("Nijedna slika nije uspješno skinuta");
    return;
  }

  // Popis godina za filter na galeriji (silazno)
  const years = [
    ...new Set(
      albums.flatMap((a) => a.photos.map((p) => yearOf(p.createdAt)).filter(Boolean)),
    ),
  ].sort((a, b) => b.localeCompare(a));

  const data = {
    lastUpdated: new Date().toISOString(),
    enabled: true,
    pageId: PAGE_ID,
    photosPerYear: PHOTOS_PER_YEAR,
    totalOnFacebook: allPhotos.length,
    years,
    albums,
  };
  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ms = Date.now() - startedAt;
  console.log(
    `[fb-albums] gotovo za ${(ms / 1000).toFixed(1)}s · ${albums.length} albuma · ` +
      `${totalPhotos} fotki · godine ${years[years.length - 1]}–${years[0]}`,
  );
  console.log(`[fb-albums] zapisano: ${OUT_JSON}`);
}

main().catch((err) => {
  console.error("[fb-albums] GREŠKA:", err.message || err);
  process.exit(1);
});
