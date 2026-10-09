/**
 * Plakati za Facebook i Instagram — najava i rezultat utakmice.
 *
 * Klub je plakate "NEXT MATCH" / "REZULTAT" slagao ručno; sve što na njima
 * piše stranica već zna. Dva formata: 4:5 (1080×1350, objava) i 9:16
 * (1080×1920, story i WhatsApp status). Crta ih isti satori kao OG slike
 * (lib/og.ts), s cacheom po sadržaju.
 *
 * Slike na plakatu:
 *  - grbovi: lokalne kopije s HNS-a (crests.json). HNS ih daje 100×100 px,
 *    pa su na plakatu malo mekši; naš grb je vektorski (logo.svg).
 *  - pozadina: klupske boje ili zatamnjena fotka Grbavice (POSTER_BACKGROUND).
 *  - fotke igrača NE: HNS ih daje 80×100 px, premalo za plakat.
 */
import fs from "node:fs";
import path from "node:path";
import crests from "../data/crests.json";
import hns from "../data/hns.json";
import { renderImage } from "./og";
import { venueFor } from "./venue";
import { OUR_CLUB_ID, competitionShort, personName, type TeamRef, type UnifiedMatch } from "./matches";

export type PosterKind = "najava" | "rezultat";
export type PosterFormat = "plakat" | "story";

export const POSTER_SIZE: Record<PosterFormat, { width: number; height: number; label: string }> = {
  plakat: { width: 1080, height: 1350, label: "4:5" },
  story: { width: 1080, height: 1920, label: "9:16" },
};

/** "foto" = zatamnjena fotka Grbavice (src/assets/plakat/), "boje" = gradijent i grb. */
const POSTER_BACKGROUND: "foto" | "boje" = "foto";

const NAVY = "#0f2c6e";
const GOLD = "#d4b659";

const fileUri = (file: string, mime: string) =>
  `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;

const LOGO = fileUri(path.resolve("public/images/logo.svg"), "image/svg+xml");
const PHOTO_FILE = path.resolve("src/assets/plakat/grbavica.jpg");

/** Grb kao data URI; null ako ga nemamo lokalno (tada krug s početnim slovom). */
function crestUri(team: TeamRef): string | null {
  if (team.id === OUR_CLUB_ID) return LOGO;
  const local = team.logo ? (crests as Record<string, string>)[team.logo] : undefined;
  if (!local) return null;
  const file = path.resolve("public" + local);
  if (!fs.existsSync(file)) return null;
  return fileUri(file, file.endsWith(".png") ? "image/png" : "image/jpeg");
}

type Node = { type: string; props: Record<string, unknown> };
const box = (style: Record<string, unknown>, children?: unknown): Node => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children },
});
const img = (src: string, style: Record<string, unknown>): Node => ({ type: "img", props: { src, style } });

const shortName = (name: string) => name.replace(/^NK\s+/, "").toUpperCase();

function crestBlock(team: TeamRef, size: number): Node {
  const uri = crestUri(team);
  const initial = team.name.replace(/^H?NK\s+/i, "").charAt(0).toUpperCase() || "?";
  return box({ flexDirection: "column", alignItems: "center", width: size + 60 }, [
    uri
      ? img(uri, { width: size, height: size, objectFit: "contain" })
      : box(
          {
            width: size,
            height: size,
            borderRadius: size,
            background: "rgba(255,255,255,0.15)",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Oswald",
            fontWeight: 700,
            fontSize: size * 0.45,
            color: "white",
          },
          initial,
        ),
    box(
      {
        marginTop: 22,
        fontFamily: "Oswald",
        fontWeight: 700,
        fontSize: 50,
        lineHeight: 1.05,
        color: "white",
        textAlign: "center",
        justifyContent: "center",
      },
      shortName(team.name),
    ),
  ]);
}

function background(width: number, height: number): Node[] {
  const full = { position: "absolute", left: 0, top: 0, width, height };
  if (POSTER_BACKGROUND === "foto" && fs.existsSync(PHOTO_FILE)) {
    return [
      img(fileUri(PHOTO_FILE, "image/jpeg"), { ...full, objectFit: "cover" }),
      box({
        ...full,
        backgroundImage:
          "linear-gradient(180deg, rgba(10,31,79,0.92) 0%, rgba(15,44,110,0.72) 45%, rgba(10,31,79,0.95) 100%)",
      }),
    ];
  }
  return [
    box({ ...full, backgroundImage: "linear-gradient(150deg, #0a1f4f 0%, #1e3d8c 55%, #2c5bc4 100%)" }),
    img(LOGO, { position: "absolute", right: -width * 0.22, bottom: height * 0.04, width: width * 0.85, opacity: 0.07 }),
  ];
}

/**
 * Strijelci po strani: "Glavaš 2', 68'", "autogol 82'". Samo prezime — na
 * plakatu je stupac uzak, a klub i sam tako piše.
 */
export function posterScorers(m: UnifiedMatch): { home: string[]; away: string[] } {
  const details = (hns.matchDetails ?? {}) as Record<string, any>;
  const events = details[m.id]?.headerEvents;
  const side = (list: any[] | undefined) => {
    const byName = new Map<string, string[]>();
    for (const e of list ?? []) {
      if (!["goal", "penalty", "own_goal"].includes(e.type)) continue;
      const name =
        e.type === "own_goal" ? "autogol" : personName(String(e.playerName ?? "")).split(" ").pop() || "?";
      const minute = e.minute != null ? `${e.minute}'` : "";
      byName.set(name, [...(byName.get(name) ?? []), minute].filter(Boolean));
    }
    return [...byName].map(([name, mins]) => (mins.length ? `${name} ${mins.join(", ")}` : name));
  };
  if (events) return { home: side(events.home), away: side(events.away) };
  // Prijateljske: znamo samo naše strijelce, bez minuta
  const ours = m.scorers.map((s) => (s.goals > 1 ? `${s.name.split(" ").pop()} ${s.goals}×` : s.name.split(" ").pop()!));
  return m.isHome ? { home: ours, away: [] } : { home: [], away: ours };
}

