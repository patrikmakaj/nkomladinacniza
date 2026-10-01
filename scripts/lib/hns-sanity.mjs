/**
 * Zaštita od tihog kvara HNS scrapera.
 *
 * Ako HNS promijeni HTML, parser ne pukne nego vrati prazne nizove — i
 * `hns.json` bi se prepisao praznim rasporedom i ljestvicom. Stranica bi
 * pisala "Nema rasporeda", a nitko ne bi znao zašto.
 *
 * `findDataLoss` uspoređuje svježe podatke s postojećima i vraća popis
 * problema; scraper tada ne piše ništa, a CI job `upozorenje` pukne da
 * GitHub pošalje obavijest. Namjerno gleda samo pad "nešto → ništa" unutar
 * iste sezone: na prijelazu sezone prazan raspored je normalan (HNS ga još
 * nije objavio), a pad broja utakmica zna biti legitiman (vidi 3a u CLAUDE.md).
 */

/**
 * @param {any} prev postojeći hns.json
 * @param {any} next svježe parsirani podaci
 * @returns {string[]} opisi problema; prazno = sve u redu
 */
export function findDataLoss(prev, next) {
  if (!prev) return [];
  const prevSeason = prev.competition?.season ?? null;
  const nextSeason = next.competition?.season ?? null;

  const problems = [];
  if (prevSeason && !nextSeason) {
    problems.push(`sezona se ne može pročitati (prije "${prevSeason}")`);
  } else if (prevSeason && nextSeason && prevSeason !== nextSeason) {
    return []; // nova sezona — prazni podaci su očekivani
  }

  const count = (v) => (Array.isArray(v) ? v.length : 0);
  if (count(prev.matches) > 0 && count(next.matches) === 0) {
    problems.push(`nema seniorskih utakmica (prije: ${count(prev.matches)})`);
  }
  if (count(prev.table) > 0 && count(next.table) === 0) {
    problems.push(`ljestvica je prazna (prije: ${count(prev.table)})`);
  }
  return problems;
}
