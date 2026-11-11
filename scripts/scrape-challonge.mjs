#!/usr/bin/env node
/**
 * Turnir u pikadu s Challongea → src/data/pikado.json
 *
 * Turnir (grupe, raspored, rezultati) vodi se na Challongeu i na stranici se
 * prikazuje njihovim iframeom. Iframe prije početka ne pokazuje tko se
 * prijavio, pa popis prijavljenih (uz datum, limit prijava i format) vučemo
 * ovdje, kroz API v2.1.
 *
 * Autentikacija: OAuth „client credentials" (aplikacija na Challonge
 * Developer Portalu, račun kluba). GitHub Secrets `CHALLONGE_CLIENT_ID` i
 * `CHALLONGE_CLIENT_SECRET`. Iz preglednika se ne smije — secret bi bio javan.
 *
 * Koji turnir — `src/config/pikado.json` (isti fajl čita i stranica).
 *
 * Štednja zahtjeva: besplatna aplikacija ima 500 zahtjeva mjesečno, a po
 * prolazu idu dva poziva (token + turnir sa sudionicima, `include=participants`).
 *  - API se pita najviše jednom u `refreshHours` sati (config). Vrijeme zadnje
 *    provjere je u `.cache/challonge-last.json` (nije u gitu; CI ga prenosi
 *    kroz `actions/cache`, isto kao stanje ispada HNS-a). Prije je uvjet bio
 *    „prva polovica sata", ali GitHub zakazane runove pokreće rijetko i
 *    neredovito (11.11. samo 5 puta u danu), pa je to propuštalo i one koji
 *    jesu došli — prvi prijavljeni par čekao bi satima.
 *  - Ručno pokretanje (workflow_dispatch) postavi `CHALLONGE_EVERY_RUN=1` i
 *    pita uvijek.
 *  - Kad turnir krene, popis je zaključan — dalje se ne pita ništa, dok se u
 *    configu ne promijeni turnir.
 *
 * Bez tajni ili kad dohvat ne uspije, postojeći pikado.json ostaje kakav jest.
 */

import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonIfChanged } from "./lib/write-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/pikado.json");
const CONFIG = path.join(ROOT, "src/config/pikado.json");
const LAST_CHECK = path.join(ROOT, ".cache/challonge-last.json");
const LABEL = "[challonge]";
const API = "https://api.challonge.com";

/** Stanja u kojima se još netko može prijaviti ili odjaviti. */
const OPEN_STATES = new Set(["pending", "checking_in", "checked_in"]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Je li na redu dohvat: prošlo je barem `hours` sati od zadnje provjere.
 * 10 min tolerancije, jer runovi ne kreću u točnu minutu — inače bi run koji
 * stigne 2 minute „prerano" čekao još cijeli interval.
 */
async function isDue(hours, now = Date.now()) {
  const h = Math.max(1, Number(hours) || 1);
  const last = (await readJson(LAST_CHECK))?.checkedAt;
  const lastMs = last ? Date.parse(last) : NaN;
  if (Number.isNaN(lastMs)) return true;
  return now - lastMs >= h * 3600_000 - 10 * 60_000;
}

/** Zapamti provjeru i javi CI-ju da spremi cache. */
async function rememberCheck() {
  await mkdir(path.dirname(LAST_CHECK), { recursive: true });
  await writeFile(LAST_CHECK, JSON.stringify({ checkedAt: new Date().toISOString() }) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "challonge_checked=true\n");
}

async function getToken(clientId, clientSecret) {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      // Samo čitanje. Bez `scope` bi token dobio i application:manage.
      scope: "me tournaments:read participants:read",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.access_token) throw new Error("OAuth odgovor bez tokena");
  return body.access_token;
}

/** Format iz group_stage_options, bez prijevoda — to radi stranica. */
function formatOf(a) {
  const g = a.group_stage_enabled ? a.group_stage_options ?? {} : null;
  return {
    groupSize: g ? Number(g.group_size) || null : null,
    advancePerGroup: g ? Number(g.participant_count_to_advance_per_group) || null : null,
    // "single elimination" | "double elimination" | "round robin" | "swiss"
    finalStage: a.tournament_type ?? null,
  };
}

async function main() {
  const config = await readJson(CONFIG);
  const slug = config?.tournament?.trim();
  if (!slug) {
    console.log(`${LABEL} nema turnira u src/config/pikado.json — preskačem`);
    return;
  }

  const clientId = process.env.CHALLONGE_CLIENT_ID;
  const clientSecret = process.env.CHALLONGE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log(`${LABEL} nema CHALLONGE_CLIENT_ID/SECRET — postojeći pikado.json ostaje`);
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
  if (sameTournament && existing.lastUpdated && !everyRun && !(await isDue(config.refreshHours))) {
    console.log(`${LABEL} nije na redu (svakih ${config.refreshHours ?? 1} h) — štedim API zahtjeve`);
    return;
  }

  let body;
  try {
    const token = await getToken(clientId, clientSecret);
    const res = await fetch(
      `${API}/v2.1/tournaments/${encodeURIComponent(slug)}.json?include=participants`,
      {
        headers: {
          "Authorization-Type": "v2",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} za turnir „${slug}"`);
    body = await res.json();
  } catch (err) {
    // Nikad ne logiramo token ni secret — samo poruku.
    console.warn(`${LABEL} dohvat nije uspio (${err?.message ?? err}) — postojeći podaci ostaju`);
    return;
  }

  const a = body?.data?.attributes;
  if (!a) {
    console.warn(`${LABEL} neočekivan odgovor API-ja — postojeći podaci ostaju`);
    return;
  }

  // Samo ime para. E-mail i Challonge korisničko ime iz prijave namjerno
  // ne idu u repo — javni su zauvijek kroz git povijest.
  const participants = (body.included ?? [])
    .filter((x) => x?.type === "participant" && x.attributes?.states?.active !== false)
    .map((x) => ({
      name: String(x.attributes.name ?? "").trim(),
      seed: Number(x.attributes.seed) || null,
    }))
    .filter((p) => p.name)
    .sort((x, y) => (x.seed ?? Infinity) - (y.seed ?? Infinity));

  const data = {
    lastUpdated: new Date().toISOString(),
    tournament: slug,
    name: a.name ?? null,
    state: a.state ?? null,
    startsAt: a.timestamps?.starts_at ?? null,
    signupUrl: a.sign_up_url ?? null,
    signupOpen: Boolean(a.registration_options?.open_signup),
    signupCap: Number(a.registration_options?.signup_cap) || null,
    format: formatOf(a),
    participants,
  };

  await writeJsonIfChanged(OUT, data, { label: LABEL });
  await rememberCheck();
  console.log(`${LABEL} prijavljenih parova: ${participants.length}, stanje: ${data.state}`);
}

main().catch((err) => {
  // Nikad ne ruši CI — turnir je sporedan, HNS i FB moraju proći.
  console.warn(`${LABEL} neočekivana greška: ${err?.message ?? err}`);
});
