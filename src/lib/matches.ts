/**
 * Objedinjeni popis utakmica: HNS Semafor (liga + kup, iz hns.json)
 * + ručno unesene prijateljske (friendlies.json).
 *
 * Sve stranice koje prikazuju raspored/rezultate/sljedeću utakmicu
 * trebaju čitati odavde umjesto direktno iz hns.json.
 */
import hns from "../data/hns.json";
import friendlies from "../data/friendlies.json";

export type MatchType = "league" | "cup" | "friendly";

export type TeamRef = {
  id: number | null;
  name: string;
  logo: string | null;
};

export type Scorer = { name: string; goals: number };

export type UnifiedMatch = {
  id: string;
  type: MatchType;
  /** cid natjecanja na HNS Semaforu; null za prijateljske. */
  competitionId: number | null;
  round: number | null;
  date: string;
  time: string | null;
  iso: string;
  competition: string;
  home: TeamRef;
  away: TeamRef;
  score: { home: number; away: number } | null;
  played: boolean;
  isHome: boolean;
  result: "W" | "D" | "L" | null;
  url: string | null;
  /** Mjesto igranja — samo za prijateljske (HNS utakmice ga nemaju u listi). */
  venue: string | null;
  /** Naši strijelci — samo za prijateljske (HNS ima matchDetails). */
  scorers: Scorer[];
};

type FriendlyEntry = {
  date: string;
  time: string | null;
  opponent: string;
  opponentId?: number | null;
  opponentLogo?: string | null;
  opponentUrl?: string | null;
  isHome: boolean;
  venue: string | null;
  competition: string | null;
  score: { home: number; away: number } | null;
  scorers: Scorer[] | null;
};

export const OUR_CLUB_ID = 134;

const OUR_TEAM: TeamRef = {
  id: OUR_CLUB_ID,
  name: "NK Omladinac Niza",
  logo: null, // komponente za id 134 renderiraju <Logo />
};

function friendlyToMatch(f: FriendlyEntry): UnifiedMatch {
  const time = f.time || null;
  const iso = time ? `${f.date}T${time}:00` : `${f.date}T00:00:00`;
  const opponent: TeamRef = {
    id: f.opponentId ?? null,
    name: f.opponent,
    logo: f.opponentLogo ?? null,
  };
  const score = f.score ?? null;

  let result: "W" | "D" | "L" | null = null;
  if (score) {
    const ours = f.isHome ? score.home : score.away;
    const theirs = f.isHome ? score.away : score.home;
    result = ours > theirs ? "W" : ours < theirs ? "L" : "D";
  }

  return {
    id: `pr-${f.date}`,
    type: "friendly",
    competitionId: null,
    round: null,
    date: f.date,
    time,
    iso,
    competition: f.competition || "Prijateljska utakmica",
    home: f.isHome ? OUR_TEAM : opponent,
    away: f.isHome ? opponent : OUR_TEAM,
    score,
    played: score !== null,
    isHome: f.isHome,
    result,
    url: null,
    venue: f.venue ?? null,
    scorers: f.scorers ?? [],
  };
}

// HNS utakmice — starije verzije hns.json nemaju `type` ni `competitionId`
function hnsToUnified(m: any): UnifiedMatch {
  return {
    ...m,
    type: (m.type as MatchType) ?? "league",
    competitionId: (m.competitionId as number | undefined) ?? null,
    venue: null,
    scorers: [],
  };
}

const hnsMatches: UnifiedMatch[] = ((hns.matches ?? []) as any[]).map(hnsToUnified);

const friendlyMatches = (friendlies as FriendlyEntry[]).map(friendlyToMatch);

/** Sve utakmice (liga + kup + prijateljske), kronološki. */
export const allMatches: UnifiedMatch[] = [...hnsMatches, ...friendlyMatches].sort(
  (a, b) => a.iso.localeCompare(b.iso),
);

/** Današnji datum ("YYYY-MM-DD") u Europe/Zagreb. */
export const todayInZagreb = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zagreb",
}).format(new Date());

/** Neodigrane, uzlazno po datumu. */
export const upcoming = allMatches.filter((m) => !m.played);

