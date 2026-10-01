/**
 * Lokalne kopije slika s hns.family: grbovi klubova i fotke naših seniora.
 *
 * Bez ovoga ih je stranica učitavala izravno s HNS-a — ako HNS promijeni
 * putanje ili zabrani hotlinking, nestanu sve odjednom. Skripta svaku sliku
 * skine jednom i zapiše manifest (HNS URL → lokalna putanja):
 *
 *   grbovi  → public/images/clubs/    + src/data/crests.json  (crestSrc)
 *   seniori → public/images/players/  + src/data/photos.json  (photoSrc)
 *
 * Frontend ih čita kroz `src/lib/images.ts`.
 *
 * Fotke se namjerno skidaju SAMO za naše seniore. Djeca (U-11) i igrači
 * protivnika ostaju na HNS URL-u: kopija u javnom git repou ostala bi u
 * povijesti zauvijek, i kad je HNS makne.
 *
 * Datoteka se imenuje po hashu URL-a: nova slika na HNS-u = novi URL = nova
 * datoteka. Slika koja se ne uspije skinuti nema zapis u manifestu, pa
 * stranica za nju i dalje koristi HNS URL — nikad ne puca.
 *
 * Pokreće se nakon `scrape.mjs` (dio `npm run scrape`).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeJsonIfChanged } from "./lib/write-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HNS = path.join(ROOT, "src/data/hns.json");
const FRIENDLIES = path.join(ROOT, "src/data/friendlies.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";
const MAX_BYTES = 512 * 1024; // grb ili fotka je par desetaka KB; veće je nešto krivo
const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Svi http(s) URL-ovi pod ključevima koji sadrže "logo", bilo gdje u strukturi. */
export function collectLogoUrls(data, out = new Set()) {
  if (Array.isArray(data)) {
    for (const item of data) collectLogoUrls(item, out);
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (/logo/i.test(key) && typeof value === "string" && /^https?:\/\//.test(value)) {
        out.add(value);
      } else {
        collectLogoUrls(value, out);
      }
    }
  }
  return out;
}

/**
 * Fotke naših seniora: roster i rang-liste, objedinjene i po seniorskom
 * natjecanju. Postave iz `matchDetails` namjerno ne — tamo su i protivnici.
 */
export function collectSeniorPhotoUrls(hns, out = new Set()) {
  const add = (list) => {
    for (const p of list ?? []) {
      if (typeof p?.photo === "string" && /^https?:\/\//.test(p.photo)) out.add(p.photo);
    }
  };
  const addStats = (stats) => {
    for (const key of ["topScorers", "topCards", "topApps"]) add(stats?.[key]);
  };
  add(hns?.players);
  addStats(hns?.stats);
  for (const comp of hns?.competitions ?? []) {
    if (comp?.ageCategory !== "Seniors") continue;
    add(comp.players);
    addStats(comp.stats);
  }
  return out;
}

const hashOf = (url) => createHash("sha1").update(url).digest("hex").slice(0, 16);

const existingFile = (url, outDir) => {
  const base = hashOf(url);
  for (const ext of Object.values(EXT_BY_TYPE)) {
    if (existsSync(path.join(outDir, `${base}.${ext}`))) return `${base}.${ext}`;
  }
  return null;
};

/**
 * Skini jednu sliku u `outDir`; vraća ime datoteke ili null.
 * Postojeća datoteka (bilo koje ekstenzije) se ne skida ponovo.
 */
export async function downloadImage(url, outDir, { timeoutMs = 15000, label = "[images]" } = {}) {
  const existing = existingFile(url, outDir);
  if (existing) return existing;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = EXT_BY_TYPE[type];
    if (!ext) throw new Error(`nije slika (${type || "bez content-type"})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      throw new Error(`neočekivana veličina (${buf.length} B)`);
    }
    await mkdir(outDir, { recursive: true });
    const file = `${hashOf(url)}.${ext}`;
    await writeFile(path.join(outDir, file), buf);
    return file;
  } catch (err) {
    console.warn(`${label} ⚠ ${url}: ${err.message ?? err}`);
    return null;
  }
}

/** Skini skup slika i zapiši manifest; redom, ne paralelno (HNS zna vratiti 52x). */
async function syncSet({ label, urls, outDir, publicPrefix, manifestPath, noun }) {
  const manifest = {};
  let fresh = 0;
  let failed = 0;
  for (const url of [...urls].sort()) {
    const existedBefore = !!existingFile(url, outDir);
    const file = await downloadImage(url, outDir, { label });
    if (!file) {
      failed++;
      continue;
    }
    if (!existedBefore) fresh++;
    manifest[url] = `${publicPrefix}/${file}`;
  }
  await writeJsonIfChanged(manifestPath, manifest, { ignore: [], label });
  console.log(
    `${label} ${urls.size} ${noun} · ${fresh} novih · ${failed} neuspjelih (ti ostaju na HNS URL-u)`,
  );
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    console.warn(`[images] ⚠ ne mogu pročitati ${path.relative(ROOT, file)}: ${err.message}`);
    return null;
  }
}

async function main() {
  const hns = await readJson(HNS);
  const friendlies = await readJson(FRIENDLIES);

  const logos = new Set();
  collectLogoUrls(hns, logos);
  collectLogoUrls(friendlies, logos);
  await syncSet({
    label: "[crests]",
    urls: logos,
    outDir: path.join(ROOT, "public/images/clubs"),
    publicPrefix: "/images/clubs",
    manifestPath: path.join(ROOT, "src/data/crests.json"),
    noun: "grbova",
  });

  await syncSet({
    label: "[photos]",
    urls: collectSeniorPhotoUrls(hns),
    outDir: path.join(ROOT, "public/images/players"),
    publicPrefix: "/images/players",
    manifestPath: path.join(ROOT, "src/data/photos.json"),
    noun: "fotki",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    // Slike nisu kritične: pad ovdje ne smije srušiti `npm run scrape`
    // (lanac s &&) pa time ni commit podataka i deploy. Stranica ionako
    // ima HNS URL kao fallback.
    console.warn(`[images] ⚠ preskačem: ${err?.stack ?? err}`);
  }
}
