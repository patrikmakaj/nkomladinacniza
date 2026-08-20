/**
 * Zapisivanje generiranih JSON-a bez praznog hoda.
 *
 * Scraperi su na svakom prolazu upisivali svjež `lastUpdated`, pa se datoteka
 * uvijek razlikovala od one u repou. Posljedica: GitHub Action je commitao i
 * deployao stranicu svakih 30 minuta i kad se nije promijenilo baš ništa —
 * od 39 uzastopnih botovskih commitova njih 35 mijenjalo je samo taj timestamp.
 *
 * `writeJsonIfChanged` uspoređuje sadržaj bez polja koja se ionako mijenjaju
 * svaki put, pa datoteku dira samo kad se stvarno nešto promijenilo.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Kopija objekta bez zadanih ključeva (plitko, dovoljno za naše JSON-e). */
function omit(obj, keys) {
  if (!obj || typeof obj !== "object") return obj;
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * Zapiši JSON samo ako se sadržaj promijenio.
 *
 * @param {string} path        odredišna datoteka
 * @param {unknown} data       podaci za zapis
 * @param {object} [options]
 * @param {string[]} [options.ignore]  polja koja se ne broje kao promjena
 * @param {string} [options.label]     prefiks u logu, npr. "[scrape]"
 * @returns {Promise<boolean>} je li datoteka zapisana
 */
export async function writeJsonIfChanged(path, data, options = {}) {
  const { ignore = ["lastUpdated"], label = "[write]" } = options;
  const serialized = JSON.stringify(data, null, 2) + "\n";

  try {
    const existingRaw = await readFile(path, "utf8");
    const existing = JSON.parse(existingRaw);
    if (JSON.stringify(omit(existing, ignore)) === JSON.stringify(omit(data, ignore))) {
      console.log(`${label} podaci nepromijenjeni — datoteka ostaje netaknuta`);
      return false;
    }
  } catch {
    // datoteka ne postoji ili nije valjan JSON — pišemo je svakako
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialized, "utf8");
  console.log(`${label} zapisano: ${path}`);
  return true;
}
