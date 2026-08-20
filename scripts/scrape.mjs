#!/usr/bin/env node
/**
 * HNS Semafor scraper za NK Omladinac Niza
 *
 * Dohvaća HTML stranicu kluba, parsira ju i sprema strukturiran JSON
 * u src/data/hns.json. Pokreće se ručno (`npm run scrape`) ili kroz
 * GitHub Action svakih 30 minuta.
 *
 * Izvor: https://semafor.hns.family/klubovi/134/nk-omladinac-niza/
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const CLUB_ID = 134;
const CLUB_URL = `https://semafor.hns.family/klubovi/${CLUB_ID}/nk-omladinac-niza/`;
const OUR_CLUB_NAME = "NK Omladinac Niza";

// Handler kojim Semafor puni #cid dropdown kad se promijeni uzrast.
const COMPETITIONS_API = "https://semafor.hns.family/handlers/getCompetitions/";

// Uzrasti u kojima klub nastupa — vrijednosti iz #acat dropdowna.
// "Seniors" je seniorska momčad, "Beginners" su početnici (U-11).
const AGE_CATEGORIES = ["Seniors", "Beginners"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../src/data/hns.json");

// Pauza između HTTP zahtjeva za detalje utakmica (ms) — pristojno prema serveru
const MATCH_FETCH_DELAY_MS = 250;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";

// ───────── Helpers ─────────────────────────────────────────────────────

/** "31.08.2025. 17:30" → { date: "2025-08-31", time: "17:30", iso: "2025-08-31T17:30:00" } */
function parseDateTime(raw) {
  if (!raw) return null;
  const match = raw.trim().match(/(\d{2})\.(\d{2})\.(\d{4})\.?\s*(\d{2}):(\d{2})?/);
  if (!match) return { raw: raw.trim(), date: null, time: null, iso: null };
  const [, d, m, y, hh, mm] = match;
  const date = `${y}-${m}-${d}`;
  const time = hh && mm ? `${hh}:${mm}` : null;
  const iso = time ? `${date}T${time}:00` : `${date}T00:00:00`;
  return { raw: raw.trim(), date, time, iso };
}

/** Lazy-loaded slika koristi `data-url`, prava slika je u `src`. Vraća zadnju koja postoji. */
function imgSrc($img) {
  return ($img.attr("data-url") || $img.attr("src") || "").trim() || null;
}

