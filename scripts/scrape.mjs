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

function parseMatches($) {
  const matches = [];
  $('#tabContent_1_1 .matchlist li.row[data-match]').each((_, el) => {
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
  // Sort by date asc; nulls last
  matches.sort((a, b) => {
    if (!a.iso && !b.iso) return 0;
    if (!a.iso) return 1;
    if (!b.iso) return -1;
    return a.iso.localeCompare(b.iso);
  });
  return matches;
}

function parseTable($) {
  const rows = [];
  $('#tabContent_1_2 .competition_table li.row[data-clubid]').each((_, el) => {
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
function parseRankingList($, blockClass, valueSelector) {
  const items = [];
  $(`#tabContent_1_4 .${blockClass} li.row[data-personid]`).each((_, el) => {
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

function parseTopScorers($) {
  return parseRankingList($, "statsGoals", ".goals").map((p) => ({
    ...p,
    goals: parseInt0(p.value) ?? 0,
  }));
}

function parseTopCards($) {
  return parseRankingList($, "statsCards", ".cards").map((p) => {
    const m = p.value.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      ...p,
      yellow: m ? parseInt(m[1], 10) : 0,
      red: m ? parseInt(m[2], 10) : 0,
    };
  });
}

function parseTopApps($) {
  return parseRankingList($, "statsApps", ".apps_minutes").map((p) => {
    const m = p.value.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      ...p,
      appearances: m ? parseInt(m[1], 10) : 0,
      minutes: m ? parseInt(m[2], 10) : 0,
    };
  });
}

function parsePlayers($) {
  const players = [];
  $('#tabContent_1_3 .playerslist li.row[data-personid]').each((_, el) => {
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

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "hr,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} dohvaćajući ${url}`);
  return await res.text();
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

  const html = await fetchHtml(CLUB_URL);
  const $ = cheerio.load(html);

  const club = parseClubHeader($);
  const competition = parseCompetitionMeta($);
  const matches = parseMatches($);
  const table = parseTable($);
  const players = parsePlayers($);
  const topScorers = parseTopScorers($);
  const topCards = parseTopCards($);
  const topApps = parseTopApps($);

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
    nextMatch,
    lastResults,
    table,
    ourRow,
    matches,
    players,
    stats: {
      topScorers,
      topCards,
      topApps,
    },
    matchDetails,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ms = Date.now() - startedAt.getTime();
  console.log(
    `[scrape] gotovo za ${ms}ms · ${matches.length} utakmica · ` +
      `${table.length} klubova · ${players.length} igrača · ` +
      `${topScorers.length} strijelaca · ${topCards.length} kartonjera · ` +
      `${Object.keys(matchDetails).length} detalja · ` +
      `naša pozicija: ${ourRow?.position ?? "?"}`,
  );
  console.log(`[scrape] zapisano: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape] GREŠKA:", err);
  process.exit(1);
});
