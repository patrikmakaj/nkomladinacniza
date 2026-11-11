/**
 * Praćenje ispada HNS Semafora između CI prolaza.
 *
 * Od 10.11.2026. Semafor (Cloudflare) otprilike svaki drugi zahtjev s GitHub
 * runnera odbije s HTTP 403. Scraper je na to izlazio s kodom 1, pa je
 * `npm run scrape` prekidao lanac (prijateljske, slike, Facebook, pikado
 * se nisu ni pokrenuli), a deploy se preskakao i na push u main.
 *
 * Sad je 403 prolazna greška kao i 52x: scraper zadrži postojeći hns.json
 * i izađe s 0. Da trajni kvar (npr. Cloudflare trajno blokira runnere) ne
 * prođe nezapaženo, ovdje se pamti od kad Semafor ne odgovara. Datoteka je
 * u `.cache/` (nije u gitu), a CI je prenosi između runova kroz
 * `actions/cache`. Kad ispad traje dulje od `ALERT_AFTER_HOURS`, scraper
 * postavi `hns_anomaly` i job `upozorenje` pukne — isto kao kod
 * sumnjivo praznih podataka (`hns-sanity.mjs`).
 *
 * Povremeni 403 (pa uspjeh) resetira brojač i ne javlja ništa: podaci
 * kasne pola sata, što nije vrijedno maila. Ako cache nestane (GitHub ga
 * briše nakon 7 dana bez korištenja), brojanje samo krene ispočetka.
 *
 * Kraj ispada se ZAPISUJE (`since: null`), ne briše datoteku: cache vraća
 * najnoviji spremljeni unos, pa bi nakon brisanja sljedeći run dobio natrag
 * stari ispad i digao lažnu uzbunu. Scraper postavi `hns_outage_changed`
 * samo kad je nešto zapisao, a CI tek tada sprema cache — u normalnom
 * radu ne nastaje ni jedan unos.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Nakon koliko sati neprekidnog ispada se diže uzbuna. */
export const ALERT_AFTER_HOURS = 6;

/** Trenutni ispad ili null ako ga nema. */
async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    return state?.since ? state : null;
  } catch {
    return null;
  }
}

/**
 * Zabilježi neuspjeli prolaz. Vraća poruku za `hns_anomaly` ako ispad traje
 * dovoljno dugo, inače null.
 *
 * @param {string} path
 * @param {string} errorMessage
 * @param {Date} [now]
 * @returns {Promise<{ since: string, failures: number, alert: string | null }>}
 */
export async function recordOutage(path, errorMessage, now = new Date()) {
  const prev = await readState(path);
  const state = {
    since: prev?.since ?? now.toISOString(),
    failures: (prev?.failures ?? 0) + 1,
    lastError: errorMessage,
  };
  await save(path, state);
  return { ...state, alert: outageAlert(state, now) };
}

/**
 * Semafor je odgovorio — ispad (ako ga je bilo) je gotov.
 * Vraća završeni ispad ili null ako ga nije bilo (tada ništa ne piše).
 */
export async function clearOutage(path, now = new Date()) {
  const prev = await readState(path);
  if (prev) await save(path, { since: null, endedAt: now.toISOString() });
  return prev;
}

async function save(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n");
}

/**
 * @param {{ since: string, failures: number, lastError: string }} state
 * @param {Date} now
 * @returns {string | null}
 */
export function outageAlert(state, now) {
  const hours = (now.getTime() - new Date(state.since).getTime()) / 3_600_000;
  if (!(hours >= ALERT_AFTER_HOURS)) return null;
  return (
    `HNS Semafor ne odgovara ${Math.floor(hours)} h ` +
    `(od ${state.since}, neuspjelih prolaza zaredom: ${state.failures}); ` +
    `zadnja greška: ${state.lastError}. Stranica prikazuje stare podatke.`
  );
}
