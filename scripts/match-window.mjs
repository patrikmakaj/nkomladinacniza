#!/usr/bin/env node
/**
 * Traje li sad seniorska utakmica — od početka do 3 h poslije, po
 * zagrebačkom vremenu.
 *
 * Na dan utakmice CI ima dodatne prolaze između redovnih (svakih 10 umjesto
 * 30 minuta), da rezultat, strijelci i izvještaj s Facebooka brže dođu na
 * stranicu. Ova skripta im kaže smiju li scrapeati; izvan utakmice job
 * završi u par sekundi.
 *
 * Ispisuje `active=true|false` u $GITHUB_OUTPUT (lokalno na stdout).
 * Bez ovisnosti — runner je pokreće prije `npm ci`.
 *
 * Prozor od 3 h: 105 minuta igre s poluvremenom, plus vrijeme dok delegat
 * upiše rezultat i dok klub objavi izvještaj. Samo HNS utakmice seniora —
 * prijateljske ionako nisu na Semaforu, a U-11 se ne ističe na naslovnici.
 */
import fs from "node:fs";

const WINDOW_MINUTES = 180;

const hns = JSON.parse(fs.readFileSync(new URL("../src/data/hns.json", import.meta.url), "utf8"));

const parts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zagreb",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
);
const today = `${parts.year}-${parts.month}-${parts.day}`;
const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);

const match = (hns.matches ?? []).find((m) => {
  if (m.date !== today || !m.time) return false;
  const [h, min] = m.time.split(":").map(Number);
  const start = h * 60 + min;
  return nowMinutes >= start && nowMinutes <= start + WINDOW_MINUTES;
});

const active = Boolean(match);
console.log(
  active
    ? `Utakmica u tijeku: ${match.home.name} – ${match.away.name} (${match.time}) — scrapam.`
    : `Nema utakmice u tijeku (${today} ${parts.hour}:${parts.minute}) — preskačem.`,
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `active=${active}\n`);
}
