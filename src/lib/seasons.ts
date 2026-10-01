/**
 * Arhivirane sezone (src/data/sezone/*.json) — zapisuje ih scraper kad HNS
 * prijeđe na novu sezonu (scripts/lib/season-archive.mjs), ili ručno
 * `node scripts/archive-season.mjs` iz git povijesti.
 */
import type { LeagueRow, MatchType, TeamRef, UnifiedMatch } from "./matches";

export type ArchiveGoal = { minute: number | null; name: string; type: string };

export type ArchiveMatch = {
  id: string;
  round: number | null;
  date: string;
  time: string | null;
  competition: string;
  home: TeamRef;
  away: TeamRef;
  score: { home: number; away: number } | null;
  played: boolean;
  isHome: boolean;
  result: "W" | "D" | "L" | null;
  goals: { home: ArchiveGoal[]; away: ArchiveGoal[] } | null;
};

export type ArchiveCompetition = {
  name: string;
  type: MatchType;
  table: Omit<LeagueRow, "form">[];
  matches: ArchiveMatch[];
};

export type SeasonArchive = {
  season: string;
  slug: string;
  competitions: ArchiveCompetition[];
  friendlies: any[];
  stats: {
    topScorers: { personId: number | null; name: string; goals: number | null }[];
    topApps: { personId: number | null; name: string; appearances: number | null }[];
    topCards: { personId: number | null; name: string; yellow: number | null; red?: number }[];
  };
  squad: {
    id: number | null;
    number: number | null;
    name: string;
    position: string | null;
    stats: { appearances: number; minutes: number; goals: number; cards: string } | null;
  }[];
};

const modules = import.meta.glob<SeasonArchive>("../data/sezone/*.json", {
  eager: true,
  import: "default",
});

/** Sve arhivirane sezone, najnovija prva. */
export const seasons: SeasonArchive[] = Object.values(modules).sort((a, b) =>
  b.season.localeCompare(a.season),
);

/** Liga sezone (ima ljestvicu), ako je ima. */
export function leagueOf(s: SeasonArchive): ArchiveCompetition | null {
  return s.competitions.find((c) => c.type === "league" && c.table.length) ?? null;
}

/** Ljestvica u obliku koji prima LeagueTable (arhiva ne čuva formu). */
export function tableRows(c: ArchiveCompetition): LeagueRow[] {
  return c.table.map((r) => ({ ...r, form: [] }));
}

/** Arhivska utakmica kao UnifiedMatch — da rade matchBadge/competitionShort. */
export function toUnified(m: ArchiveMatch, type: MatchType): UnifiedMatch {
  return {
    ...m,
    type,
    competitionId: null,
    iso: `${m.date}T${m.time ?? "00:00"}:00`,
    url: null,
    venue: null,
    scorers: [],
  };
}
