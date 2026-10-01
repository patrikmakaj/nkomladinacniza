/**
 * OG slika najave: "NAJAVA · subota, 3. listopada · 18:00 · Iskrica – Omladinac".
 * Isti stil kao slika rezultata (/utakmica/[id].png), umjesto rezultata vrijeme.
 */
import type { APIRoute } from "astro";
import { renderOgPng } from "../../lib/og";
import { allMatches, competitionShort, OUR_CLUB_ID, type UnifiedMatch } from "../../lib/matches";
import { venueFor } from "../../lib/venue";

const OUR_NAME = "NK OMLADINAC NIZA";

export function getStaticPaths() {
  return allMatches
    .filter((m) => !m.played)
    .map((m) => ({ params: { id: m.id }, props: { match: m } }));
}

export const GET: APIRoute = async ({ props }) => {
  const m = (props as { match: UnifiedMatch }).match;

  const dateObj = new Date(m.iso);
  const dateLabel = dateObj
    .toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();
  const big = m.time ?? dateObj.toLocaleDateString("hr-HR", { day: "numeric", month: "numeric" });
  const sub = m.time ? dateLabel : "VRIJEME NAKNADNO";
  const venue = venueFor(m);
  const where = m.isHome ? "Doma · Grbavica, Niza" : `Gosti · ${venue.exact ? venue.label : m.home.name}`;
  const competition = competitionShort(m).toUpperCase();

  const homeIsUs = m.home.id === OUR_CLUB_ID;
  const homeName = homeIsUs ? OUR_NAME : m.home.name.toUpperCase();
  const awayName = homeIsUs ? m.away.name.toUpperCase() : OUR_NAME;

  const cacheKey = JSON.stringify({ v: 1, id: m.id, homeName, awayName, big, sub, where, competition });

  const teamName = (name: string, isUs: boolean, align: "left" | "right") => ({
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "330px",
        fontFamily: "Oswald",
        fontSize: "44px",
        fontWeight: isUs ? 700 : 500,
        lineHeight: 1.05,
        color: isUs ? "#fbbf24" : "white",
        textAlign: align,
        alignItems: align === "left" ? "flex-start" : "flex-end",
      },
      children: name,
    },
  });

  const tree = {
    type: "div",
    props: {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(135deg, #0f2c6e 0%, #1e3d8c 50%, #0a1f4f 100%)",
        color: "white",
        fontFamily: "Inter",
        padding: "60px 80px",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "Oswald",
              fontSize: "22px",
              fontWeight: 600,
              letterSpacing: "2px",
              color: "rgba(255,255,255,0.85)",
            },
            children: [
              { type: "div", props: { children: "OMLADINACNIZA.HR" } },
              { type: "div", props: { children: competition } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              marginTop: "30px",
              alignSelf: "flex-start",
              background: "#d4b659",
              color: "#0f2c6e",
              padding: "8px 24px",
              borderRadius: "999px",
              fontFamily: "Oswald",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "3px",
            },
            children: "NAJAVA",
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexGrow: 1,
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "20px",
            },
            children: [
              teamName(homeName, homeIsUs, "left"),
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          fontFamily: "Oswald",
                          fontSize: "150px",
                          fontWeight: 700,
                          lineHeight: 1,
                          color: "#d4b659",
                        },
                        children: big,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          marginTop: "12px",
                          fontFamily: "Oswald",
                          fontSize: "28px",
                          fontWeight: 500,
                          letterSpacing: "2px",
                          color: "rgba(255,255,255,0.9)",
                        },
                        children: sub,
                      },
                    },
                  ],
                },
              },
              teamName(awayName, !homeIsUs, "right"),
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "center",
              marginTop: "20px",
              fontFamily: "Inter",
              fontSize: "26px",
              fontWeight: 500,
              color: "rgba(255,255,255,0.75)",
            },
            children: where,
          },
        },
      ],
    },
  };

  return renderOgPng(tree, { name: `najava-${m.id}`, cacheKey });
};