/** "+39", "−5", "0", "" → broj ili null */
function parseInt0(text) {
  if (text == null) return null;
  const cleaned = String(text).replace(/[^\-+0-9]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Semafor NEMA fiksne indekse tabova. Liga ima 4 taba (Raspored, Ljestvica,
 * Igrači, Statistika), a kup nema ljestvicu pa se Igrači i Statistika pomaknu
 * za jedan (tabContent_1_2 i _1_3 umjesto _1_3 i _1_4).
 *
 * Zato container tražimo po NAZIVU taba iz navigacije, ne po rednom broju.
 * Fallback na ligaške indekse ako navigacija nije pronađena.
 */
const FALLBACK_TABS = {
  matches: "#tabContent_1_1",
  table: "#tabContent_1_2",
  players: "#tabContent_1_3",
  stats: "#tabContent_1_4",
};

function resolveTabs($) {
  const tabs = {};
  $("li[data-content^='tabContent_']").each((_, el) => {
    const id = $(el).attr("data-content");
    if (!id) return;
    const label = $(el).text().trim().toLowerCase();
    if (label.includes("raspored")) tabs.matches = `#${id}`;
    else if (label.includes("ljestvica")) tabs.table = `#${id}`;
    else if (label.includes("igrač")) tabs.players = `#${id}`;
    else if (label.includes("statistika")) tabs.stats = `#${id}`;
  });
  return { ...FALLBACK_TABS, ...tabs };
}

// ───────── Parsers ─────────────────────────────────────────────────────

function parseClubHeader($) {
  const $header = $(".clubHeader");
  return {
    id: CLUB_ID,
    name: $header.find(".title h1").first().text().trim() || OUR_CLUB_NAME,
    fullName: $header.find(".title h2").first().text().trim() || null,
    logo: imgSrc($header.find(".basic_info .logo img").first()),
    address:
      $header.find(".info li.address h3").first().text().trim() || null,
    stadium:
      $header.find(".info li.stadium h3").first().text().trim() || null,
    sourceUrl: CLUB_URL,
  };
}

function parseCompetitionMeta($) {
  const selected = $("#cid option[selected]").first();
  return {
    name: selected.text().trim() || null,
    season: $("#season option[selected]").first().text().trim() || null,
  };
}

/** Vrijednost odabrane sezone za API ("2026/2027"), ne prikazna ("2026/27"). */
function parseSeasonValue($) {
  return $("#season option[selected]").first().attr("value")?.trim() || null;
}

/** cid natjecanja koje je Semafor sam označio kao odabrano na klupskoj stranici. */
function parseSelectedCid($) {
  const value = $("#cid option[selected]").first().attr("value") || "";
  return parseInt0(value.match(/[?&]cid=(\d+)/)?.[1]);
}

/** Tip natjecanja iz naziva: sadrži "kup" → "cup", inače "league". */
function competitionType(name) {
  return /kup/i.test(name) ? "cup" : "league";
}

/**
 * Dohvaća popis natjecanja za jedan uzrast.
 *
 * Dropdown #cid na stranici prikazuje samo trenutno odabrani uzrast (Seniors),
 * a prebacivanje uzrasta ide kroz AJAX — `?acat=Beginners` u URL-u NE radi.
 * Zato zovemo isti handler koji zove i njihov frontend; vraća čisti JSON.
 */
async function fetchCompetitions(ageCategory, season) {
  const params = new URLSearchParams({
    season,
    acat: ageCategory,
    t: String(Date.now()),
    lang: "hr",
    clubID: String(CLUB_ID),
    linkType: "club_profile",
    linkConstructor: `/klubovi/${CLUB_ID}/nk-omladinac-niza/?cid={cid}`,
  });
  const raw = await fetchHtml(`${COMPETITIONS_API}?${params}`, {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  const list = JSON.parse(raw);
  return list.map((c) => ({
    id: c.id,
    name: String(c.value || "").trim(),
    url: new URL(c.url, "https://semafor.hns.family").href,
    type: competitionType(c.value || ""),
    ageCategory,
  }));
}

/**
 * HNS zna otvoriti NOVO natjecanje za istu ligu usred sezone (npr. kad klubovi
 * odustanu), a staro ostavi u dropdownu. Ako obje verzije pustimo u raspored,
 * svaki protivnik se pojavi dvaput.
 *
 * Zato od ligaških natjecanja jednog uzrasta zadržavamo samo jedno — ono koje
 * je Semafor označio kao odabrano, a ako odabrano nije liga, onda ono s
 * najvišim id-em (HNS ih dodjeljuje rastuće, pa je to najnovije).
 * Kupovi prolaze svi — klub može igrati više kupova paralelno.
 */
function pickActiveCompetitions(comps, selectedCid) {
  const leagues = comps.filter((c) => c.type === "league");
  const rest = comps.filter((c) => c.type !== "league");
  if (leagues.length <= 1) return [...leagues, ...rest];

  const selected = leagues.find((c) => c.id === selectedCid);
  const active = selected ?? leagues.reduce((a, b) => (b.id > a.id ? b : a));
  const dropped = leagues.filter((c) => c.id !== active.id);
  console.warn(
    `[scrape] ⚠ ${leagues.length} ligaška natjecanja za ${active.ageCategory}` +
      ` — koristim cid=${active.id}${selected ? " (odabrano)" : " (najnovije)"},` +
      ` preskačem ${dropped.map((c) => c.id).join(", ")}`,
  );
  return [active, ...rest];
}

function parseMatches($, tabs, competitionType = "league") {
  const matches = [];
  $(`${tabs.matches} .matchlist li.row[data-match]`).each((_, el) => {
    const $li = $(el);
    const id = $li.attr("data-match");
    const round = parseInt0($li.attr("data-round"));
    const dateRaw = $li.find(".date").first().text();
    const dt = parseDateTime(dateRaw);

    const $home = $li.find(".club1").first();
    const $away = $li.find(".club2").first();

    const home = {
      id: parseInt0($home.attr("data-id")),
      name: $home.find("a").first().contents().first().text().trim(),
      logo: imgSrc($home.find("img").first()),
    };
    const away = {
      id: parseInt0($away.attr("data-id")),
      name: $away.find("a").first().contents().first().text().trim(),
      logo: imgSrc($away.find("img").first()),
    };

    const $res = $li.find(".result .resRegular");
    const homeScore = parseInt0($res.find(".res1").first().text());
    const awayScore = parseInt0($res.find(".res2").first().text());
    const score =
      homeScore != null && awayScore != null
        ? { home: homeScore, away: awayScore }
        : null;

    const competitionRound = $li.find(".competitionround").first().text().trim();
    const url = $li.find(".result a").first().attr("href")
      || $li.find(".link a").first().attr("href")
      || null;

    const isUsHome = home.id === CLUB_ID;
    const isUsAway = away.id === CLUB_ID;
    let result = null;
    if (score && (isUsHome || isUsAway)) {
      const ourScore = isUsHome ? score.home : score.away;
      const oppScore = isUsHome ? score.away : score.home;
      if (ourScore > oppScore) result = "W";
      else if (ourScore < oppScore) result = "L";
      else result = "D";
    }

    matches.push({
      id,
      type: competitionType,
      round,
      date: dt?.date,
      time: dt?.time,
      iso: dt?.iso,
      competition: competitionRound,
      home,
      away,
      score,
      played: score !== null,
      isHome: isUsHome,
      result,
      url,
    });
  });
  return sortMatches(matches);
}

/** Sort by date asc; nulls last. Vraća isti (mutirani) array. */
function sortMatches(matches) {
  matches.sort((a, b) => {
    if (!a.iso && !b.iso) return 0;
    if (!a.iso) return 1;
    if (!b.iso) return -1;
    return a.iso.localeCompare(b.iso);
  });
  return matches;
}

function parseTable($, tabs) {
  const rows = [];
  $(`${tabs.table} .competition_table li.row[data-clubid]`).each((_, el) => {
    const $li = $(el);
    const clubId = parseInt0($li.attr("data-clubid"));
    const $club = $li.find(".club a").first();
    const clubName = $club.contents().last().text().trim();
    const logo = imgSrc($club.find("img").first());

    const formClasses = $li
      .find(".form > div")
      .map((_, d) => {
        const cls = $(d).attr("class") || "";
        if (cls.includes("formW")) return "W";
        if (cls.includes("formL")) return "L";
        if (cls.includes("formD")) return "D";
        return null;
      })
      .get()
      .filter(Boolean);

    rows.push({
      position: parseInt0($li.find(".position").first().text()),
      club: { id: clubId, name: clubName, logo },
      played: parseInt0($li.find(".played").first().text()),
      wins: parseInt0($li.find(".wins").first().text()),
      draws: parseInt0($li.find(".draws").first().text()),
      losses: parseInt0($li.find(".losses").first().text()),
      gf: parseInt0($li.find(".gplus").first().text()),
      ga: parseInt0($li.find(".gminus").first().text()),
      gd: $li.find(".gdiff").first().text().trim() || null,
      points: parseInt0($li.find(".points").first().text()),
      form: formClasses,
      isUs: clubId === CLUB_ID,
    });
  });
  rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return rows;
}

/** Parsira ranking tablicu (Strijelci, Kartoni, Nastupi) iz tabContent_1_4 */
function parseRankingList($, tabs, blockClass, valueSelector) {
  const items = [];
  $(`${tabs.stats} .${blockClass} li.row[data-personid]`).each((_, el) => {
    const $li = $(el);
    const $name = $li.find(".playerName h3 a").first();
    const $img = $li.find(".playerPhoto img").first();
    const rawValue = $li.find(valueSelector).first().text().replace(/\s+/g, " ").trim();
    items.push({
      personId: parseInt0($li.attr("data-personid")),
      position: parseInt0($li.find(".position").first().text()),
      name: $name.text().trim(),
      profileUrl: $name.attr("href") || null,
      photo: imgSrc($img),
      value: rawValue,
    });
  });
  return items;
}

function parseTopScorers($, tabs) {
  return parseRankingList($, tabs, "statsGoals", ".goals").map((p) => ({
    ...p,
    goals: parseInt0(p.value) ?? 0,
  }));
}

function parseTopCards($, tabs) {
  return parseRankingList($, tabs, "statsCards", ".cards").map((p) => {
    const m = p.value.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      ...p,
      yellow: m ? parseInt(m[1], 10) : 0,
      red: m ? parseInt(m[2], 10) : 0,
    };
  });
}

function parseTopApps($, tabs) {
  return parseRankingList($, tabs, "statsApps", ".apps_minutes").map((p) => {
    const m = p.value.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      ...p,
      appearances: m ? parseInt(m[1], 10) : 0,
      minutes: m ? parseInt(m[2], 10) : 0,
    };
  });
}

function parsePlayers($, tabs) {
  const players = [];
  $(`${tabs.players} .playerslist li.row[data-personid]`).each((_, el) => {
    const $li = $(el);
    const id = parseInt0($li.attr("data-personid"));
    const $name = $li.find(".playerName");
    const fullName = $name.find("h3 a").first().text().trim();
    // Position is text after </h3>
    const positionText = $name
      .contents()
      .filter((_, n) => n.type === "text")
      .map((_, n) => $(n).text())
      .get()
      .join("")
      .trim();

    players.push({
      id,
      number: parseInt0($li.find(".shirtNumber").first().text()),
      name: fullName,
      position: positionText || null,
      photo: imgSrc($li.find(".playerPhoto img").first()),
      profileUrl: $name.find("h3 a").first().attr("href") || null,
      stats: {
        appearances: parseInt0($li.find(".apps").first().text()) ?? 0,
        minutes: parseInt0($li.find(".minutes").first().text()) ?? 0,
        goals: parseInt0($li.find(".goals").first().text()) ?? 0,
        cards:
          $li.find(".cards").first().text().replace(/\s+/g, " ").trim() || "0 / 0",
      },
    });
  });
  return players;
}

// ───────── Spajanje natjecanja ─────────────────────────────────────────

/** "1 / 0" → { yellow: 1, red: 0 } */
function parseCards(text) {
  const m = String(text ?? "").match(/(\d+)\s*\/\s*(\d+)/);
  return { yellow: m ? parseInt(m[1], 10) : 0, red: m ? parseInt(m[2], 10) : 0 };
}

/**
 * Spaja rostere kroz više natjecanja u jedan popis.
 *
 * Razlog: HNS zna objaviti sastav samo pod jednim natjecanjem (trenutno pod
 * kupom, dok je ligaški roster prazan). Igrač koji nastupa i u ligi i u kupu
 * pojavi se dvaput, pa ga spajamo po `personId` i zbrajamo statistiku.
 *
 * `perCompetition` čuva razlomljene brojke — profil igrača ih prikazuje
 * po natjecanju, a /momcad koristi zbroj.
 */
function mergePlayers(comps) {
  const byId = new Map();

  for (const comp of comps) {
    for (const p of comp.players) {
      if (p.id == null) continue;
      const cards = parseCards(p.stats.cards);
      const entry = byId.get(p.id) ?? {
        id: p.id,
        number: null,
        name: p.name,
        position: null,
        photo: null,
        profileUrl: null,
        stats: { appearances: 0, minutes: 0, goals: 0, cards: "0 / 0" },
        perCompetition: [],
      };

      // Prvi natjecanje koje ih ima popunjava broj/poziciju/sliku.
      entry.number ??= p.number;
      entry.position ??= p.position;
      entry.photo ??= p.photo;
      entry.profileUrl ??= p.profileUrl;
      if (p.name) entry.name = p.name;

      const prev = parseCards(entry.stats.cards);
      entry.stats.appearances += p.stats.appearances ?? 0;
      entry.stats.minutes += p.stats.minutes ?? 0;
      entry.stats.goals += p.stats.goals ?? 0;
      entry.stats.cards = `${prev.yellow + cards.yellow} / ${prev.red + cards.red}`;

      entry.perCompetition.push({
        competitionId: comp.id,
        competition: comp.name,
        type: comp.type,
        stats: { ...p.stats },
      });

      byId.set(p.id, entry);
    }
  }

  return [...byId.values()].sort(
    (a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name, "hr"),
  );
}

/** Spaja jednu ranking listu kroz natjecanja, zbroji `sum` i ponovo poredaj. */
function mergeRanking(comps, key, sum, format, rank) {
  const byId = new Map();
  for (const comp of comps) {
    for (const item of comp.stats[key]) {
      if (item.personId == null) continue;
      const entry = byId.get(item.personId);
      if (entry) sum(entry, item);
      else byId.set(item.personId, { ...item });
    }
  }
  const items = [...byId.values()].sort((a, b) => rank(b) - rank(a));
  return items.map((item, i) => ({ ...item, position: i + 1, value: format(item) }));
}

/** Objedinjene ranking liste (strijelci, kartoni, nastupi) kroz sva natjecanja. */
function mergeStats(comps) {
  return {
    topScorers: mergeRanking(
      comps,
      "topScorers",
      (a, b) => (a.goals += b.goals ?? 0),
      (p) => String(p.goals),
      (p) => p.goals,
    ),
    topCards: mergeRanking(
      comps,
      "topCards",
      (a, b) => {
        a.yellow += b.yellow ?? 0;
        a.red += b.red ?? 0;
      },
      (p) => `${p.yellow} / ${p.red}`,
      (p) => p.yellow + p.red * 10, // crveni teže od žutih
    ),
    topApps: mergeRanking(
      comps,
      "topApps",
      (a, b) => {
        a.appearances += b.appearances ?? 0;
        a.minutes += b.minutes ?? 0;
      },
      (p) => `${p.appearances} / ${p.minutes}`,
      (p) => p.appearances * 10000 + p.minutes,
    ),
  };
}

// ───────── Match detail parsers ────────────────────────────────────────

/** Mapira CSS klasu eventa u tip ("goal" | "yellow" | "red" | "own_goal" | "penalty" | "subin" | "subout" | "other"). */
function eventTypeFromClass(className) {
  const c = (className || "").toLowerCase();
  if (c.includes("own_goal") || c.includes("autogol")) return "own_goal";
  if (c.includes("penalty")) return "penalty";
  if (c.includes("goal")) return "goal";
  if (c.includes("yellow")) return "yellow";
  if (c.includes("red")) return "red";
  if (c.includes("subin") || c.includes("sub_in")) return "subin";
  if (c.includes("subout") || c.includes("sub_out")) return "subout";
  return "other";
}

/** "33'", "90+1'", "45+2'" → minute (90+1 → 91, 45+2 → 47). Vraća null ako ne uspije. */
function parseMinute(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)(?:\+(\d+))?'?/);
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
}

/** Parsira eventi unutar `.matchEvents` jednog igrača. */
function parsePlayerEvents($, $cell) {
  const events = [];
  $cell.find("li").each((_, li) => {
    const cls = $(li).attr("class") || "";
    const type = eventTypeFromClass(cls);
    const text = $(li).text().replace(/\s+/g, " ").trim();
    const minute = parseMinute(text);
    events.push({ type, minute, label: text || null });
  });
  return events;
}

/** Parsira jedan tim iz lineupa: starters + subs s eventima. */
function parseLineupTeam($, $teamRoot) {
  const starters = [];
  const subs = [];
  let inSubs = false;

  $teamRoot.find("> ul > li").each((_, li) => {
    const $li = $(li);
    const cls = $li.attr("class") || "";

    if (cls.includes("separatorTitle")) {
      inSubs = true;
      return;
    }
    if (cls.includes("clubName") || cls.includes("empty")) return;
    if (!cls.includes("match_lineup")) return;

    const personId = parseInt0($li.attr("data-personid"));
    const number = parseInt0($li.find(".shirtNumber").first().text());
    const $nameLink = $li.find(".playerName h3 a").first();
    const rawHeading = $li.find(".playerName h3").first().text().trim();
    const name = $nameLink.text().trim();
    const captain = /\(C\)/.test(rawHeading);
    const photo = imgSrc($li.find(".playerPhoto img").first());
    const profileUrl = $nameLink.attr("href") || null;

    // Position is text outside the <h3> inside .playerName
    const $playerName = $li.find(".playerName").first();
    const position = $playerName
      .contents()
      .filter((_, n) => n.type === "text")
      .map((_, n) => $(n).text())
      .get()
      .join("")
      .trim() || null;

    const events = parsePlayerEvents($, $li.find(".matchEvents").first());

    const player = { personId, number, name, position, captain, photo, profileUrl, events };
    if (inSubs) subs.push(player);
    else starters.push(player);
  });

  return { starters, subs };
}

/** Parsira detaljnu stranicu pojedinačne utakmice na HNS Semaforu. */
function parseMatchDetail(html) {
  const $ = cheerio.load(html);
  const $hdr = $(".matchHeader").first();

  const status = $hdr.find(".status").first().text().trim() || null;
  const facility = $hdr.find(".facility").first().text().trim() || null;
  const attendanceText = $hdr.find(".attendance").first().text().trim() || null;
  const attendance = attendanceText ? parseInt0(attendanceText) : null;
  const refereesText = $hdr.find(".referees").first().text().trim() || null;
  // "Suci: Manuel Dendis." → ["Manuel Dendis"]
  const referees = refereesText
    ? refereesText
        .replace(/^Suci\s*:\s*/i, "")
        .replace(/\.\s*$/, "")
        .split(/\s*[,;]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Eventi prikazani u headeru (kombinirani po klubu, lijevo = home, desno = away)
  const headerEvents = { home: [], away: [] };
  const $eventLists = $hdr.find(".events_main > ul.events");
  $eventLists.eq(0).find("> li").each((_, li) => {
    const $li = $(li);
    const playerName = $li.find(".playerName").first().text().trim() || null;
    const $event = $li.find(".event").first();
    const type = eventTypeFromClass($event.attr("class") || "");
    const minute = parseMinute($event.text());
    headerEvents.home.push({ type, minute, playerName });
  });
  $eventLists.eq(1).find("> li").each((_, li) => {
    const $li = $(li);
    const playerName = $li.find(".playerName").first().text().trim() || null;
    const $event = $li.find(".event").first();
    const type = eventTypeFromClass($event.attr("class") || "");
    const minute = parseMinute($event.text());
    headerEvents.away.push({ type, minute, playerName });
  });

  const homeLineup = parseLineupTeam($, $(".matchLineup .homeTeam").first());
  const awayLineup = parseLineupTeam($, $(".matchLineup .awayTeam").first());

  return {
    status,
    facility,
    attendance,
    referees,
    headerEvents,
    lineup: { home: homeLineup, away: awayLineup },
  };
}

// ───────── Main ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statusi kod kojih ima smisla ponoviti zahtjev — rate limit, serverske
// greške i Cloudflareovi 52x (npr. 522 = origin nedostupan, viđamo ga
// povremeno kad HNS-ov server ne odgovori).
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

/**
 * Dohvaća HTML s retryjem: do `attempts` pokušaja s eksponencijalnim
 * backoffom (3s, 6s, 12s). Ako svi pokušaji padnu zbog prolazne greške
 * (mreža/timeout/5xx), baca error s `transient: true` — pozivatelj tada
 * može graceful odustati umjesto srušiti cijeli scrape.
 */
async function fetchHtml(url, { attempts = 4, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const delay = 3000 * 2 ** (i - 1);
      console.warn(`[scrape] ponavljam (${i + 1}/${attempts}) za ${delay / 1000}s: ${url}`);
      await sleep(delay);
    }
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "hr,en;q=0.8",
          ...headers,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return await res.text();
      const err = new Error(`HTTP ${res.status} dohvaćajući ${url}`);
      err.status = res.status;
      if (!RETRY_STATUS.has(res.status)) throw err; // trajna greška (404 i sl.) — ne ponavljaj
      lastErr = err;
    } catch (err) {
      if (err.status && !RETRY_STATUS.has(err.status)) throw err;
      lastErr = err; // mrežna greška ili timeout — ponovi
    }
  }
  lastErr.transient = true;
  throw lastErr;
}

