/**
 * Cijeli raspored sezone kao jedan .ics kalendar.
 *
 * Za razliku od pojedinačnog preuzimanja po utakmici, ovo je stalna
 * adresa (/raspored.ics) na koju se kalendar može PRETPLATITI — Google
 * i Apple je povremeno sami ponovo dohvate, pa se promjene termina i
 * novododane utakmice pojave bez ikakve akcije korisnika.
 *
 * Sadrži ligu, kup i prijateljske — sve iz lib/matches.
 */
import type { APIContext } from "astro";
import { allMatches, type UnifiedMatch } from "../lib/matches";

/** "2026-08-30T17:30:00" → "20260830T173000" */
function fmtLocal(iso: string): string {
  return iso.replace(/[-:]/g, "").slice(0, 15);
}

/** "2026-08-30" → "20260830" */
function fmtDate(date: string): string {
  return date.replace(/-/g, "");
}

/** Datum + n dana → "GGGGMMDD" (za cjelodnevne događaje) */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** RFC 5545: escape-aj , ; \ i prelome retka */
function esc(text: string): string {
  return (text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545: redak ne smije biti duži od 75 OKTETA (ne znakova) — nastavak
 * počinje razmakom. Brojimo bajtove jer su š/ž/ć/đ i crtica „—" višebajtni
 * u UTF-8, i pazimo da znak ne prepolovimo.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75; // prvi redak; nastavci imaju razmak pa im ostaje 74

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bytes + chBytes > limit) {
      out.push(current);
      current = ch;
      bytes = chBytes;
      limit = 74;
    } else {
      current += ch;
      bytes += chBytes;
    }
  }
  if (current) out.push(current);

  return out[0] + out.slice(1).map((p) => "\r\n " + p).join("");
}

function eventLines(m: UnifiedMatch, stamp: string): string[] {
  const summary =
    m.score && m.played
      ? `${m.home.name} ${m.score.home}:${m.score.away} ${m.away.name}`
      : `${m.home.name} – ${m.away.name}`;

  const location = m.isHome
    ? "ŠRC Miroslav Knežević-Bujdo (Grbavica), Kolodvorska 50a, Niza"
    : m.venue || m.home.name;

  const lines = [
    "BEGIN:VEVENT",
    `UID:match-${m.id}@nkomladinacniza.hr`,
    `DTSTAMP:${stamp}`,
  ];

  if (m.time) {
    const end = new Date(new Date(m.iso).getTime() + 2 * 60 * 60 * 1000);
    // Lokalno vrijeme bez zone — TZID nosi zonu
    const endLocal = new Date(end.getTime() - end.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);
    lines.push(
      `DTSTART;TZID=Europe/Zagreb:${fmtLocal(m.iso)}`,
      `DTEND;TZID=Europe/Zagreb:${fmtLocal(endLocal)}`,
    );
  } else {
    // Vrijeme još nije objavljeno — cjelodnevni događaj
    lines.push(
      `DTSTART;VALUE=DATE:${fmtDate(m.date)}`,
      `DTEND;VALUE=DATE:${addDays(m.date, 1)}`,
    );
  }

  lines.push(
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(`${m.competition}\nNK Omladinac Niza`)}`,
    "END:VEVENT",
  );
  return lines;
}

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NK Omladinac Niza//Raspored//HR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:NK Omladinac Niza — raspored",
    "X-WR-TIMEZONE:Europe/Zagreb",
    `X-WR-CALDESC:${esc(`Sve utakmice NK Omladinac Niza — liga, kup i prijateljske. ${site}`)}`,
    // Definicija zone da termini ostanu točni i izvan Hrvatske
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Zagreb",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const m of allMatches) lines.push(...eventLines(m, stamp));
  lines.push("END:VCALENDAR");

  const body = lines.map(fold).join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="omladinac-raspored.ics"',
    },
  });
}
