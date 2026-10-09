#!/usr/bin/env node
/**
 * Prijateljske utakmice iz Google Sheeta → src/data/friendlies.json
 *
 * Prijateljske, memorijali i turniri nisu na HNS Semaforu. Prije su se
 * upisivali ručno u friendlies.json kroz GitHub, što s mobitela nitko ne voli.
 * Sad ih klub upisuje u tablicu, a ovaj scraper je pri svakom prolazu
 * pretvori u isti JSON koji čita lib/matches.ts.
 *
 * Tablica mora biti dijeljena kao "Svatko s linkom može pregledavati".
 * Stupci (redoslijed nije bitan, traže se po nazivu, velika/mala slova svejedno):
 *
 *   Datum          16.8.2026. ili 2026-08-16
 *   Vrijeme        19:00 (prazno = još nije poznato)
 *   Protivnik      NK Mladost Stipanovci
 *   Doma/Gosti     Doma | Gosti
 *   Mjesto         Niza
 *   Natjecanje     Prijateljska utakmica | Bujdin memorijal | …
 *   Naši golovi    3   (prazno dok se ne odigra)
 *   Golovi protivnika  1
 *   Strijelci      Denis Ćosić 2, Karlo Grubač
 *   HNS ID         133 (opcionalno — broj iz linka kluba na Semaforu)
 *   Grb            link na sliku grba (opcionalno)
 *
 * Golovi su u dva stupca, a ne "3:1" — Sheets bi "3:1" pretvorio u vrijeme.
 *
 * Bez SHEET_ID-a ili kad dohvat ne uspije, postojeći friendlies.json ostaje
 * kakav jest (isto kao FB scraperi bez tokena). Prazna tablica se odbija ako
 * je dosad bilo utakmica — vjerojatnije je slučajno obrisana nego stvarno
 * prazna.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./lib/write-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/friendlies.json");
const HNS = path.join(ROOT, "src/data/hns.json");

/**
 * ID Google Sheeta (dio linka između /d/ i /edit). Javan je kao i sama
 * tablica — isto kao SHEET_ID turnira u pages/turnir.astro. Tablica je na
 * Driveu kluba (dsaniza@gmail.com). `FRIENDLIES_SHEET_ID=""` je isključuje.
 */
const SHEET_ID = process.env.FRIENDLIES_SHEET_ID ?? "1OWowTPFOH_Fy7DcW3sqxercGa_Q9JHj_HqBpH39Ox2g";
/** Tab tablice (broj iza "gid=" u linku); prazno = prvi tab. */
const SHEET_GID = process.env.FRIENDLIES_SHEET_GID || "";

const LABEL = "[prijateljske]";

/** Minimalan CSV parser: navodnici, zarezi i prijelomi unutar navodnika. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * "16.8.2026." · "16. 08. 2026" · "2026-08-16" · "8/16/2026" → "2026-08-16".
 * Sheets u CSV izvozi datum onako kako ga prikazuje, a to ovisi o jeziku
 * tablice; kosa crta je američki zapis (mjesec/dan).
 */
export function parseDate(value) {
  const v = value.trim();
  const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = v.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (m) return iso(m[3], m[2], m[1]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return iso(m[3], m[1], m[2]);
  return null;
}

/** "19:00" · "19.00" · "19:00:00" · "7:00:00 PM" → "19:00"; prazno → null */
export function parseTime(value) {
  const m = value.trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** "Denis Ćosić 2, Karlo Grubač (1), Tin Mauhar x2" → [{ name, goals }] */
export function parseScorers(value) {
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)\s*(?:\(?\s*[x×]?\s*(\d+)\s*\)?)$/i);
      if (m && m[1] && m[2]) return { name: m[1].trim(), goals: Number(m[2]) };
      return { name: s, goals: 1 };
    });
}

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

/** Indeks stupca po nazivu ("Doma/Gosti" = "domagosti"); -1 ako ga nema. */
function columnIndex(header, ...names) {
  const keys = header.map(norm);
  for (const n of names) {
    const i = keys.indexOf(norm(n));
    if (i !== -1) return i;
  }
  return -1;
}

/** Grbovi klubova koje znamo iz HNS-a, da se u tablicu ne mora lijepiti link. */
async function knownLogos() {
  const logos = new Map();
  try {
    const hns = JSON.parse(await readFile(HNS, "utf8"));
    const add = (team) => team?.id != null && team.logo && logos.set(team.id, team.logo);
    for (const m of hns.matches ?? []) (add(m.home), add(m.away));
    for (const c of hns.competitions ?? []) {
      for (const m of c.matches ?? []) (add(m.home), add(m.away));
      for (const r of c.table ?? []) add(r.club);
    }
  } catch {
    // bez hns.json samo nema automatskih grbova
  }
  return logos;
}