/** Učitaj prethodno spremljene matchDetails (radi cache-a — odigrane utakmice se ne mijenjaju). */
async function loadExistingMatchDetails() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const prev = JSON.parse(raw);
    return prev?.matchDetails ?? {};
  } catch {
    return {};
  }
}

async function fetchMatchDetails(matches, existing) {
  const details = { ...existing };
  // Skupi sve odigrane utakmice s URL-om koje još nemaju detalje
  const toFetch = matches.filter(
    (m) => m.played && m.url && !details[m.id],
  );

  if (toFetch.length === 0) {
    console.log(`[scrape] svi detalji utakmica već cached (${Object.keys(details).length})`);
    return details;
  }

  console.log(`[scrape] dohvaćam detalje za ${toFetch.length} utakmica…`);
  let ok = 0;
  let fail = 0;
  for (const m of toFetch) {
    try {
      const html = await fetchHtml(m.url);
      details[m.id] = parseMatchDetail(html);
      ok++;
    } catch (err) {
      fail++;
      console.warn(`[scrape] greška za utakmicu ${m.id}: ${err.message}`);
    }
    await sleep(MATCH_FETCH_DELAY_MS);
  }
  console.log(`[scrape] detalji utakmica · OK ${ok} · greške ${fail}`);
  return details;
}

