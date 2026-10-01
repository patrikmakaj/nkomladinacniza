/**
 * Lokalne kopije grbova klubova.
 *
 * Grbovi protivnika dolaze s hns.family. Bez ovoga ih je stranica učitavala
 * izravno odande — ako HNS promijeni putanje ili zabrani hotlinking, nestanu
 * svi odjednom. Ova skripta svaki grb skine jednom u `public/images/clubs/`
 * i zapiše manifest `src/data/crests.json` (HNS URL → lokalna putanja).
 * Frontend ga čita kroz `crestSrc()` iz `src/lib/crests.ts`.
 *
 * Datoteka se imenuje po hashu URL-a: kad HNS objavi novi grb, dobije novi
 * URL i skine se ponovo. Grb koji se ne uspije skinuti nema zapis u
 * manifestu, pa stranica za njega i dalje koristi HNS URL — nikad ne puca.
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
const SOURCES = [
  path.join(ROOT, "src/data/hns.json"),
  path.join(ROOT, "src/data/friendlies.json"),
];
const OUT_DIR = path.join(ROOT, "public/images/clubs");
const MANIFEST = path.join(ROOT, "src/data/crests.json");
const PUBLIC_PREFIX = "/images/clubs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";
const MAX_BYTES = 512 * 1024; // grb je par desetaka KB; veće je nešto krivo
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

const hashOf = (url) => createHash("sha1").update(url).digest("hex").slice(0, 16);

/**
 * Skini jedan grb u `outDir`; vraća ime datoteke ili null.
 * Postojeća datoteka (bilo koje ekstenzije) se ne skida ponovo.
 */
export async function downloadCrest(url, outDir, { timeoutMs = 15000 } = {}) {
  const base = hashOf(url);
  for (const ext of Object.values(EXT_BY_TYPE)) {
    if (existsSync(path.join(outDir, `${base}.${ext}`))) return `${base}.${ext}`;
  }

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
    await writeFile(path.join(outDir, `${base}.${ext}`), buf);
    return `${base}.${ext}`;
  } catch (err) {
    console.warn(`[crests] ⚠ ${url}: ${err.message ?? err}`);
    return null;
  }
}

async function main() {
  const urls = new Set();
  for (const file of SOURCES) {
    try {
      collectLogoUrls(JSON.parse(await readFile(file, "utf8")), urls);
    } catch (err) {
      console.warn(`[crests] ⚠ ne mogu pročitati ${path.relative(ROOT, file)}: ${err.message}`);
    }
  }

  const manifest = {};
  let fresh = 0;
  let failed = 0;
  // Redom, ne paralelno: dvadesetak malih slika, a HNS zna vratiti 52x pod opterećenjem.
  for (const url of [...urls].sort()) {
    const existedBefore = Object.values(EXT_BY_TYPE).some((ext) =>
      existsSync(path.join(OUT_DIR, `${hashOf(url)}.${ext}`)),
    );
    const file = await downloadCrest(url, OUT_DIR);
    if (!file) {
      failed++;
      continue;
    }
    if (!existedBefore) fresh++;
    manifest[url] = `${PUBLIC_PREFIX}/${file}`;
  }

  await writeJsonIfChanged(MANIFEST, manifest, { ignore: [], label: "[crests]" });
  console.log(
    `[crests] ${urls.size} grbova · ${fresh} novih · ${failed} neuspjelih (ti ostaju na HNS URL-u)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