/** Redci tablice → format friendlies.json. Neispravni redci se preskaču uz upozorenje. */
export function rowsToFriendlies(rows, logos = new Map()) {
  const [header, ...data] = rows;
  const col = {
    date: columnIndex(header, "Datum"),
    time: columnIndex(header, "Vrijeme", "Početak"),
    opponent: columnIndex(header, "Protivnik"),
    side: columnIndex(header, "Doma/Gosti", "Doma", "Teren"),
    venue: columnIndex(header, "Mjesto"),
    competition: columnIndex(header, "Natjecanje"),
    ours: columnIndex(header, "Naši golovi", "Nasi golovi"),
    theirs: columnIndex(header, "Golovi protivnika"),
    scorers: columnIndex(header, "Strijelci"),
    hnsId: columnIndex(header, "HNS ID", "ID"),
    logo: columnIndex(header, "Grb"),
  };
  for (const key of ["date", "opponent", "side"]) {
    if (col[key] === -1) throw new Error(`u tablici nema stupca "${key}" (zaglavlje: ${header.join(" | ")})`);
  }

  const get = (row, key) => (col[key] === -1 ? "" : (row[col[key]] ?? "").trim());
  const out = [];
  data.forEach((row, i) => {
    const line = i + 2; // redak u tablici (1 je zaglavlje)
    const date = parseDate(get(row, "date"));
    const opponent = get(row, "opponent");
    const side = get(row, "side").toLowerCase();
    if (!date || !opponent || !/^[dg]/.test(side)) {
      console.warn(`${LABEL} redak ${line} preskočen — treba datum, protivnik i Doma/Gosti`);
      return;
    }
    const isHome = side.startsWith("d");
    const ours = get(row, "ours");
    const theirs = get(row, "theirs");
    const played = /^\d+$/.test(ours) && /^\d+$/.test(theirs);
    const hnsId = /^\d+$/.test(get(row, "hnsId")) ? Number(get(row, "hnsId")) : null;

    out.push({
      date,
      time: parseTime(get(row, "time")),
      opponent,
      opponentId: hnsId,
      opponentLogo: get(row, "logo") || (hnsId != null ? logos.get(hnsId) ?? null : null),
      opponentUrl: hnsId != null ? `https://semafor.hns.family/klubovi/${hnsId}/` : null,
      isHome,
      venue: get(row, "venue") || (isHome ? "Niza" : null),
      competition: get(row, "competition") || "Prijateljska utakmica",
      // U JSON-u je rezultat domaćin:gost, u tablici mi:protivnik
      score: played
        ? isHome
          ? { home: Number(ours), away: Number(theirs) }
          : { home: Number(theirs), away: Number(ours) }
        : null,
      scorers: played ? parseScorers(get(row, "scorers")) : [],
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function existingCount() {
  try {
    return JSON.parse(await readFile(OUT, "utf8")).length;
  } catch {
    return 0;
  }
}

async function main() {
  if (!SHEET_ID) {
    console.log(`${LABEL} FRIENDLIES_SHEET_ID nije postavljen — friendlies.json ostaje kakav jest`);
    return;
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${SHEET_GID ? `&gid=${SHEET_GID}` : ""}`;
  let text;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    // Nedijeljena tablica vraća HTML stranicu za prijavu umjesto CSV-a
    if (/^\s*<!doctype html|<html/i.test(text)) throw new Error("tablica nije dijeljena javno (dobio sam HTML)");
  } catch (err) {
    console.warn(`${LABEL} dohvat tablice nije uspio (${err.message}) — friendlies.json ostaje kakav jest`);
    return;
  }

  let friendlies;
  try {
    friendlies = rowsToFriendlies(parseCsv(text), await knownLogos());
  } catch (err) {
    console.warn(`${LABEL} ${err.message} — friendlies.json ostaje kakav jest`);
    return;
  }

  const before = await existingCount();
  if (friendlies.length === 0 && before > 0) {
    console.warn(`${LABEL} tablica je prazna, a dosad je bilo ${before} utakmica — ne brišem ih`);
    return;
  }

  // friendlies.json nema lastUpdated — uspoređuje se cijeli sadržaj
  await writeJsonIfChanged(OUT, friendlies, { ignore: [], label: LABEL });
}

// Pokreni samo kad se skripta zove izravno (testovi uvoze funkcije)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // Kvar ovog scrapera ne smije srušiti HNS/FB scrape iza njega
    console.error(`${LABEL} neočekivana greška: ${err.message}`);
  });
}
