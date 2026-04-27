#!/usr/bin/env node
/**
 * Facebook Graph API scraper za NK Omladinac Niza
 *
 * Dohvaća zadnje postove sa Facebook stranice kluba kroz Graph API,
 * skida slike lokalno (jer FB CDN URL-ovi expire-aju za 1-2 tjedna)
 * i sprema strukturiran JSON u src/data/facebook.json.
 *
 * Pokreće se kroz GitHub Action svakih 30 min ili lokalno preko
 * `npm run scrape:facebook`.
 *
 * Environment varijable (obje obavezne za stvarni scrape):
 *   FB_PAGE_ID       — ID Facebook stranice (npr. "123456789")
 *   FB_ACCESS_TOKEN  — Long-lived Page Access Token
 *
 * Ako varijable nisu postavljene, script piše prazan JSON i izlazi
 * uspješno (build se ne ruši dok token nije dodan).
 */

import { writeFile, mkdir, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_JSON = resolve(ROOT, "src/data/facebook.json");
const IMAGES_DIR = resolve(ROOT, "public/images/facebook");
const PUBLIC_IMAGE_PATH = "/images/facebook";

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_ACCESS_TOKEN;
const API_VERSION = "v21.0";
const FETCH_LIMIT = 25; // dohvati malo više nego što prikazujemo

// Polja koja tražimo iz Graph API-ja
const FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "attachments{media_type,media,subattachments{media,type}}",
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

/** Sigurno ime datoteke iz post ID-a (npr. "123_456" ili "123_456_idx2") */
function imageFilename(postId, idx = null) {
  const safe = String(postId).replace(/[^0-9_]/g, "_");
  return idx == null ? `${safe}.jpg` : `${safe}_${idx}.jpg`;
}

/** Skida sliku u IMAGES_DIR ako još ne postoji. Vraća public/web putanju ili null. */
async function downloadImage(url, postId, idx = null) {
  if (!url) return null;
  const filename = imageFilename(postId, idx);
  const target = resolve(IMAGES_DIR, filename);

  if (await exists(target)) {
    return `${PUBLIC_IMAGE_PATH}/${filename}`;
  }

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.warn(`[fb-scrape] WARN slika ${url} → HTTP ${res.status}, preskačem`);
      return null;
    }
    if (!res.body) {
      console.warn(`[fb-scrape] WARN slika ${url} bez body-ja, preskačem`);
      return null;
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
    return `${PUBLIC_IMAGE_PATH}/${filename}`;
  } catch (err) {
    console.warn(`[fb-scrape] WARN download fail za ${url}: ${err.message}`);
    return null;
  }
}

/** Izvuče sve slike iz posta - full_picture + subattachments za albume */
async function collectPostImages(post) {
  const urls = [];

  // attachments.subattachments za albume
  const subs = post.attachments?.data?.[0]?.subattachments?.data;
  if (Array.isArray(subs) && subs.length > 0) {
    for (const sub of subs) {
      const src = sub?.media?.image?.src;
      if (src) urls.push(src);
    }
  }

  // Single slika fallback
  if (urls.length === 0 && post.full_picture) {
    urls.push(post.full_picture);
  }

  // Skidamo sve, čuvamo samo uspješne
  const downloaded = [];
  for (let i = 0; i < urls.length; i++) {
    const local = await downloadImage(
      urls[i],
      post.id,
      urls.length > 1 ? i : null,
    );
    if (local) downloaded.push(local);
  }
  return downloaded;
}

// ───────── Main ────────────────────────────────────────────────

async function writeEmpty(reason) {
  const empty = {
    lastUpdated: new Date().toISOString(),
    enabled: false,
    reason,
    posts: [],
  };
  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(empty, null, 2) + "\n", "utf8");
  console.log(`[fb-scrape] ${reason} — zapisan prazan JSON.`);
}

async function preserveExisting(reason) {
  // Ako već imamo facebook.json s validnim postovima, ostavi ga (samo ažuriraj timestamp poruke).
  // To čuva sajt funkcionalnim kad token expire-a — postovi ostaju zadnji poznati,
  // dok ne osvježimo token. Build NE smije pasti zbog FB problema.
  try {
    const { readFile } = await import("node:fs/promises");
    const existing = JSON.parse(await readFile(OUT_JSON, "utf8"));
    if (existing.posts && existing.posts.length > 0) {
      existing.lastUpdated = new Date().toISOString();
      existing.lastError = reason;
      await writeFile(OUT_JSON, JSON.stringify(existing, null, 2) + "\n", "utf8");
      console.warn(
        `[fb-scrape] ⚠️  ${reason}\n` +
          `[fb-scrape] zadržavam postojeći facebook.json (${existing.posts.length} postova)`,
      );
      return;
    }
  } catch {
    // facebook.json ne postoji ili nije čitljiv — pišemo prazan
  }
  await writeEmpty(reason);
}

async function main() {
  if (!PAGE_ID || !TOKEN) {
    await writeEmpty("FB_PAGE_ID / FB_ACCESS_TOKEN nisu postavljeni");
    return;
  }

  await mkdir(IMAGES_DIR, { recursive: true });

  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${PAGE_ID}/posts`);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(FETCH_LIMIT));
  url.searchParams.set("access_token", TOKEN);

  console.log(`[fb-scrape] dohvaćam postove (limit=${FETCH_LIMIT})…`);
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
      `[fb-scrape] Provjeri da je FB_ACCESS_TOKEN valjan (long-lived Page token) ` +
        `i da app ima pristup pages_read_engagement.`,
    );
    return;
  }

  const json = await res.json();
  const rawPosts = Array.isArray(json.data) ? json.data : [];

  // Filtriraj postove bez ikakvog sadržaja (prazni share-ovi, eventi, itd.)
  const usable = rawPosts.filter((p) => {
    const hasMessage = typeof p.message === "string" && p.message.trim().length > 0;
    const hasImage = !!p.full_picture;
    return hasMessage || hasImage;
  });

  // Skini slike i pripremi finalni format
  const posts = [];
  for (const p of usable) {
    const images = await collectPostImages(p);
    posts.push({
      id: p.id,
      message: p.message ?? "",
      createdAt: p.created_time,
      permalink: p.permalink_url ?? null,
      images,
    });
  }

  const data = {
    lastUpdated: new Date().toISOString(),
    enabled: true,
    pageId: PAGE_ID,
    posts,
  };
  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ms = Date.now() - startedAt;
  console.log(
    `[fb-scrape] gotovo za ${ms}ms · ${posts.length} postova · ` +
      `${posts.reduce((s, p) => s + p.images.length, 0)} slika ukupno`,
  );
  console.log(`[fb-scrape] zapisano: ${OUT_JSON}`);
}

main().catch((err) => {
  console.error("[fb-scrape] GREŠKA:", err.message || err);
  process.exit(1);
});
