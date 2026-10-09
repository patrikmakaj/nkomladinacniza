/**
 * Plakat najave za Facebook/Instagram: /najava/123/plakat.jpg (4:5) i
 * /najava/123/story.jpg (9:16). Crta ga lib/poster.ts.
 */
import type { APIRoute } from "astro";
import { allMatches, type UnifiedMatch } from "../../../lib/matches";
import { POSTER_SIZE, renderPoster, type PosterFormat } from "../../../lib/poster";

export function getStaticPaths() {
  return allMatches
    .filter((m) => !m.played)
    .flatMap((m) =>
      (Object.keys(POSTER_SIZE) as PosterFormat[]).map((format) => ({
        params: { id: m.id, format },
        props: { match: m, format },
      })),
    );
}

export const GET: APIRoute = ({ props }) => {
  const { match, format } = props as { match: UnifiedMatch; format: PosterFormat };
  return renderPoster("najava", match, format);
};
