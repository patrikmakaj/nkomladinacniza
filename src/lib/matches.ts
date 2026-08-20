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
const hnsMatches: UnifiedMatch[] = ((hns.matches ?? []) as any[]).map((m) => ({
  ...m,
  type: (m.type as MatchType) ?? "league",
  competitionId: (m.competitionId as number | undefined) ?? null,
  venue: null,
  scorers: [],
}));

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
 * Sljedeća utakmica: prva neodigrana čiji datum nije prošao.
 * (Uvjet `date >= danas` sprječava da ručno unesena prijateljska bez
 * upisanog rezultata zauvijek ostane "sljedeća".)
 */
export const nextMatch: UnifiedMatch | null =
  upcoming.find((m) => m.date >= todayInZagreb) ?? null;

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