function posterTree(kind: PosterKind, m: UnifiedMatch, format: PosterFormat): Node {
  const { width, height } = POSTER_SIZE[format];
  const tall = format === "story";
  const crest = tall ? 260 : 230;

  const day = new Date(`${m.date}T12:00:00`)
    .toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zagreb" })
    .toUpperCase();
  const venue = venueFor(m);
  const where = m.isHome ? "GRBAVICA, NIZA" : (venue.exact ? venue.label : m.venue ?? m.home.name).toUpperCase();

  const middle =
    kind === "najava"
      ? box({ fontFamily: "Oswald", fontWeight: 700, fontSize: 90, color: GOLD }, "VS")
      : box(
          { fontFamily: "Oswald", fontWeight: 700, fontSize: tall ? 190 : 170, color: "white", lineHeight: 1 },
          `${m.score?.home ?? "-"}:${m.score?.away ?? "-"}`,
        );

  const scorers = kind === "rezultat" ? posterScorers(m) : null;
  const scorerCol = (list: string[]) =>
    box(
      { flexDirection: "column", width: crest + 60, alignItems: "center" },
      list.map((s) =>
        box(
          {
            fontFamily: "Inter",
            fontWeight: 500,
            fontSize: 30,
            color: "rgba(255,255,255,0.88)",
            marginTop: 6,
            textAlign: "center",
            justifyContent: "center",
          },
          s,
        ),
      ),
    );

  const footer = box(
    { marginTop: tall ? 60 : 30, fontFamily: "Inter", fontWeight: 500, fontSize: 26, color: "rgba(255,255,255,0.6)" },
    "omladinacniza.hr",
  );

  return box(
    { width, height, position: "relative", flexDirection: "column", color: "white", fontFamily: "Inter", overflow: "hidden" },
    [
      ...background(width, height),
      box(
        {
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: tall ? "120px 70px" : "70px 70px",
        },
        [
          // Vrh: klub, naslov, natjecanje
          box({ flexDirection: "column", alignItems: "center" }, [
            box({ alignItems: "center" }, [
              img(LOGO, { width: 64, height: 58, marginRight: 16 }),
              box(
                { fontFamily: "Oswald", fontWeight: 500, fontSize: 30, letterSpacing: 4, color: "rgba(255,255,255,0.85)" },
                "NK OMLADINAC NIZA",
              ),
            ]),
            box(
              {
                marginTop: tall ? 70 : 40,
                fontFamily: "Oswald",
                fontWeight: 700,
                fontSize: kind === "najava" ? (tall ? 104 : 100) : tall ? 130 : 118,
                lineHeight: 1,
                letterSpacing: 2,
                whiteSpace: "nowrap",
              },
              kind === "najava" ? "SLJEDEĆA UTAKMICA" : "KRAJ UTAKMICE",
            ),
            box(
              {
                marginTop: 22,
                background: GOLD,
                color: NAVY,
                padding: "8px 26px",
                borderRadius: 999,
                fontFamily: "Oswald",
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: 3,
              },
              competitionShort(m).toUpperCase(),
            ),
          ]),
          // Sredina: grbovi i VS / rezultat, ispod strijelci
          box({ flexDirection: "column", alignItems: "center" }, [
            box({ alignItems: "center", justifyContent: "center" }, [
              crestBlock(m.home, crest),
              box({ width: 230, justifyContent: "center" }, middle),
              crestBlock(m.away, crest),
            ]),
            ...(scorers && (scorers.home.length || scorers.away.length)
              ? [
                  box({ marginTop: 26, alignItems: "flex-start", justifyContent: "center" }, [
                    scorerCol(scorers.home),
                    box({ width: 230 }),
                    scorerCol(scorers.away),
                  ]),
                ]
              : []),
          ]),
          // Dno: kad i gdje
          box(
            { flexDirection: "column", alignItems: "center" },
            kind === "najava"
              ? [
                  box({ fontFamily: "Oswald", fontWeight: 500, fontSize: 46, letterSpacing: 3, color: GOLD }, day),
                  box(
                    { fontFamily: "Oswald", fontWeight: 700, fontSize: tall ? 200 : 170, lineHeight: 1, marginTop: 6 },
                    m.time ?? "VRIJEME NAKNADNO",
                  ),
                  box(
                    {
                      marginTop: 16,
                      fontFamily: "Inter",
                      fontWeight: 700,
                      fontSize: 34,
                      letterSpacing: 2,
                      color: "rgba(255,255,255,0.9)",
                    },
                    `${m.isHome ? "DOMA" : "GOSTI"} · ${where}`,
                  ),
                  footer,
                ]
              : [
                  box({ fontFamily: "Oswald", fontWeight: 500, fontSize: 44, letterSpacing: 3, color: GOLD }, day),
                  box(
                    {
                      marginTop: 10,
                      fontFamily: "Inter",
                      fontWeight: 700,
                      fontSize: 32,
                      letterSpacing: 2,
                      color: "rgba(255,255,255,0.9)",
                      textAlign: "center",
                    },
                    where,
                  ),
                  footer,
                ],
          ),
        ],
      ),
    ],
  );
}

