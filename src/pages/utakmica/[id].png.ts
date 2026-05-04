import type { APIRoute } from "astro";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import hns from "../../data/hns.json";

// Cache PNG-ova po sadržaju utakmice — preskoči generiranje ako je
// (id + score + imena + competition) hash isti. CI cache (GitHub Actions)
// može cache-ati .cache/og kroz buildove.
const CACHE_DIR = path.resolve(".cache/og");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const OUR_CLUB_ID = 134;
const OUR_NAME = "NK OMLADINAC NIZA";

const oswaldBold = fs.readFileSync(
  path.resolve("./src/assets/fonts/Oswald-Bold.woff")
);
const oswaldMedium = fs.readFileSync(
  path.resolve("./src/assets/fonts/Oswald-Medium.woff")
);
const interMedium = fs.readFileSync(
  path.resolve("./src/assets/fonts/Inter-Medium.woff")
);
const interBold = fs.readFileSync(
  path.resolve("./src/assets/fonts/Inter-Bold.woff")
);

type Match = {
  id: string;
  iso: string;
  competition: string;
  home: { id: number; name: string };
  away: { id: number; name: string };
  score: { home: number; away: number } | null;
  played: boolean;
};

export async function getStaticPaths() {
  const matches = (hns.matches ?? []) as Match[];
  return matches
    .filter((m) => m.played && m.score)
    .map((m) => ({ params: { id: m.id } }));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("hr-HR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function shortCompetition(c: string): string {
  // "LIGA NS Našice - Seniori 25/26, 18. kolo" -> "18. KOLO · LIGA NS NAŠICE"
  const m = c.match(/(\d+)\.\s*kolo/i);
  const round = m ? `${m[1]}. KOLO` : "";
  const liga = c.includes("Našice") ? "LIGA NS NAŠICE" : c.toUpperCase();
  return [round, liga].filter(Boolean).join(" · ");
}

export const GET: APIRoute = async ({ params }) => {
  const match = (hns.matches as Match[]).find((m) => m.id === params.id);
  if (!match || !match.score) {
    return new Response("Not found", { status: 404 });
  }

  // Cache key: sve što utječe na vizualni izgled OG slike
  const cacheKey = JSON.stringify({
    id: match.id,
    home: match.home.name,
    away: match.away.name,
    homeId: match.home.id,
    awayId: match.away.id,
    score: match.score,
    iso: match.iso,
    competition: match.competition,
  });
  const hash = crypto
    .createHash("sha256")
    .update(cacheKey)
    .digest("hex")
    .slice(0, 16);
  const cachePath = path.join(CACHE_DIR, `${match.id}-${hash}.png`);

  if (fs.existsSync(cachePath)) {
    return new Response(new Uint8Array(fs.readFileSync(cachePath)), {
      headers: { "Content-Type": "image/png", "X-Cache": "HIT" },
    });
  }

  const isHome = match.home.id === OUR_CLUB_ID;
  const ourScore = isHome ? match.score.home : match.score.away;
  const oppScore = isHome ? match.score.away : match.score.home;
  const oppName = isHome ? match.away.name : match.home.name;
  const result =
    ourScore > oppScore ? "POBJEDA"
    : ourScore < oppScore ? "PORAZ"
    : "NERIJEŠENO";
  const resultColor =
    ourScore > oppScore ? "#16a34a"
    : ourScore < oppScore ? "#dc2626"
    : "#ca8a04";

  const homeName = isHome ? OUR_NAME : match.home.name.toUpperCase();
  const awayName = isHome ? match.away.name.toUpperCase() : OUR_NAME;
  const homeIsUs = isHome;

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(135deg, #0f2c6e 0%, #1e3d8c 50%, #0a1f4f 100%)",
          color: "white",
          fontFamily: "Inter",
          padding: "60px 80px",
          position: "relative",
        },
        children: [
          // Top row: club tagline + competition
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
                {
                  type: "div",
                  props: { children: shortCompetition(match.competition) },
                },
              ],
            },
          },
          // Result badge
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                marginTop: "30px",
                alignSelf: "flex-start",
                background: resultColor,
                padding: "8px 24px",
                borderRadius: "999px",
                fontFamily: "Oswald",
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "3px",
              },
              children: result,
            },
          },
          // Main row: home  score  away
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexGrow: 1,
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "30px",
              },
              children: [
                // Home name
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      width: "360px",
                      fontFamily: "Oswald",
                      fontSize: "44px",
                      fontWeight: homeIsUs ? 700 : 500,
                      lineHeight: 1.05,
                      color: homeIsUs ? "#fbbf24" : "white",
                      textAlign: "left",
                    },
                    children: homeName,
                  },
                },
                // Score
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "30px",
                      fontFamily: "Oswald",
                      fontSize: "180px",
                      fontWeight: 700,
                      lineHeight: 1,
                    },
                    children: [
                      {
                        type: "div",
                        props: { children: String(match.score.home) },
                      },
                      {
                        type: "div",
                        props: {
                          style: { color: "rgba(255,255,255,0.4)" },
                          children: ":",
                        },
                      },
                      {
                        type: "div",
                        props: { children: String(match.score.away) },
                      },
                    ],
                  },
                },
                // Away name
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      width: "360px",
                      fontFamily: "Oswald",
                      fontSize: "44px",
                      fontWeight: !homeIsUs ? 700 : 500,
                      lineHeight: 1.05,
                      color: !homeIsUs ? "#fbbf24" : "white",
                      textAlign: "right",
                    },
                    children: awayName,
                  },
                },
              ],
            },
          },
          // Bottom: date
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "center",
                marginTop: "30px",
                fontFamily: "Inter",
                fontSize: "26px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.75)",
              },
              children: formatDate(match.iso),
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Oswald", data: oswaldBold, style: "normal", weight: 700 },
        { name: "Oswald", data: oswaldMedium, style: "normal", weight: 500 },
        { name: "Oswald", data: oswaldBold, style: "normal", weight: 600 },
        { name: "Inter", data: interMedium, style: "normal", weight: 500 },
        { name: "Inter", data: interBold, style: "normal", weight: 700 },
      ],
    }
  );

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  })
    .render()
    .asPng();

  // Cache na disk za sljedeći build
  try {
    fs.writeFileSync(cachePath, png);
  } catch {
    // Ako nije moguće pisati u cache (npr. read-only FS), tiho ignoriraj
  }

  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "X-Cache": "MISS" },
  });
};