/** Odigrane, silazno (najnovije prvo). */
export const played = allMatches
  .filter((m) => m.played)
  .sort((a, b) => b.iso.localeCompare(a.iso));

/**
 * Prva neodigrana utakmica čiji datum nije prošao; popis mora biti kronološki.
 * (Uvjet `date >= danas` sprječava da ručno unesena prijateljska bez
 * upisanog rezultata zauvijek ostane "sljedeća", a HNS utakmica bez
 * objavljenog rezultata ne ostane "sljedeća" dan nakon što je odigrana.)
 */
function firstUpcoming(list: UnifiedMatch[]): UnifiedMatch | null {
  return list.find((m) => !m.played && m.date >= todayInZagreb) ?? null;
}

/** Sljedeća seniorska utakmica (liga, kup ili prijateljska). */
export const nextMatch: UnifiedMatch | null = firstUpcoming(allMatches);

/** Offset Europe/Zagreb za zadani dan "YYYY-MM-DD", npr. "+02:00". */
export function zagrebOffset(day: string): string {
  // Podne izbjegava sat prelaska na ljetno/zimsko vrijeme (u 2-3 ujutro).
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Zagreb",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value; // "GMT+02:00"
  const offset = name?.replace("GMT", "");
  return offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "+01:00";
}

/**
 * Početak utakmice kao ISO sa zagrebačkim offsetom
 * ("2026-10-03T18:00:00+02:00"), da ga preglednik i Google ne čitaju u
 * svojoj zoni. Bez objavljenog vremena samo datum.
 */
export function kickoffIso(m: Pick<UnifiedMatch, "date" | "iso" | "time">): string {
  return m.time ? `${m.iso.slice(0, 19)}${zagrebOffset(m.date)}` : m.date;
}

/** Koliko dana od danas (Europe/Zagreb) do datuma "YYYY-MM-DD"; 0 = danas. */
export function daysFromToday(date: string): number {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((day(date) - day(todayInZagreb)) / 86_400_000);
}

/** Zadnjih N rezultata kroz sva natjecanja. */
export function lastResults(limit = 10): UnifiedMatch[] {
  return played.slice(0, limit);
}

/** Kratka oznaka natjecanja za badge (npr. "5. kolo", "Kup · 1/16 finala", "Prijateljska"). */
export function matchBadge(m: UnifiedMatch): string {
  if (m.type === "cup") {
    // "Kup NS Našice 26/27, 1/16 finala" → faza je dio nakon zareza
    const stage = m.competition?.includes(",")
      ? m.competition.split(",").pop()!.trim()
      : null;
    return stage ? `Kup · ${stage}` : "Kup";
  }
  if (m.type === "friendly")
    return m.competition && m.competition !== "Prijateljska utakmica"
      ? m.competition
      : "Prijateljska";
  return m.round ? `${m.round}. kolo` : "Liga";
}

/**
 * Kratak naziv natjecanja za zaglavlja kartica: "2. ŽNL · 6. kolo",
 * "Kup · 1/16 finala", "Prijateljska". Puni HNS naziv
 * ("2. ŽNL Našice - Seniori 26/27, 6. kolo") na mobitelu se lomi u dva reda.
 */
export function competitionShort(m: UnifiedMatch): string {
  if (m.type !== "league") return matchBadge(m);
  // "2. ŽNL Našice - Seniori 26/27, 6. kolo" → "2. ŽNL Našice" → "2. ŽNL"
  const league = m.competition.split(",")[0].split(" - ")[0].trim();
  const short = league.match(/^\d+\.\s*\S+/)?.[0] ?? league;
  return m.round ? `${short} · ${m.round}. kolo` : short;
}

/** Tailwind klase za badge po tipu natjecanja. */
export const badgeClass: Record<MatchType, string> = {
  league: "bg-club-primary text-white",
  cup: "bg-club-accent text-club-primary-deep",
  friendly: "bg-slate-500 text-white",
};

/** Naziv tipa natjecanja za filtere i naslove. */
export const typeLabel: Record<MatchType, string> = {
  league: "Liga",
  cup: "Kup",
  friendly: "Prijateljske",
};

/** Redoslijed kojim se tipovi prikazuju u filteru. */
export const typeOrder: MatchType[] = ["league", "cup", "friendly"];

