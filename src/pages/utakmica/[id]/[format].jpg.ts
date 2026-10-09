/**
 * Plakat rezultata za Facebook/Instagram: /utakmica/123/plakat.jpg (4:5) i
 * /utakmica/123/story.jpg (9:16). Samo za utakmice sa stranicom detalja
 * (odigrane, s matchDetails) — tamo je i gumb za preuzimanje.
 */
import type { APIRoute } from "astro";
import hns from "../../../data/hns.json";
import { played, type UnifiedMatch } from "../../../lib/matches";
import { POSTER_SIZE, renderPoster, type PosterFormat } from "../../../lib/poster";

export function getStaticPaths() {
  const details = (hns.matchDetails ?? {}) as Record<string, unknown>;
  return played
    .filter((m) => details[m.id])
    .flatMap((m) =>
      (Object.keys(POSTER_SIZE) as PosterFormat[]).map((format) => ({
        params: { id: m.id, format },
        props: { match: m, format },
      })),
    );
}

export const GET: APIRoute = ({ props }) => {
  const { match, format } = props as { match: UnifiedMatch; format: PosterFormat };
  return renderPoster("rezultat", match, format);
};
