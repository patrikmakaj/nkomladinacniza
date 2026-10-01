/**
 * Facebook objave kluba uparene s utakmicama: izvještaj nakon utakmice i
 * najava prije nje. Klub ih ionako piše — ovako se pojave i uz utakmicu.
 *
 * Nema ručnog označavanja, pa se uparuje heuristikom:
 *  - objava mora imati tekst i spominjati protivnika (bilo koju riječ imena,
 *    s padežnim nastavkom: "Lili", "Stipanovcima", "Motičini")
 *  - izvještaj = PRVA takva objava u 48 h nakon početka utakmice
 *  - najava    = ZADNJA takva objava u 7 dana prije početka, a da već nije
 *    izvještaj neke druge utakmice ("Poraz u Stipanovcima… iduće kolo protiv
 *    Martina" je izvještaj za Stipanovce, ne najava za Martin)
 * Objave poput "Čestitke gostima." bez imena protivnika namjerno se ne
 * uparuju — bolje ništa nego kriva objava uz utakmicu.
 *
 * Vrijeme objave je u UTC-u, a početak utakmice u Zagrebu — zato kickoffIso.
 */
import facebook from "../data/facebook.json";
import { allMatches, kickoffIso, type UnifiedMatch } from "./matches";

export type MatchPost = {
  id: string;
  message: string;
  createdAt: string;
  permalink: string | null;
  image: { src: string; thumb?: string | null; width?: number | null; height?: number | null } | null;
};

const HOUR = 60 * 60 * 1000;
const REPORT_WINDOW = 48 * HOUR;
const PREVIEW_WINDOW = 7 * 24 * HOUR;

const posts: (MatchPost & { at: number })[] = ((facebook.posts ?? []) as any[])
  .map((p) => {
    const raw = (p.images ?? [])[0];
    const image = typeof raw === "string" ? { src: raw } : (raw ?? null);
    return {
      id: String(p.id),
      message: String(p.message ?? "").trim(),
      createdAt: String(p.createdAt),
      permalink: p.permalink ?? null,
      image,
      at: Date.parse(p.createdAt),
    };
  })
  .filter((p) => p.message && !Number.isNaN(p.at))
  .sort((a, b) => a.at - b.at);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Uzorci za ime protivnika. Kratke riječi se uspoređuju gotovo cijele
 * ("Lug" ne smije pogoditi "Luka"), duže po korijenu, da prođu padeži
 * i nepostojano a ("Stipanovci" → "Stipano…" pogađa i "Stipanovaca").
 */
function opponentPatterns(m: UnifiedMatch): RegExp[] {
  const opponent = m.isHome ? m.away : m.home;
  return opponent.name
    .replace(/\(.*?\)/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(H?NK|ŠNK|NŠK)$/i.test(t))
    .map((token) => {
      const chars = [...token];
      const n = chars.length;
      const stemLen = n <= 3 ? n : n <= 5 ? n - 1 : Math.max(5, n - 3);
      const stem = escapeRe(chars.slice(0, stemLen).join(""));
      // Nastavak: odrezani dio + padež ("Stipano" + "vcima").
      const suffix = n - stemLen + 3;
      // \b ne radi s č/ć/š/ž/đ — granice riječi preko \p{L}
      return new RegExp(`(?<!\\p{L})${stem}\\p{L}{0,${suffix}}(?!\\p{L})`, "u");
    });
}

const mentions = (m: UnifiedMatch, text: string) => opponentPatterns(m).some((re) => re.test(text));

const reports = new Map<string, MatchPost>();
const previews = new Map<string, MatchPost>();

const withKickoff = allMatches
  .map((m) => ({ m, kickoff: Date.parse(kickoffIso(m)) }))
  .filter(({ kickoff }) => !Number.isNaN(kickoff));

const usedAsReport = new Set<string>();
for (const { m, kickoff } of withKickoff) {
  if (!m.played) continue;
  const post = posts.find(
    (p) => p.at >= kickoff && p.at <= kickoff + REPORT_WINDOW && !usedAsReport.has(p.id) && mentions(m, p.message),
  );
  if (post) {
    reports.set(m.id, post);
    usedAsReport.add(post.id);
  }
}

for (const { m, kickoff } of withKickoff) {
  const candidates = posts.filter(
    (p) => p.at < kickoff && p.at >= kickoff - PREVIEW_WINDOW && !usedAsReport.has(p.id) && mentions(m, p.message),
  );
  const post = candidates.at(-1);
  if (post) previews.set(m.id, post);
}

/** Izvještaj kluba s Facebooka za odigranu utakmicu. */
export function matchReport(matchId: string): MatchPost | null {
  return reports.get(matchId) ?? null;
}

/** Najava kluba s Facebooka za utakmicu. */
export function matchPreview(matchId: string): MatchPost | null {
  return previews.get(matchId) ?? null;
}
