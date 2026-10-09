/**
 * Gdje se igra utakmica — za "Upute" (Google Maps) i LOCATION u kalendaru.
 *
 * Domaće igralište znamo točno. Za gostovanja HNS u listi utakmica ne šalje
 * igralište, ali ga šalje u detaljima odigranih utakmica (`facility`, npr.
 * "NK Lila, Lila, 29.08.2026. 17:30"). Ako smo kod tog domaćina već igrali
 * (bilo koja seniorska utakmica ove sezone), znamo i njegovo igralište.
 * Inače ostaje pretraga po imenu kluba — zato `exact: false`.
 */
import hns from "../data/hns.json";
import { OUR_CLUB_ID, type UnifiedMatch } from "./matches";

export const HOME_GROUND = {
  name: "ŠRC Miroslav Knežević-Bujdo (Grbavica)",
  address: "Kolodvorska 50a, 31224 Niza",
};

export type Venue = {
  /** Za prikaz i LOCATION u kalendaru. */
  label: string;
  /** Upit za Google Maps. */
  query: string;
  /** Znamo li točno igralište ili samo pogađamo po imenu kluba/mjesta. */
  exact: boolean;
};

/** "NK \"Motičina\", Donja Motičina, 13.09.2026. 17:00" → "NK Motičina, Donja Motičina" */
export function groundFromFacility(facility: string): string | null {
  const m = facility.match(/^(.*?),\s*\d{1,2}\.\d{1,2}\.\d{4}\./);
  const ground = (m ? m[1] : "").replace(/["„“”]/g, "").trim();
  return ground || null;
}

/** Igrališta po id-u kluba domaćina, iz detalja već odigranih utakmica. */
const groundByClub = new Map<number, string>();
{
  const details = (hns.matchDetails ?? {}) as Record<string, { facility?: string | null }>;
  for (const m of (hns.matches ?? []) as any[]) {
    const facility = details[m.id]?.facility;
    const ground = facility ? groundFromFacility(facility) : null;
    if (ground && m.home?.id != null && m.home.id !== OUR_CLUB_ID) {
      groundByClub.set(m.home.id, ground);
    }
  }
}

export function venueFor(m: UnifiedMatch): Venue {
  if (m.isHome) {
    const label = `${HOME_GROUND.name}, ${HOME_GROUND.address}`;
    return { label, query: `${HOME_GROUND.name}, ${HOME_GROUND.address}`, exact: true };
  }
  const known = m.home.id != null ? groundByClub.get(m.home.id) : undefined;
  if (known) return { label: known, query: known, exact: true };
  // Prijateljske imaju ručno upisano mjesto (npr. "Orahovica").
  if (m.venue) return { label: m.venue, query: `${m.home.name}, ${m.venue}`, exact: false };
  return { label: m.home.name, query: `${m.home.name} nogometno igralište`, exact: false };
}

/**
 * Naselje za vremensku prognozu (geokodira se u pregledniku, Open-Meteo):
 * Niza za domaće, mjesto iz poznatog igrališta ("NK Lila, Lila" → "Lila")
 * ili ručno upisano mjesto prijateljske. Kad mjesto ne znamo, null — bolje
 * bez prognoze nego prognoza za krivo mjesto.
 */
export function weatherPlace(m: UnifiedMatch): string | null {
  if (m.isHome) return "Niza";
  const v = venueFor(m);
  if (v.exact) return v.label.split(",").at(-1)?.trim() || null;
  return m.venue ?? null;
}

/** Google Maps: upute do točnog igrališta, inače pretraga koju posjetitelj sam potvrdi. */
export function mapsUrl(v: Venue): string {
  const q = encodeURIComponent(v.query);
  return v.exact
    ? `https://www.google.com/maps/dir/?api=1&destination=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
