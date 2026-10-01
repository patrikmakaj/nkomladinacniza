/**
 * Jedna nadolazeća utakmica kao .ics — gumb "Dodaj u kalendar" na
 * naslovnici i na najavi utakmice. Za stalnu pretplatu je /raspored.ics.
 *
 * Gradi se za neodigrane utakmice seniora i početnika (U-11).
 */
import type { APIContext } from "astro";
import { upcoming, competitionsFor, todayInZagreb, type UnifiedMatch } from "../../lib/matches";
import { buildCalendar } from "../../lib/ics";

export function getStaticPaths() {
  const youth = competitionsFor("Beginners").flatMap((c) => c.matches);
  const list = [...upcoming, ...youth].filter((m) => !m.played && m.date >= todayInZagreb);
  const byId = new Map(list.map((m) => [m.id, m]));
  return [...byId.values()].map((m) => ({ params: { id: m.id }, props: { match: m } }));
}

export async function GET({ props }: APIContext<{ match: UnifiedMatch }>) {
  const m = props.match;
  const body = buildCalendar([m], { name: `${m.home.name} – ${m.away.name}` });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="omladinac-${m.date}.ics"`,
    },
  });
}
