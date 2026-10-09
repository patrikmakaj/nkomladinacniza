/**
 * OG slike (1200×630) i plakati — satori + resvg, s cacheom na disku.
 *
 * Generiranje traje ~1,4 s po slici, a build ide i svakih 30 min, pa se PNG
 * sprema u .cache/og po hashu svega što utječe na izgled (CI cache-a tu
 * mapu). Dijele ga rezultati (/utakmica/[id].png) i najave (/najava/[id].png).
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.resolve(".cache/og");

const font = (file: string) => fs.readFileSync(path.resolve("./src/assets/fonts", file));
const oswaldBold = font("Oswald-Bold.woff");
const oswaldMedium = font("Oswald-Medium.woff");
const interMedium = font("Inter-Medium.woff");
const interBold = font("Inter-Bold.woff");

const OG_FONTS = [
  { name: "Oswald", data: oswaldBold, style: "normal" as const, weight: 700 as const },
  { name: "Oswald", data: oswaldMedium, style: "normal" as const, weight: 500 as const },
  { name: "Oswald", data: oswaldBold, style: "normal" as const, weight: 600 as const },
  { name: "Inter", data: interMedium, style: "normal" as const, weight: 500 as const },
  { name: "Inter", data: interBold, style: "normal" as const, weight: 700 as const },
];

/**
 * Satori stablo → PNG Response. `name` je prefiks datoteke u cacheu, a
 * `cacheKey` sve o čemu slika ovisi (promjena ključa = nova slika).
 */
export async function renderOgPng(
  tree: Parameters<typeof satori>[0],
  { name, cacheKey }: { name: string; cacheKey: string },
): Promise<Response> {
  return renderImage(tree, { name, cacheKey, width: 1200, height: 630, format: "png" });
}

/**
 * Isto kao renderOgPng, ali proizvoljne veličine i po želji JPEG — plakati
 * (lib/poster.ts) su 1080×1350 i 1080×1920 s fotkom, pa bi PNG imao 2 MB.
 */
export async function renderImage(
  tree: Parameters<typeof satori>[0],
  {
    name,
    cacheKey,
    width,
    height,
    format,
  }: { name: string; cacheKey: string; width: number; height: number; format: "png" | "jpeg" },
): Promise<Response> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex").slice(0, 16);
  const ext = format === "jpeg" ? "jpg" : "png";
  const cachePath = path.join(CACHE_DIR, `${name}-${hash}.${ext}`);
  const contentType = format === "jpeg" ? "image/jpeg" : "image/png";

  if (fs.existsSync(cachePath)) {
    return new Response(new Uint8Array(fs.readFileSync(cachePath)), {
      headers: { "Content-Type": contentType, "X-Cache": "HIT" },
    });
  }

  const svg = await satori(tree, { width, height, fonts: OG_FONTS });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  const out =
    format === "jpeg" ? await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer() : png;

  try {
    fs.writeFileSync(cachePath, out);
  } catch {
    // Ako nije moguće pisati u cache (npr. read-only FS), tiho ignoriraj
  }

  return new Response(new Uint8Array(out), {
    headers: { "Content-Type": contentType, "X-Cache": "MISS" },
  });
}
