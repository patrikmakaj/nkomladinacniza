/**
 * Arhiva sezona.
 *
 * Kad HNS prijeđe na novu sezonu, scraper prepiše hns.json i stara ljestvica,
 * rezultati i strijelci nestanu sa stranice (ostanu samo u git povijesti —
 * tako se umalo izgubila prvakinja sezona 2025/26). Zato se pri promjeni
 * sezone stari hns.json sažme u src/data/sezone/<2025-26>.json, a
 * /sezona/[slug] ga prikazuje.
 *
 * Sažetak je namjerno vitak: bez fotki (hotlinkovi s HNS-a s vremenom
 * puknu), bez postava i sudaca — ljestvica, rezultati sa strijelcima,
 * rang-liste i roster sa zbrojenom statistikom. Samo seniori.
 *
 * Podržava i stari oblik hns.json (bez `competitions`, do kolovoza 2026.).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./write-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ARCHIVE_DIR = path.join(ROOT, "src/data/sezone");

/** "2025/26" → "2025-26" */
export const seasonSlug = (season) => String(season).replace("/", "-");

/** "2025/26" → ["2025-07-01", "2026-06-30"] — za prijateljske te sezone. */
function seasonRange(season) {
  const start = Number(String(season).slice(0, 4));
  return [`${start}-07-01`, `${start + 1}-06-30`];
}

const team = (t) => (t ? { id: t.id ?? null, name: t.name, logo: t.logo ?? null } : null);

const goalsOf = (events = []) =>
  events
    .filter((e) => ["goal", "penalty", "own_goal"].includes(e.type) && e.playerName)
    .map((e) => ({ minute: e.minute ?? null, name: e.playerName, type: e.type }));

const ranking = (list = [], valueKey) =>
  list.map((p) => ({
    personId: p.personId ?? null,
    name: p.name,
    [valueKey]: p[valueKey] ?? null,
    ...(valueKey === "yellow" ? { red: p.red ?? 0 } : {}),
  }));

/**
 * @param {any} hns        hns.json sezone koja završava
 * @param {any[]} friendlies friendlies.json (uzimaju se one iz te sezone)
 */
export function buildArchive(hns, friendlies = []) {
  const season = hns?.competition?.season;
  if (!season) throw new Error("hns.json nema competition.season");

  const comps = hns.competitions?.length
    ? hns.competitions.filter((c) => c.ageCategory === "Seniors")
    : [{ name: hns.competition?.name, type: "league", table: hns.table, matches: hns.matches }];
  const details = hns.matchDetails ?? {};
  const [from, to] = seasonRange(season);

  return {
    season,
    slug: seasonSlug(season),
    competitions: comps.map((c) => ({
      name: c.name ?? "",
      type: c.type ?? "league",
      table: (c.table ?? []).map((r) => ({
        position: r.position ?? null,
        club: team(r.club),
        played: r.played ?? null,
        wins: r.wins ?? null,
        draws: r.draws ?? null,
        losses: r.losses ?? null,
        gf: r.gf ?? null,
        ga: r.ga ?? null,
        gd: r.gd ?? null,
        points: r.points ?? null,
        isUs: !!r.isUs,
      })),
      matches: (c.matches ?? []).map((m) => {
        const ev = details[m.id]?.headerEvents;
        return {
          id: String(m.id),
          round: m.round ?? null,
          date: m.date,
          time: m.time ?? null,
          competition: m.competition ?? c.name ?? "",
          home: team(m.home),
          away: team(m.away),
          score: m.score ?? null,
          played: !!m.played,
          isHome: !!m.isHome,
          result: m.result ?? null,
          goals: ev ? { home: goalsOf(ev.home), away: goalsOf(ev.away) } : null,
        };
      }),
    })),
    friendlies: (friendlies ?? []).filter((f) => f.date >= from && f.date <= to),
    stats: {
      topScorers: ranking(hns.stats?.topScorers, "goals"),
      topApps: ranking(hns.stats?.topApps, "appearances"),
      topCards: ranking(hns.stats?.topCards, "yellow"),
    },
    squad: (hns.players ?? []).map((p) => ({
      id: p.id ?? null,
      number: p.number ?? null,
      name: p.name,
      position: p.position ?? null,
      stats: p.stats ?? null,
    })),
  };
}

/**
 * Zapiši arhivu sezone ako je još nema. Postojeća se ne prepisuje — prvi
 * zapis je stanje u trenutku prelaska, kasniji bi već bio nova sezona.
 * @returns {Promise<string|null>} putanja zapisane datoteke
 */
export async function archiveSeason(hns, friendlies, { label = "[sezona]" } = {}) {
  const archive = buildArchive(hns, friendlies);
  const file = path.join(ARCHIVE_DIR, `${archive.slug}.json`);
  if (existsSync(file)) {
    console.log(`${label} arhiva ${archive.season} već postoji — ne diram je`);
    return null;
  }
  await writeJsonIfChanged(file, archive, { ignore: [], label });
  return file;
}