async function main() {
  const startedAt = new Date();
  console.log(`[scrape] dohvaćam ${CLUB_URL}…`);

  let html;
  try {
    html = await fetchHtml(CLUB_URL);
  } catch (err) {
    if (err.transient) {
      // HNS Semafor je privremeno nedostupan (Cloudflare 52x, timeout…).
      // Zadrži postojeći hns.json i izađi uspješno — cron za 30 min
      // ionako pokreće novi pokušaj, a deploy ne smije pasti zbog toga.
      console.warn(
        `[scrape] ⚠ HNS Semafor nedostupan (${err.message}) — zadržavam postojeće podatke i preskačem ovaj run.`,
      );
      return;
    }
    throw err;
  }
  const $ = cheerio.load(html);

  const club = parseClubHeader($);
  const competition = parseCompetitionMeta($);
  const seasonValue = parseSeasonValue($);
  const selectedCid = parseSelectedCid($);

  // ── Popis natjecanja po uzrastu ────────────────────────────────────
  // Dropdown na stranici pokriva samo trenutni uzrast, pa natjecanja
  // dohvaćamo kroz handler za svaki uzrast zasebno.
  let competitions = [];
  if (seasonValue) {
    for (const acat of AGE_CATEGORIES) {
      try {
        const list = await fetchCompetitions(acat, seasonValue);
        competitions.push(...pickActiveCompetitions(list, selectedCid));
      } catch (err) {
        console.warn(`[scrape] popis natjecanja za ${acat} nije dohvaćen: ${err.message}`);
      }
      await sleep(MATCH_FETCH_DELAY_MS);
    }
  }
  if (competitions.length === 0) {
    // Fallback: handler nedostupan — barem odradi trenutno otvorenu stranicu.
    console.warn("[scrape] ⚠ popis natjecanja prazan — koristim samo default stranicu");
    competitions = [
      {
        id: selectedCid,
        name: competition.name || "Natjecanje",
        url: CLUB_URL,
        type: competitionType(competition.name || ""),
        ageCategory: "Seniors",
      },
    ];
  }

  // ── Parsiranje svakog natjecanja zasebno ──────────────────────────
  // Svako natjecanje ima vlastiti raspored, ljestvicu, roster i statistiku.
  // Default stranicu već imamo učitanu, nju ne dohvaćamo ponovo.
  const parsed = [];
  for (const comp of competitions) {
    let $comp = $;
    if (comp.id !== selectedCid) {
      try {
        $comp = cheerio.load(await fetchHtml(comp.url));
      } catch (err) {
        console.warn(`[scrape] greška za natjecanje "${comp.name}": ${err.message}`);
        continue;
      }
      await sleep(MATCH_FETCH_DELAY_MS);
    }
    const tabs = resolveTabs($comp);
    parsed.push({
      ...comp,
      selected: comp.id === selectedCid,
      matches: parseMatches($comp, tabs, comp.type),
      table: parseTable($comp, tabs),
      players: parsePlayers($comp, tabs),
      stats: {
        topScorers: parseTopScorers($comp, tabs),
        topCards: parseTopCards($comp, tabs),
        topApps: parseTopApps($comp, tabs),
      },
    });
  }

  // ── Objedinjeni pogled za seniore ─────────────────────────────────
  // Stranice koje ne razlikuju natjecanja (naslovnica, raspored, .ics)
  // čitaju ove top-level ključeve; U-11 namjerno NIJE u njima da ne
  // upadne u seniorski raspored — živi samo u `competitions`.
  const seniors = parsed.filter((c) => c.ageCategory === "Seniors");

  const matchesById = new Map();
  for (const comp of seniors) {
    for (const m of comp.matches) {
      if (!matchesById.has(m.id)) {
        matchesById.set(m.id, { ...m, competitionId: comp.id, ageCategory: comp.ageCategory });
      }
    }
  }
  const matches = sortMatches([...matchesById.values()]);

  // Ljestvica dolazi iz aktivne seniorske lige (kup je nema).
  const table = seniors.find((c) => c.type === "league" && c.table.length)?.table ?? [];

  // Roster: unija kroz sva seniorska natjecanja, statistika zbrojena.
  // (HNS zna objaviti sastav samo pod kupom, a ligu ostaviti praznom.)
  const players = mergePlayers(seniors);
  const stats = mergeStats(seniors);

  // Derived: next match (first unplayed) + last result (last played)
  const nextMatch = matches.find((m) => !m.played) || null;
  const lastResults = matches.filter((m) => m.played).slice(-10).reverse();
  const ourRow = table.find((r) => r.isUs) || null;

  const existingDetails = await loadExistingMatchDetails();
  const matchDetails = await fetchMatchDetails(matches, existingDetails);

  const data = {
    lastUpdated: startedAt.toISOString(),
    sourceUrl: CLUB_URL,
    club,
    competition,
    competitions: parsed,
    nextMatch,
    lastResults,
    table,
    ourRow,
    matches,
    players,
    stats,
    matchDetails,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ms = Date.now() - startedAt.getTime();
  console.log(
    `[scrape] gotovo za ${ms}ms · ${matches.length} utakmica · ` +
      `${table.length} klubova · ${players.length} igrača · ` +
      `${stats.topScorers.length} strijelaca · ${stats.topCards.length} kartonjera · ` +
      `${Object.keys(matchDetails).length} detalja · ` +
      `naša pozicija: ${ourRow?.position ?? "?"}`,
  );
  for (const c of parsed) {
    console.log(
      `[scrape]   · ${c.name} (${c.type}/${c.ageCategory}) — ` +
        `${c.matches.length} utakmica, ${c.table.length} klubova, ${c.players.length} igrača`,
    );
  }
  console.log(`[scrape] zapisano: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape] GREŠKA:", err);
  process.exit(1);
});
