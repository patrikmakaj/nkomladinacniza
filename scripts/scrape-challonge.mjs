#!/usr/bin/env node
/**
 * Prijavljeni parovi turnira u pikadu s Challongea → src/data/pikado.json
 *
 * Turnir (grupe, raspored, rezultati) vodi se na Challongeu i na stranici se
 * prikazuje njihovim iframeom. Iframe prije početka turnira ne pokazuje tko se
 * prijavio, pa popis prijavljenih vučemo ovdje, kroz API.
 *
 * Zašto ne iz preglednika: Challonge API traži ključ, a ključ u JavaScriptu
 * stranice mogao bi pročitati bilo tko. Zato ide kroz CI (GitHub Secret
 * `CHALLONGE_API_KEY`) kao i Facebook token.
 *
 * Koji turnir — `src/config/pikado.json` (isti fajl čita i stranica).
 *
 * Štednja zahtjeva: besplatni Challonge API dopušta ~500 zahtjeva mjesečno,
 * a CI se vrti svakih 30 min (≈ 1440 mjesečno). Zato:
 *  - zahtjev ide samo u prvoj polovici sata (UTC minuta < 30) → otprilike
 *    jednom na sat. `CHALLONGE_EVERY_RUN=1` to preskače (ručno pokretanje).
 *  - kad turnir krene, popis je zaključan — dalje se ne pita ništa, dok se u
 *    configu ne promijeni turnir.
 *
 * Bez ključa ili kad dohvat ne uspije, postojeći pikado.json ostaje kakav jest.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./lib/write-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/pikado.json");
const CONFIG = path.join(ROOT, "src/config/pikado.json");
const LABEL = "[challonge]";

/** Stanja u kojima se još netko može prijaviti ili odjaviti. */
const OPEN_STATES = new Set(["pending", "checking_in", "checked_in"]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const config = await readJson(CONFIG);
  const slug = config?.tournament?.trim();
  if (!slug) {
    console.log(`${LABEL} nema turnira u src/config/pikado.json — preskačem`);
    return;
  }

  const key = process.env.CHALLONGE_API_KEY;
  if (!key) {
    console.log(`${LABEL} nema CHALLONGE_API_KEY — postojeći pikado.json ostaje`);
    return;
  }

  const existing = await readJson(OUT);
  const sameTournament = existing?.tournament === slug;
  const everyRun = process.env.CHALLONGE_EVERY_RUN === "1";

  if (sameTournament && existing.state && !OPEN_STATES.has(existing.state) && !everyRun) {
    console.log(`${LABEL} turnir je krenuo (${existing.state}) — popis je zaključan, ne pitam API`);
    return;
  }
  // Novi turnir u configu dohvaća se odmah, da stranica ne pokazuje stari popis.
  if (sameTournament && !everyRun && new Date().getUTCMinutes() >= 30) {
    console.log(`${LABEL} druga polovica sata — preskačem radi limita API-ja`);
    return;
  }

  const api = new URL(`https://api.challonge.com/v1/tournaments/${encodeURIComponent(slug)}.json`);
  api.searchParams.set("api_key", key);
  api.searchParams.set("include_participants", "1");

  let body;
  try {
    const res = await fetch(api, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // Ključ nikad ne ide u log — samo status.
      console.warn(`${LABEL} HTTP ${res.status} za turnir „${slug}" — postojeći podaci ostaju`);
      return;
    }
    body = await res.json();
  } catch (err) {
    console.warn(`${LABEL} dohvat nije uspio (${err?.name ?? "greška"}) — postojeći podaci ostaju`);
    return;
  }

  const t = body?.tournament;
  if (!t || !Array.isArray(t.participants)) {
    console.warn(`${LABEL} neočekivan odgovor API-ja — postojeći podaci ostaju`);
    return;
  }

  // Samo ime para. E-mail i Challonge korisničko ime iz prijave namjerno
  // ne idu u repo — javni su zauvijek kroz git povijest.
  const participants = t.participants
    .map((p) => p?.participant)
    .filter((p) => p && p.active !== false)
    .map((p) => ({
      name: String(p.display_name || p.name || "").trim(),
      seed: Number(p.seed) || null,
    }))
    .filter((p) => p.name)
    .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));

  const data = {
    lastUpdated: new Date().toISOString(),
    tournament: slug,
    name: t.name ?? null,
    state: t.state ?? null,
    signupCap: Number(t.signup_cap) || null,
    participants,
  };

  await writeJsonIfChanged(OUT, data, { label: LABEL });
  console.log(`${LABEL} prijavljenih parova: ${participants.length}, stanje: ${data.state}`);
}

main().catch((err) => {
  // Nikad ne ruši CI — turnir je sporedan, HNS i FB moraju proći.
  console.warn(`${LABEL} neočekivana greška: ${err?.message ?? err}`);
});