/** JPEG plakata kao Response za statički endpoint. */
export function renderPoster(kind: PosterKind, m: UnifiedMatch, format: PosterFormat): Promise<Response> {
  const { width, height } = POSTER_SIZE[format];
  const tree = posterTree(kind, m, format);
  // Ključ cachea: sve što je na plakatu + verzija dizajna. Grbovi se mijenjaju
  // rijetko, a kad se promijene, mijenja se i URL u crests.json.
  const cacheKey = JSON.stringify({
    v: 2,
    bg: POSTER_BACKGROUND,
    kind,
    format,
    m: [m.id, m.date, m.time, m.score, m.home, m.away, m.competition, m.round, m.isHome, m.venue],
    s: kind === "rezultat" ? posterScorers(m) : null,
    where: venueFor(m).label,
  });
  return renderImage(tree as any, { name: `plakat-${kind}-${m.id}-${format}`, cacheKey, width, height, format: "jpeg" });
}

/** Ime datoteke za preuzimanje: "najava-omladinac-niza-zoljan-4x5.jpg". */
export function posterFilename(kind: PosterKind, m: UnifiedMatch, format: PosterFormat): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/^nk\s+/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${kind}-${slug(m.home.name)}-${slug(m.away.name)}-${format === "plakat" ? "4x5" : "9x16"}.jpg`;
}
