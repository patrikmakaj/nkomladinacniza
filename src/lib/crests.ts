/**
 * Grbovi klubova: lokalna kopija ako je imamo, inače originalni URL s HNS-a.
 *
 * Kopije skida `scripts/fetch-crests.mjs` (dio `npm run scrape`) u
 * `public/images/clubs/` i zapisuje manifest `src/data/crests.json`.
 * Grb koji se nije uspio skinuti nema zapis, pa ostaje na HNS URL-u.
 *
 * Svaki `<img>` s grbom kluba ide kroz `crestSrc()` — tako se i lokalna
 * putanja provuče kroz `url()` (base path).
 */
import crests from "../data/crests.json";
import { url } from "./url";

const manifest = crests as Record<string, string>;

export function crestSrc(logo: string | null | undefined): string | null {
  if (!logo) return null;
  const local = manifest[logo];
  return local ? url(local) : logo;
}

/** Lokalna datoteka grba (putanja unutar `public/`), za build-time čitanje — npr. OG slike. */
export function crestLocalPath(logo: string | null | undefined): string | null {
  if (!logo) return null;
  return manifest[logo] ?? null;
}
