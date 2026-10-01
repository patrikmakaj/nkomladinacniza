/**
 * Slike s hns.family: lokalna kopija ako je imamo, inače originalni URL.
 *
 * Kopije skida `scripts/fetch-images.mjs` (dio `npm run scrape`):
 *   grbovi klubova    → public/images/clubs/   + src/data/crests.json
 *   fotke naših seniora → public/images/players/ + src/data/photos.json
 * Slika koja se nije uspjela skinuti (ili namjerno nije — djeca, protivnici)
 * nema zapis, pa ostaje na HNS URL-u.
 *
 * Svaki `<img>` s grbom ili fotkom igrača ide kroz `crestSrc()` / `photoSrc()`
 * — tako se i lokalna putanja provuče kroz `url()` (base path).
 */
import crests from "../data/crests.json";
import photos from "../data/photos.json";
import { url } from "./url";

const crestManifest = crests as Record<string, string>;
const photoManifest = photos as Record<string, string>;

function resolve(manifest: Record<string, string>, remote: string | null | undefined) {
  if (!remote) return null;
  const local = manifest[remote];
  return local ? url(local) : remote;
}

/** Grb kluba. */
export function crestSrc(logo: string | null | undefined): string | null {
  return resolve(crestManifest, logo);
}

/** Fotka igrača. */
export function photoSrc(photo: string | null | undefined): string | null {
  return resolve(photoManifest, photo);
}

/** Lokalna datoteka grba (putanja unutar `public/`), za build-time čitanje — npr. OG slike. */
export function crestLocalPath(logo: string | null | undefined): string | null {
  if (!logo) return null;
  return crestManifest[logo] ?? null;
}