/** Slug za URL hash — /raspored#kup je čitljivije od /raspored#cup. */
export const typeSlug: Record<MatchType, string> = {
  league: "liga",
  cup: "kup",
  friendly: "prijateljske",
};

/** Koliko utakmica po tipu ima u zadanom popisu — za brojke uz filter. */
export function countByType(list: UnifiedMatch[]): Record<MatchType, number> {
  const counts: Record<MatchType, number> = { league: 0, cup: 0, friendly: 0 };
  for (const m of list) counts[m.type]++;
  return counts;
}

// ───────── Natjecanja po uzrastu ────────────────────────────────────────
// Gornji izvozi pokrivaju seniore. Mlađe kategorije žive samo u
// `hns.competitions` — namjerno nisu u `allMatches` da ne upadnu u seniorski
// raspored i .ics. Do njih se dolazi kroz `competitionsFor()`.

export type AgeCategory = "Seniors" | "Beginners";

/** Jedan red ljestvice. */
export type LeagueRow = {
  position: number | null;
  club: { id: number | null; name: string; logo: string | null };
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  gf: number | null;
  ga: number | null;
  gd: string | null;
  points: number | null;
  form: string[];
  isUs: boolean;
};

/** Jedan zapis u ranking listi (strijelci / kartoni / nastupi). */
export type RankingEntry = {
  personId: number | null;
  position: number | null;
  name: string;
  photo: string | null;
  profileUrl: string | null;
  value: string;
  goals?: number;
  yellow?: number;
  red?: number;
  appearances?: number;
  minutes?: number;
};

export type CompetitionStats = {
  topScorers: RankingEntry[];
  topCards: RankingEntry[];
  topApps: RankingEntry[];
};

export type SquadPlayer = {
  id: number | null;
  number: number | null;
  name: string;
  position: string | null;
  photo: string | null;
  profileUrl: string | null;
  stats: { appearances: number; minutes: number; goals: number; cards: string };
};

export type Competition = {
  id: number | null;
  name: string;
  type: MatchType;
  ageCategory: AgeCategory;
  url: string | null;
  matches: UnifiedMatch[];
  table: LeagueRow[];
  players: SquadPlayer[];
  stats: CompetitionStats;
};

/** Ima li natjecanje ijednu objavljenu ranking listu. */
export function hasStats(stats: CompetitionStats): boolean {
  return (
    stats.topScorers.length > 0 ||
    stats.topCards.length > 0 ||
    stats.topApps.length > 0
  );
}

/**
 * Natjecanja jednog uzrasta — "Seniors" (seniori) ili "Beginners" (početnici U-11).
 * Vraća prazan niz ako HNS za taj uzrast nema ništa objavljeno.
 *
 * `players` i `stats` su prazni dok se ne odigraju prve utakmice — HNS ih
 * objavi tek tada (kod seniora se to vidjelo na kupu). Stranice ih zato
 * moraju znati sakriti.
 */
export function competitionsFor(age: AgeCategory): Competition[] {
  return ((hns.competitions ?? []) as any[])
    .filter((c) => c.ageCategory === age)
    .map((c) => ({
      id: c.id ?? null,
      name: c.name ?? "",
      type: (c.type as MatchType) ?? "league",
      ageCategory: c.ageCategory as AgeCategory,
      url: c.url ?? null,
      matches: ((c.matches ?? []) as any[]).map(hnsToUnified),
      table: (c.table ?? []) as LeagueRow[],
      players: (c.players ?? []) as SquadPlayer[],
      stats: {
        topScorers: (c.stats?.topScorers ?? []) as RankingEntry[],
        topCards: (c.stats?.topCards ?? []) as RankingEntry[],
        topApps: (c.stats?.topApps ?? []) as RankingEntry[],
      } satisfies CompetitionStats,
    }));
}

/**
 * Sljedeća utakmica početnika (U-11), kroz sva njihova natjecanja.
 * Nije u `allMatches` (vidi gore), pa ima svoj izvoz za naslovnicu.
 */
export const nextYouthMatch: UnifiedMatch | null = firstUpcoming(
  competitionsFor("Beginners")
    .flatMap((c) => c.matches)
    .sort((a, b) => a.iso.localeCompare(b.iso)),
);
