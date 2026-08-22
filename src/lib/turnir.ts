/**
 * Motor za stranice turnira uživo (boćanje, penali, …).
 *
 * Podaci se čitaju iz javnog Google Sheeta kroz gviz endpoint, svakih
 * REFRESH_MS. Sheet ima dva taba: popis ekipa (s grupom i članovima) i popis
 * utakmica. Oboje se popunjava ručno ili Apps Scriptom u samom Sheetu —
 * ždrijeb se NE smije generirati ovdje jer bi svaki posjetitelj i svaki
 * refresh dobio drugačiji raspored.
 *
 * Što stranica radi sama: grupne tablice s tie-breakom, plasman u eliminaciju,
 * popunjavanje eliminacijskih parova kako rezultati stižu, bracket, raspored,
 * statistika i panel po ekipi.
 *
 * Konfiguracija dolazi iz `<script type="application/json" id="turnir-config">`,
 * pa isti kod poslužuje turnire s različitim terminologijom i formatom.
 */

export type TurnirConfig = {
  sheetId: string;
  tabs: { teams: string; matches: string };
  /** Indeksi stupaca u tabu s ekipama. */
  teamCols: { group: number; name: number; players: number[] };
  /** Indeksi stupaca u tabu s utakmicama; `teren` null ako turnir nema terene. */
  matchCols: {
    redni: number;
    faza: number;
    grupa: number;
    vrijeme: number;
    teren: number | null;
    home: number;
    away: number;
    scoreHome: number;
    scoreAway: number;
  };
  /** Koliko mečeva ide paralelno (broj terena/golova). 1 ako se igra jedan po jedan. */
  courts: number;
  /** Nazivi onoga što se broji — mijenja se po turniru („boće", „golovi"). */
  unit: {
    /** Zaglavlje stupca u tablici. */
    label: string;
    /** Kartica statistike: „Ukupno boća". */
    totalLabel: string;
    /** Kartica statistike: „Najviše osvojenih boća". */
    mostLabel: string;
    /** Uz broj: „55 boća". */
    countWord: string;
  };
  /** "Par" ili "Ekipa" — koristi se u zaglavljima tablica. */
  teamWord: string;
  /** Naslov iznad popisa članova u panelu ekipe. */
  playersLabel: string;
  /** Početak turnira (ISO) — za odbrojavanje. */
  start: string;
  /** Ključ u localStorage za „prati svoju ekipu". */
  followKey: string;
  /** Koliko ekipa iz svake grupe ide dalje. */
  qualifiersPerGroup: number;
};

type Team = { name: string; grupa: string };
type Match = {
  redni: number;
  faza: string;
  grupa: string;
  vrijeme: string;
  teren: string;
  home: string;
  away: string;
  bd: number | null;
  bg: number | null;
  played: boolean;
  hasTeams: boolean;
};
type Row = {
  name: string;
  P: number;
  Pob: number;
  Por: number;
  Ner: number;
  BF: number;
  BA: number;
  RAZ: number;
  rank: number;
};
type Data = {
  groups: Record<string, string[]>;
  groupKeys: string[];
  rosters: Record<string, string[]>;
  allTeams: Team[];
  matches: Match[];
  standings: Record<string, Row[]>;
  groupsDone: boolean;
  qualifiers: { list: { lbl: string; name: string }[]; pairs: [string, string][] } | null;
  drawn: boolean;
};

const REFRESH_MS = 25000;
const KO_ORDER = ["Četvrtfinale", "Polufinale", "Za 3. mjesto", "Finale"];

/** Pokreće stranicu; vraća funkciju za čišćenje (intervali + listeneri). */
export function initTurnir(cfg: TurnirConfig): () => void {
  const START = new Date(cfg.start);
  let LAST: Data | null = null;
  let RFILTER = "sve";
  let VMODE = "grupe";
  let FOLLOW = "";
  try {
    FOLLOW = localStorage.getItem(cfg.followKey) || "";
  } catch {
    /* privatni način rada — praćenje jednostavno ne pamti */
  }

  const $ = (id: string) => document.getElementById(id)!;
  const esc = (s: unknown) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const isNum = (v: unknown) => v !== "" && v !== null && !isNaN(Number(v));
  const cell = (r: unknown[], i: number | null) => (i == null ? "" : String(r[i] ?? "").trim());

  // ── Sitni prikazni helperi ──────────────────────────────────────────
  const AV_COLORS = ["#10275c","#1e4fa0","#0e7490","#7c3aed","#b45309","#be123c","#15803d","#0f766e","#4d7c0f","#9333ea","#c2410c","#2563a8"];
  const hashN = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const initials = (name: string) => {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
  };
  const avatar = (name: string, size = 22) => {
    if (!name) return "";
    const c = AV_COLORS[hashN(name) % AV_COLORS.length];
    return `<span class="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${c}">${esc(initials(name))}</span>`;
  };
  const linkTeam = (name: string) => {
    if (!name) return "—";
    const st = name === FOLLOW ? '<span class="text-[#F6C500]">★</span>' : "";
    return `<span class="team-link cursor-pointer hover:underline decoration-dotted underline-offset-2" data-team="${esc(name)}">${st}${esc(name)}</span>`;
  };

  const timeMin = (v: string) => {
    const s = String(v || "");
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    if (/pm/i.test(s) && h < 12) h += 12;
    if (/am/i.test(s) && h === 12) h = 0;
    return h * 60 + min;
  };
  /** Utakmice poslije ponoći idu na kraj, ne na početak dana. */
  const orderKey = (m: Match) => {
    let t = timeMin(m.vrijeme);
    if (t === null) return 100000 + (m.redni || 0);
    if (t < 720) t += 1440;
    return t;
  };
  const fmtTime = (v: string) => {
    const t = timeMin(v);
    if (t === null) return "";
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  };

  // ── Google Sheet ────────────────────────────────────────────────────
  const gvizUrl = (sheet: string) =>
    `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheet)}&_=${Date.now()}`;

  function parseGviz(text: string): unknown[][] {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return (json.table.rows || []).map((r: any) =>
      (r.c || []).map((c: any) => {
        let v = c ? (c.f !== undefined && c.f !== null ? c.f : c.v) : "";
        if (v === null || v === undefined) v = "";
        return typeof v === "string" ? v.trim() : v;
      }),
    );
  }
  async function fetchTab(sheet: string) {
    const res = await fetch(gvizUrl(sheet), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseGviz(await res.text());
  }

  // ── Obrada ──────────────────────────────────────────────────────────

  /**
   * Poredak unutar grupe kad je više ekipa izjednačeno po pobjedama:
   * međusobni susret → razlika → osvojeno → ime.
   */
  function orderGroupH2H(teams: Row[], gm: Match[]): Row[] {
    const byW = [...teams].sort((a, b) => b.Pob - a.Pob);
    const out: Row[] = [];
    let i = 0;
    while (i < byW.length) {
      let j = i;
      while (j < byW.length && byW[j].Pob === byW[i].Pob) j++;
      const cluster = byW.slice(i, j);
      if (cluster.length > 1) {
        const names = new Set(cluster.map((t) => t.name));
        const mini: Record<string, { w: number; bf: number; ba: number }> = {};
        cluster.forEach((t) => (mini[t.name] = { w: 0, bf: 0, ba: 0 }));
        gm.forEach((m) => {
          if (names.has(m.home) && names.has(m.away)) {
            const h = mini[m.home], a = mini[m.away];
            h.bf += m.bd!; h.ba += m.bg!; a.bf += m.bg!; a.ba += m.bd!;
            if (m.bd! > m.bg!) h.w++;
            else if (m.bg! > m.bd!) a.w++;
          }
        });
        cluster.sort((a, b) => {
          const A = mini[a.name], B = mini[b.name];
          if (B.w !== A.w) return B.w - A.w;
          const Ar = A.bf - A.ba, Br = B.bf - B.ba;
          if (Br !== Ar) return Br - Ar;
          if (b.RAZ !== a.RAZ) return b.RAZ - a.RAZ;
          if (b.BF !== a.BF) return b.BF - a.BF;
          return a.name.localeCompare(b.name, "hr");
        });
      }
      out.push(...cluster);
      i = j;
    }
    return out;
  }

  function processData(teamRows: unknown[][], matchRows: unknown[][]): Data {
    const tc = cfg.teamCols;
    const rosters: Record<string, string[]> = {};
    const allTeams: Team[] = [];
    const groups: Record<string, string[]> = {};

    teamRows.forEach((r) => {
      const name = cell(r, tc.name);
      if (!name) return;
      const g = cell(r, tc.group).toUpperCase();
      rosters[name] = tc.players.map((i) => cell(r, i)).filter(Boolean);
      allTeams.push({ name, grupa: g });
      if (g) (groups[g] ||= []).push(name);
    });

    // Grupe se izvode iz podataka, ne hardkodiraju — broj ekipa se zna tek
    // kad se zatvore prijave, pa broj grupa varira od turnira do turnira.
    const groupKeys = Object.keys(groups).sort();

    const mc = cfg.matchCols;
    const matches: Match[] = [];
    matchRows.forEach((r) => {
      const faza = cell(r, mc.faza);
      if (!faza) return;
      const home = cell(r, mc.home), away = cell(r, mc.away);
      const played = isNum(r[mc.scoreHome]) && isNum(r[mc.scoreAway]);
      matches.push({
        redni: isNum(r[mc.redni]) ? Number(r[mc.redni]) : matches.length + 1,
        faza,
        grupa: cell(r, mc.grupa).toUpperCase(),
        vrijeme: cell(r, mc.vrijeme),
        teren: cell(r, mc.teren),
        home,
        away,
        bd: played ? Number(r[mc.scoreHome]) : null,
        bg: played ? Number(r[mc.scoreAway]) : null,
        played,
        hasTeams: !!(home && away),
      });
    });

    const standings: Record<string, Row[]> = {};
    for (const g of groupKeys) {
      const tbl: Record<string, Row> = {};
      groups[g].forEach(
        (n) => (tbl[n] = { name: n, P: 0, Pob: 0, Por: 0, Ner: 0, BF: 0, BA: 0, RAZ: 0, rank: 0 }),
      );
      const gm = matches.filter((m) => m.faza === "Grupa" && m.grupa === g && m.played && m.hasTeams);
      gm.forEach((m) => {
        const h = tbl[m.home], a = tbl[m.away];
        if (!h || !a) return;
        h.P++; a.P++;
        h.BF += m.bd!; h.BA += m.bg!; a.BF += m.bg!; a.BA += m.bd!;
        if (m.bd! > m.bg!) { h.Pob++; a.Por++; }
        else if (m.bg! > m.bd!) { a.Pob++; h.Por++; }
        else { h.Ner++; a.Ner++; }
      });
      const arr = Object.values(tbl).map((t) => ({ ...t, RAZ: t.BF - t.BA }));
      const ordered = orderGroupH2H(arr, gm);
      ordered.forEach((t, i) => (t.rank = i + 1));
      standings[g] = ordered;
    }

    const groupMs = matches.filter((m) => m.faza === "Grupa" && m.hasTeams);
    const groupsDone = groupMs.length > 0 && groupMs.every((m) => m.played);
    const qualifiers = groupsDone ? computeQualifiers(standings, groupKeys) : null;
    if (qualifiers) resolveKnockout(matches, qualifiers);

    const drawn = matches.some((m) => m.faza === "Grupa" && m.hasTeams);
    return { groups, groupKeys, rosters, allTeams, matches, standings, groupsDone, qualifiers, drawn };
  }

  /**
   * Plasirani i eliminacijski parovi, unakrsno — nitko ne igra protiv ekipe iz
   * svoje grupe. Podržano za 2 grupe (odmah polufinale) i 4 grupe (četvrtfinale).
   * Kod drugačijeg broja grupa parove se upisuje ručno u Sheet.
   */
  function computeQualifiers(s: Record<string, Row[]>, keys: string[]) {
    const n = cfg.qualifiersPerGroup;
    if (keys.length !== 2 && keys.length !== 4) return null;
    for (const g of keys) if (!s[g] || s[g].length < n) return null;

    const list: { lbl: string; name: string }[] = [];
    keys.forEach((g) => {
      for (let i = 0; i < n; i++) list.push({ lbl: `${i + 1}. ${g}`, name: s[g][i].name });
    });

    // Prvi iz jedne grupe protiv drugoga iz sljedeće, u krug.
    const pairs: [string, string][] = [];
    keys.forEach((g, i) => {
      const other = keys[(i + 1) % keys.length];
      pairs.push([s[g][0].name, s[other][1].name]);
    });
    return { list, pairs };
  }

  function resolveKnockout(matches: Match[], q: { pairs: [string, string][] }) {
    const pick = (f: string) => matches.filter((m) => m.faza === f);
    const qf = pick("Četvrtfinale"), sf = pick("Polufinale");
    const third = pick("Za 3. mjesto")[0], fin = pick("Finale")[0];
    const setT = (m: Match | undefined, h: string, a: string) => {
      if (!m) return;
      if (!m.home) m.home = h || "";
      if (!m.away) m.away = a || "";
      m.hasTeams = !!(m.home && m.away);
    };
    const win = (m?: Match) => (m && m.played && m.home && m.away ? (m.bd! > m.bg! ? m.home : m.bg! > m.bd! ? m.away : "") : "");
    const lose = (m?: Match) => (m && m.played && m.home && m.away ? (m.bd! > m.bg! ? m.away : m.bg! > m.bd! ? m.home : "") : "");

    // 4 para → četvrtfinale pa polufinale; 2 para → odmah polufinale.
    const entry = q.pairs.length === 4 ? qf : sf;
    for (let i = 0; i < Math.min(q.pairs.length, entry.length); i++) {
      setT(entry[i], q.pairs[i][0], q.pairs[i][1]);
    }
    if (q.pairs.length === 4) {
      setT(sf[0], win(qf[0]), win(qf[1]));
      setT(sf[1], win(qf[2]), win(qf[3]));
    }
    setT(fin, win(sf[0]), win(sf[1]));
    setT(third, lose(sf[0]), lose(sf[1]));
  }

  // ── Render ──────────────────────────────────────────────────────────

  function renderRegistration(teams: Team[]) {
    const wrap = $("prijave");
    const list = (teams || []).slice().sort((a, b) => a.name.localeCompare(b.name, "hr"));
    if (!list.length) {
      $("sec-prijave").classList.add("hidden");
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = list
      .map((t, i) => `<div class="team-link flex items-center gap-3 bg-white rounded-lg border border-[#C9D4E8] px-3 py-2.5 shadow-sm cursor-pointer hover:border-[#1e4fa0]" data-team="${esc(t.name)}"><span class="text-[#64748B] text-xs font-display w-5 text-center shrink-0">${i + 1}</span>${avatar(t.name, 26)}<span class="font-medium truncate">${esc(t.name)}</span></div>`)
      .join("");
    const hh = document.querySelector("#sec-prijave h2");
    if (hh) hh.textContent = "Prijavljene ekipe (" + list.length + ")";
    $("sec-prijave").classList.remove("hidden");
  }

  function renderGroups(data: Data) {
    const wrap = $("grupe");
    wrap.innerHTML = "";
    for (const g of data.groupKeys) {
      const table = data.standings[g];
      if (!table || !table.length) continue;
      const rows = table
        .map((t) => {
          const qual = t.name === FOLLOW ? "bg-[#FFF3C4]" : t.rank <= cfg.qualifiersPerGroup ? "bg-green-50" : "";
          const rk = t.rank === 1 ? "🥇" : t.rank;
          return `<tr class="border-b border-[#C9D4E8] ${qual}">
          <td class="px-2 py-2 font-display text-center">${rk}</td>
          <td class="px-2 py-2"><div class="flex items-center gap-2">${avatar(t.name, 22)}<span class="font-medium">${linkTeam(t.name)}</span></div></td>
          <td class="px-1 py-2 text-center">${t.P}</td>
          <td class="px-1 py-2 text-center hidden sm:table-cell">${t.Pob}</td>
          <td class="px-1 py-2 text-center hidden sm:table-cell">${t.Por}</td>
          <td class="px-1 py-2 text-center text-[#64748B]">${t.BF}:${t.BA}</td>
          <td class="px-2 py-2 text-center font-bold">${t.RAZ > 0 ? "+" + t.RAZ : t.RAZ}</td>
        </tr>`;
        })
        .join("");
      wrap.insertAdjacentHTML(
        "beforeend",
        `<div class="bg-white rounded-lg shadow-md border border-[#C9D4E8] overflow-hidden">
        <div class="text-white px-4 py-2.5 font-display uppercase tracking-wider text-sm" style="background:#10275c">Grupa ${esc(g)}</div>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead class="text-white" style="background:#1e4fa0"><tr>
            <th class="px-2 py-2 text-center font-display text-xs">#</th>
            <th class="px-2 py-2 text-left font-display text-xs">${esc(cfg.teamWord)}</th>
            <th class="px-1 py-2 text-center font-display text-xs">O</th>
            <th class="px-1 py-2 text-center font-display text-xs hidden sm:table-cell">P</th>
            <th class="px-1 py-2 text-center font-display text-xs hidden sm:table-cell">I</th>
            <th class="px-1 py-2 text-center font-display text-xs">${esc(cfg.unit.label)}</th>
            <th class="px-2 py-2 text-center font-display text-xs">+/-</th>
          </tr></thead><tbody>${rows}</tbody></table></div>
      </div>`,
      );
    }
  }

  function matchCard(m: Match, highlight: boolean, est: string | null) {
    const done = m.played;
    const score = done
      ? `<span class="font-bold text-lg tabular-nums">${m.bd} : ${m.bg}</span>`
      : `<span class="text-[#64748B] text-sm font-display">${(est != null ? est : fmtTime(m.vrijeme)) || (m.teren ? "Teren " + esc(m.teren) : "—")}</span>`;
    const hw = done && m.bd! > m.bg! ? "font-bold" : "";
    const aw = done && m.bg! > m.bd! ? "font-bold" : "";
    const ring = highlight ? "ring-2 ring-[#F6C500]" : "";
    const terenTag = !done && m.teren ? `<div class="text-[10px] text-[#64748B] font-display uppercase leading-tight">Teren ${esc(m.teren)}</div>` : "";
    const foll = FOLLOW && (m.home === FOLLOW || m.away === FOLLOW) ? "bg-[#FFF9E0]" : "bg-white";
    return `<div class="flex items-center gap-3 ${foll} rounded-lg shadow-sm border border-[#C9D4E8] px-4 py-3 ${ring}">
      <div class="flex-1 flex items-center justify-end gap-2 text-right ${hw}"><span>${linkTeam(m.home)}</span>${avatar(m.home, 24)}</div>
      <div class="px-2 text-center min-w-[70px] shrink-0">${score}${terenTag}</div>
      <div class="flex-1 flex items-center gap-2 ${aw}">${avatar(m.away, 24)}<span>${linkTeam(m.away)}</span></div>
    </div>`;
  }

  function renderSchedule(data: Data, filter: string, vmode: string) {
    const matches = data.matches;
    const wrap = $("raspored");
    wrap.innerHTML = "";
    const keep = (m: Match) => (filter === "sve" ? true : filter === "odigrano" ? m.played : !m.played);
    const pend = matches.filter((m) => m.hasTeams && !m.played).sort((a, b) => orderKey(a) - orderKey(b));
    const nextSet = new Set(pend.slice(0, cfg.courts).map((m) => m.redni));
    const grpOk = (m: Match) => (m.faza === "Grupa" ? m.hasTeams : m.hasTeams || m.played);
    const pool = matches.filter((m) => grpOk(m) && keep(m));
    const card = (m: Match) => matchCard(m, nextSet.has(m.redni), fmtTime(m.vrijeme));
    const byT = (a: Match, b: Match) => orderKey(a) - orderKey(b);
    let shown = 0;
    const section = (title: string, cls: string, arr: Match[]) => {
      if (!arr.length) return;
      shown += arr.length;
      wrap.insertAdjacentHTML("beforeend", `<div><h3 class="font-display uppercase tracking-wider text-sm ${cls} mb-2 mt-4">${title}</h3><div class="space-y-2">${arr.map(card).join("")}</div></div>`);
    };
    if (vmode === "teren") {
      const terens = [...new Set(pool.map((m) => m.teren).filter(Boolean))].sort();
      terens.forEach((tn) => section("Teren " + esc(tn), "text-[#1e4fa0]", pool.filter((m) => m.teren === tn).sort(byT)));
      section("Ostalo / eliminacija", "text-[#CF2130]", pool.filter((m) => !m.teren).sort(byT));
    } else if (vmode === "vrijeme") {
      section("Kronološki", "text-[#1e4fa0]", pool.slice().sort(byT));
    } else {
      data.groupKeys.forEach((g) => section("Grupa " + esc(g), "text-[#1e4fa0]", pool.filter((m) => m.faza === "Grupa" && m.grupa === g).sort(byT)));
      KO_ORDER.forEach((faza) => section(faza, "text-[#CF2130]", pool.filter((m) => m.faza === faza).sort(byT)));
    }
    if (!shown) {
      wrap.innerHTML = `<p class="text-[#64748B] text-sm py-4">${filter === "odigrano" ? "Još nema odigranih utakmica." : "Nema utakmica za prikaz."}</p>`;
    }
  }

  /** Bracket: 8 ekipa (ČF→PF→F) ili 4 ekipe (PF→F), ovisno o tome što je u Sheetu. */
  function generateBracket(matches: Match[]) {
    const trunc = (s: string, n = 16) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
    const pick = (f: string) => matches.filter((m) => m.faza === f);
    const qf = pick("Četvrtfinale"), sf = pick("Polufinale");
    const fin = pick("Finale")[0], third = pick("Za 3. mjesto")[0];
    const all = [...qf, ...sf, ...(fin ? [fin] : []), ...(third ? [third] : [])];
    if (!all.some((m) => m && m.hasTeams)) return "";

    const hasQF = qf.length >= 4;
    const BW = 176, BH = 54;
    const COL = hasQF
      ? { LQF: 12, LSF: 232, FIN: 452, RSF: 672, RQF: 892 }
      : { LQF: 0, LSF: 12, FIN: 232, RSF: 452, RQF: 0 };
    const WIDTH = hasQF ? 1080 : 640;
    const V = "#cbd5e1", BORD = "#C9D4E8", DEEP = "#10275c", PRIM = "#1e4fa0", MUT = "#64748B", ACC = "#F6C500";
    const parts: string[] = [];
    const cy = (y: number) => y + BH / 2;

    function box(x: number, y: number, m?: Match) {
      const mm = m ?? ({ home: "", away: "", played: false, bd: null, bg: null } as Match);
      const done = mm.played, hw = done && mm.bd! > mm.bg!, aw = done && mm.bg! > mm.bd!;
      const hn = trunc(mm.home || "—"), an = trunc(mm.away || "—");
      const sd = done ? String(mm.bd) : "", sg = done ? String(mm.bg) : "";
      parts.push(`<rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="6" fill="#ffffff" stroke="${BORD}"/>`);
      parts.push(`<line x1="${x}" y1="${y + BH / 2}" x2="${x + BW}" y2="${y + BH / 2}" stroke="${BORD}"/>`);
      parts.push(`<text x="${x + 10}" y="${y + 18}" font-size="13" font-weight="${hw ? 700 : 500}" fill="${hw ? PRIM : DEEP}">${esc(hn)}</text>`);
      parts.push(`<text x="${x + BW - 10}" y="${y + 18}" font-size="13" text-anchor="end" font-weight="700" fill="${hw ? PRIM : DEEP}">${esc(sd)}</text>`);
      parts.push(`<text x="${x + 10}" y="${y + 42}" font-size="13" font-weight="${aw ? 700 : 500}" fill="${aw ? PRIM : DEEP}">${esc(an)}</text>`);
      parts.push(`<text x="${x + BW - 10}" y="${y + 42}" font-size="13" text-anchor="end" font-weight="700" fill="${aw ? PRIM : DEEP}">${esc(sg)}</text>`);
    }
    const conn = (pts: string) => parts.push(`<polyline points="${pts}" fill="none" stroke="${V}" stroke-width="1.5"/>`);
    const lbl = (x: number, t: string) => parts.push(`<text x="${x + BW / 2}" y="30" font-size="12" text-anchor="middle" font-family="Oswald,Arial,sans-serif" letter-spacing="1" fill="${MUT}">${t}</text>`);

    const qfY = [46, 352];
    const sfTop = (cy(qfY[0]) + cy(qfY[1])) / 2 - BH / 2;
    const finTop = sfTop, sfC = cy(sfTop);

    if (hasQF) {
      lbl(COL.LQF, "ČETVRTFINALE"); lbl(COL.RQF, "ČETVRTFINALE");
      box(COL.LQF, qfY[0], qf[0]); box(COL.LQF, qfY[1], qf[1]);
      box(COL.RQF, qfY[0], qf[2]); box(COL.RQF, qfY[1], qf[3]);
      const mL = (COL.LQF + BW + COL.LSF) / 2, mR = (COL.RSF + BW + COL.RQF) / 2;
      conn(`${COL.LQF + BW},${cy(qfY[0])} ${mL},${cy(qfY[0])} ${mL},${sfC} ${COL.LSF},${sfC}`);
      conn(`${COL.LQF + BW},${cy(qfY[1])} ${mL},${cy(qfY[1])} ${mL},${sfC} ${COL.LSF},${sfC}`);
      conn(`${COL.RQF},${cy(qfY[0])} ${mR},${cy(qfY[0])} ${mR},${sfC} ${COL.RSF + BW},${sfC}`);
      conn(`${COL.RQF},${cy(qfY[1])} ${mR},${cy(qfY[1])} ${mR},${sfC} ${COL.RSF + BW},${sfC}`);
    }
    lbl(COL.LSF, "POLUFINALE"); lbl(COL.FIN, "FINALE"); lbl(COL.RSF, "POLUFINALE");
    box(COL.LSF, sfTop, sf[0]); box(COL.RSF, sfTop, sf[1]); box(COL.FIN, finTop, fin);
    conn(`${COL.LSF + BW},${sfC} ${COL.FIN},${sfC}`);
    conn(`${COL.RSF},${sfC} ${COL.FIN + BW},${sfC}`);

    let champ = "";
    if (fin && fin.played) champ = fin.bd! > fin.bg! ? fin.home : fin.bg! > fin.bd! ? fin.away : "";
    if (champ) {
      parts.push(`<text x="${COL.FIN + BW / 2}" y="${finTop + BH + 34}" font-size="12" text-anchor="middle" font-family="Oswald,Arial,sans-serif" letter-spacing="1" fill="${MUT}">PRVAK</text>`);
      parts.push(`<rect x="${COL.FIN - 10}" y="${finTop + BH + 44}" width="${BW + 20}" height="34" rx="6" fill="${ACC}"/>`);
      parts.push(`<text x="${COL.FIN + BW / 2}" y="${finTop + BH + 66}" font-size="15" text-anchor="middle" font-weight="700" font-family="Oswald,Arial,sans-serif" fill="${DEEP}">🏆 ${esc(trunc(champ))}</text>`);
    }
    if (third && (third.hasTeams || third.played)) {
      const ty = 430;
      parts.push(`<text x="${COL.FIN + BW / 2}" y="${ty - 8}" font-size="12" text-anchor="middle" font-family="Oswald,Arial,sans-serif" letter-spacing="1" fill="${MUT}">ZA 3. MJESTO</text>`);
      box(COL.FIN, ty, third);
    }
    const H = third ? 510 : champ ? finTop + BH + 100 : finTop + BH + 40;
    const minW = hasQF ? 760 : 520;
    return `<svg viewBox="0 0 ${WIDTH} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;min-width:${minW}px;height:auto;font-family:Inter,Arial,sans-serif">${parts.join("")}</svg>`;
  }

  function renderQualifiers(q: Data["qualifiers"]) {
    const el = $("kvalificirani");
    if (!q || !q.list) { el.innerHTML = ""; return; }
    const chips = q.list
      .map((x) => `<div class="flex items-center gap-2 bg-white rounded-lg border border-[#C9D4E8] px-3 py-2 shadow-sm">${avatar(x.name, 22)}<div class="min-w-0"><div class="font-medium text-sm truncate">${linkTeam(x.name)}</div><div class="text-[11px] text-[#64748B] uppercase font-display">${esc(x.lbl)}</div></div></div>`)
      .join("");
    el.innerHTML = `<div class="bg-green-50 border border-green-200 rounded-lg p-4">
      <div class="font-display uppercase tracking-wider text-xs text-green-800 mb-3">Prošli u eliminaciju (${q.list.length})</div>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">${chips}</div>
      <p class="text-[11px] text-[#64748B] mt-3">Parovi se slažu automatski i unakrsno — nitko protiv ekipe iz svoje grupe. Ručni upis u Sheet ima prednost.</p>
    </div>`;
  }

  function renderKnockout(data: Data) {
    const sec = $("sec-nokaut");
    renderQualifiers(data.qualifiers);
    const svg = generateBracket(data.matches);
    $("nokaut").innerHTML = svg || "";
    $("nokaut").classList.toggle("hidden", !svg);
    const hasQual = !!(data.qualifiers && data.qualifiers.list.length);
    sec.classList.toggle("hidden", !(svg || hasQual));
  }

  function renderProgress(matches: Match[]) {
    const withTeams = matches.filter((m) => m.hasTeams);
    const total = withTeams.length, done = withTeams.filter((m) => m.played).length;
    const el = $("progress");
    if (!total) { el.classList.add("hidden"); return; }
    const pct = Math.round((done / total) * 100);
    el.innerHTML = `<div class="rounded-lg bg-white border border-[#C9D4E8] shadow-sm p-3">
      <div class="flex items-center justify-between mb-1.5"><span class="font-display uppercase tracking-wider text-xs text-[#64748B]">Napredak turnira</span><span class="font-bold text-sm">${done}/${total} odigrano</span></div>
      <div class="h-2 rounded-full bg-[#EAF0FB] overflow-hidden"><div class="h-full transition-all" style="width:${pct}%;background:#1e4fa0"></div></div>
    </div>`;
    el.classList.remove("hidden");
  }

  function tickCountdown() {
    const el = $("countdown");
    if (!el) return;
    const diff = START.getTime() - Date.now();
    const started = LAST && LAST.matches.some((m) => m.played);
    if (diff <= 0 || started) { el.classList.add("hidden"); return; }
    const d = Math.floor(diff / 864e5), h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4), s = Math.floor((diff % 6e4) / 1e3);
    const p = (n: number) => String(n).padStart(2, "0");
    const txt = d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
    el.innerHTML = `<div class="rounded-lg px-4 py-4 text-white text-center shadow-md" style="background:linear-gradient(135deg,#10275c,#1e4fa0)"><div class="font-display uppercase tracking-widest text-xs opacity-80 mb-1">Turnir počinje za</div><div class="font-display font-bold text-3xl md:text-4xl tabular-nums text-[#F6C500]">${txt}</div></div>`;
    el.classList.remove("hidden");
  }

  function toggleBtns(sel: string, val: string, attr: string) {
    document.querySelectorAll<HTMLElement>(sel).forEach((x) => {
      const on = x.dataset[attr] === val;
      x.classList.toggle("bg-[#1e4fa0]", on);
      x.classList.toggle("text-white", on);
      x.classList.toggle("bg-[#EAF0FB]", !on);
      x.classList.toggle("text-[#10275c]", !on);
    });
  }
  const setFilter = (f: string) => { RFILTER = f; toggleBtns("#rf .rfbtn", f, "f"); if (LAST) renderSchedule(LAST, RFILTER, VMODE); };
  const setVMode = (v: string) => { VMODE = v; toggleBtns("#vm .vmbtn", v, "v"); if (LAST) renderSchedule(LAST, RFILTER, VMODE); };

  function renderTop(matches: Match[]) {
    const sec = $("sec-uzivo");
    const seq = matches.filter((m) => m.hasTeams).slice().sort((a, b) => orderKey(a) - orderKey(b));
    const pending = seq.filter((m) => !m.played);
    const underway = seq.some((m) => m.played);
    const faze = (m: Match) => (m.faza === "Grupa" ? "Grupa " + m.grupa : m.faza);
    if (!pending.length) {
      sec.classList.add("hidden");
      $("uzivo-live").innerHTML = ""; $("uzivo-next").innerHTML = "";
      return;
    }
    // Po jedan meč sa svakog terena, pa dopuna do broja paralelnih mečeva.
    const curR = new Set<number>();
    const cur: Match[] = [];
    const terens = [...new Set(pending.map((m) => m.teren).filter(Boolean))].sort();
    terens.forEach((tn) => {
      const m = pending.find((x) => x.teren === tn && !curR.has(x.redni));
      if (m && cur.length < cfg.courts) { cur.push(m); curR.add(m.redni); }
    });
    for (const m of pending) {
      if (cur.length >= cfg.courts) break;
      if (!curR.has(m.redni)) { cur.push(m); curR.add(m.redni); }
    }
    cur.sort((a, b) => orderKey(a) - orderKey(b));
    const dot = underway
      ? '<span class="w-2.5 h-2.5 rounded-full bg-[#CF2130] animate-pulse"></span>'
      : '<span class="w-2.5 h-2.5 rounded-full bg-[#F6C500]"></span>';
    const curCards = cur
      .map((m) => `
      <div class="flex items-center gap-3 rounded-lg border-2 ${underway ? "border-[#CF2130]" : "border-[#F6C500]"} bg-white px-4 py-3 shadow-sm">
        <div class="flex-1 flex items-center justify-end gap-2 text-right font-medium"><span>${linkTeam(m.home)}</span>${avatar(m.home, 26)}</div>
        <div class="px-2 text-center shrink-0"><div class="text-[#64748B] text-xs font-display uppercase">${esc(faze(m))}</div><div class="text-[#1e4fa0] font-display font-bold text-sm">${m.teren ? "Teren " + esc(m.teren) : fmtTime(m.vrijeme) ? "~" + fmtTime(m.vrijeme) : "vs"}</div></div>
        <div class="flex-1 flex items-center gap-2 font-medium">${avatar(m.away, 26)}<span>${linkTeam(m.away)}</span></div>
      </div>`)
      .join("");
    $("uzivo-live").innerHTML = `<h2 class="text-lg font-bold mb-2 flex items-center gap-2 text-[#10275c]">${dot}${underway ? "Trenutno na terenu" : "Prvo na redu"}</h2><div class="space-y-2">${curCards}</div>`;

    const nextList = pending.filter((m) => !curR.has(m.redni)).slice(0, 4);
    $("uzivo-next").innerHTML = nextList.length
      ? `<h3 class="text-sm font-display uppercase tracking-wider text-[#64748B] mb-2 mt-4">Slijedi</h3><div class="space-y-2">${nextList
          .map((m) => `
      <div class="flex items-center gap-3 rounded-lg border border-[#C9D4E8] bg-white px-4 py-2.5 shadow-sm">
        <span class="shrink-0 text-[#64748B] text-[11px] font-display uppercase w-14">${esc(faze(m))}</span>
        <div class="flex-1 flex items-center gap-2 min-w-0">${avatar(m.home, 20)}<span class="truncate">${linkTeam(m.home)}</span></div>
        <span class="text-[#64748B] text-xs shrink-0">vs</span>
        <div class="flex-1 flex items-center justify-end gap-2 min-w-0 text-right"><span class="truncate">${linkTeam(m.away)}</span>${avatar(m.away, 20)}</div>
        <span class="shrink-0 text-[#64748B] text-xs tabular-nums w-12 text-right">${fmtTime(m.vrijeme) ? "~" + fmtTime(m.vrijeme) : ""}</span>
      </div>`)
          .join("")}</div><p class="text-xs text-[#64748B] mt-2">Vremena su okvirna.</p>`
      : "";
    sec.classList.remove("hidden");
  }

  function syncQuickNav() {
    let any = false;
    document.querySelectorAll<HTMLElement>("#quicknav .qn").forEach((a) => {
      const target = document.getElementById(a.dataset.target!);
      const vis = !!target && !target.classList.contains("hidden");
      a.classList.toggle("hidden", !vis);
      if (vis) any = true;
    });
    $("quicknav").classList.toggle("hidden", !any);
  }

  function openTeamSheet(team: string) {
    if (!LAST || !team) return;
    $("team-sheet-title").innerHTML = `<span class="inline-flex items-center gap-2">${avatar(team, 26)}<span class="truncate">${esc(team)}</span></span>`;
    let st: Row | null = null, grp: string | null = null;
    for (const g of LAST.groupKeys) {
      const t = (LAST.standings[g] || []).find((x) => x.name === team);
      if (t) { st = t; grp = g; }
    }
    const players = LAST.rosters?.[team] ?? [];
    const isFoll = FOLLOW === team;
    let html = `<button id="follow-btn" class="w-full mb-4 px-3 py-2 rounded-lg font-display uppercase text-sm ${isFoll ? "bg-[#EAF0FB] text-[#10275c] border border-[#C9D4E8]" : "bg-[#F6C500] text-[#10275c]"}">${isFoll ? "★ Pratiš — makni praćenje" : "☆ Prati ovu ekipu"}</button>`;
    if (st) {
      html += `<div class="grid grid-cols-4 gap-2 mb-4 text-center">
        <div class="bg-[#EAF0FB] rounded-lg p-2"><div class="text-[10px] text-[#64748B] font-display uppercase">Grupa</div><div class="font-bold">${esc(grp)} · ${st.rank}.</div></div>
        <div class="bg-[#EAF0FB] rounded-lg p-2"><div class="text-[10px] text-[#64748B] font-display uppercase">Pobjede</div><div class="font-bold">${st.Pob}-${st.Por}</div></div>
        <div class="bg-[#EAF0FB] rounded-lg p-2"><div class="text-[10px] text-[#64748B] font-display uppercase">${esc(cfg.unit.label)}</div><div class="font-bold">${st.BF}:${st.BA}</div></div>
        <div class="bg-[#EAF0FB] rounded-lg p-2"><div class="text-[10px] text-[#64748B] font-display uppercase">Razlika</div><div class="font-bold">${st.RAZ > 0 ? "+" + st.RAZ : st.RAZ}</div></div>
      </div>`;
    }
    html += `<div class="font-display uppercase tracking-wider text-xs text-[#64748B] mb-2">${esc(cfg.playersLabel)}</div>`;
    html += players.length
      ? `<div class="rounded-lg border border-[#C9D4E8] overflow-hidden mb-4 divide-y divide-[#C9D4E8]">${players.map((p) => `<div class="flex items-center gap-3 px-3 py-2">${avatar(p, 22)}<span class="flex-1">${esc(p)}</span></div>`).join("")}</div>`
      : `<p class="text-sm text-[#64748B] mb-4">Igrači još nisu uneseni u Sheet.</p>`;

    const tm = (LAST.matches || []).filter((m) => m.home === team || m.away === team).sort((a, b) => orderKey(a) - orderKey(b));
    if (tm.length) {
      html += `<div class="font-display uppercase tracking-wider text-xs text-[#64748B] mb-2">Utakmice</div><div class="space-y-1.5">` +
        tm.map((m) => {
          const isHome = m.home === team, opp = isHome ? m.away : m.home;
          let right: string;
          if (m.played) {
            const bf = isHome ? m.bd! : m.bg!, ba = isHome ? m.bg! : m.bd!;
            const res = bf > ba ? "P" : bf < ba ? "I" : "N";
            const col = bf > ba ? "bg-green-100 text-green-700" : bf < ba ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700";
            right = `<span class="tabular-nums font-bold">${bf}:${ba}</span><span class="inline-block w-5 text-center rounded ${col} text-xs font-bold">${res}</span>`;
          } else {
            right = `<span class="text-[#64748B] text-xs">${fmtTime(m.vrijeme) || (m.teren ? "T" + esc(m.teren) : "—")}</span>`;
          }
          return `<div class="flex items-center gap-2 text-sm border border-[#C9D4E8] rounded-lg px-3 py-2"><span class="text-[11px] text-[#64748B] font-display w-14 shrink-0">${m.faza === "Grupa" ? "Gr. " + esc(m.grupa) : esc(m.faza)}</span><span class="flex-1 truncate">${esc(opp)}</span>${right}</div>`;
        }).join("") + `</div>`;
    }
    $("team-sheet-body").innerHTML = html;
    $("follow-btn")?.addEventListener("click", () => { setFollow(isFoll ? "" : team); closeTeamSheet(); });
    $("team-sheet").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  const closeTeamSheet = () => { $("team-sheet").classList.add("hidden"); document.body.style.overflow = ""; };

  function setFollow(team: string) {
    FOLLOW = team || "";
    try {
      if (FOLLOW) localStorage.setItem(cfg.followKey, FOLLOW);
      else localStorage.removeItem(cfg.followKey);
    } catch { /* ignoriraj */ }
    if (!LAST) return;
    renderFollow(LAST);
    if (LAST.drawn) { renderTop(LAST.matches); renderGroups(LAST); renderSchedule(LAST, RFILTER, VMODE); }
    else renderRegistration(LAST.allTeams);
  }

  function renderFollow(data: Data) {
    const el = $("tvoja-ekipa");
    if (!FOLLOW || !data.rosters[FOLLOW]) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    const team = FOLLOW;
    const tm = data.matches.filter((m) => m.home === team || m.away === team);
    const next = tm.filter((m) => m.hasTeams && !m.played).sort((a, b) => orderKey(a) - orderKey(b))[0];
    let body: string;
    if (next) {
      const opp = next.home === team ? next.away : next.home;
      const when = next.teren ? "Teren " + esc(next.teren) : fmtTime(next.vrijeme) ? "~" + fmtTime(next.vrijeme) : "uskoro";
      body = `<div class="text-sm mt-0.5">Slijedi: <strong>${esc(opp)}</strong> <span class="text-white/70">· ${next.faza === "Grupa" ? "Gr. " + esc(next.grupa) : esc(next.faza)} · ${when}</span></div>`;
    } else {
      body = data.drawn
        ? `<div class="text-sm text-white/80 mt-0.5">Nema više utakmica na rasporedu.</div>`
        : `<div class="text-sm text-white/80 mt-0.5">Čeka se ždrijeb i raspored.</div>`;
    }
    el.innerHTML = `<div class="rounded-lg px-4 py-3 text-white shadow-md flex items-center gap-3" style="background:linear-gradient(135deg,#10275c,#1e4fa0)">
      <span class="text-[#F6C500] text-2xl leading-none">★</span>
      <div class="min-w-0 flex-1"><div class="font-display uppercase tracking-wider text-[11px] text-white/70">Tvoja ekipa</div><div class="font-bold truncate">${esc(team)}</div>${body}</div>
      <button id="unfollow-btn" class="shrink-0 text-xs font-display uppercase px-2 py-1 rounded bg-white/15 hover:bg-white/25">Makni</button>
    </div>`;
    el.classList.remove("hidden");
    $("unfollow-btn")?.addEventListener("click", () => setFollow(""));
  }

  function renderStats(data: Data) {
    const sec = $("sec-statistika");
    const played = data.matches.filter((m) => m.played && m.hasTeams);
    if (!played.length) { sec.classList.add("hidden"); return; }
    let total = 0;
    let biggest: { d: number; m: Match } | null = null;
    played.forEach((m) => {
      total += m.bd! + m.bg!;
      const d = Math.abs(m.bd! - m.bg!);
      if (!biggest || d > biggest.d) biggest = { d, m };
    });
    const teams: Row[] = [];
    data.groupKeys.forEach((g) => (data.standings[g] || []).forEach((t) => teams.push(t)));
    const topWins = teams.slice().sort((a, b) => b.Pob - a.Pob || b.RAZ - a.RAZ)[0];
    const topScore = teams.slice().sort((a, b) => b.BF - a.BF)[0];
    const bm = biggest!.m;
    const bw = bm.bd! > bm.bg! ? bm.home : bm.away;
    const bl = bm.bd! > bm.bg! ? bm.away : bm.home;
    const bs = Math.max(bm.bd!, bm.bg!) + ":" + Math.min(bm.bd!, bm.bg!);
    const c = (lbl: string, big: string, sub: string) =>
      `<div class="bg-white rounded-lg border border-[#C9D4E8] shadow-sm p-4"><div class="font-display uppercase tracking-wider text-[11px] text-[#64748B] mb-1">${lbl}</div><div class="font-bold text-lg text-[#10275c] truncate">${big}</div>${sub ? `<div class="text-sm text-[#64748B] truncate">${sub}</div>` : ""}</div>`;
    $("statistika").innerHTML = [
      c("Odigrano mečeva", String(played.length), "od ukupno " + data.matches.filter((m) => m.hasTeams).length),
      c(cfg.unit.totalLabel, String(total), "svi mečevi zajedno"),
      c("Najviše pobjeda", topWins ? esc(topWins.name) : "—", topWins ? topWins.Pob + " pobjeda" : ""),
      c(cfg.unit.mostLabel, topScore ? esc(topScore.name) : "—", topScore ? `${topScore.BF} ${cfg.unit.countWord}` : ""),
      c("Najveća pobjeda", bs, esc(bw) + " protiv " + esc(bl)),
    ].join("");
    sec.classList.remove("hidden");
  }

  // ── Petlja ──────────────────────────────────────────────────────────
  async function load() {
    try {
      const [teamRows, matchRows] = await Promise.all([fetchTab(cfg.tabs.teams), fetchTab(cfg.tabs.matches)]);
      const data = processData(teamRows, matchRows);
      LAST = data;
      renderFollow(data);
      if (data.drawn) {
        $("sec-prijave").classList.add("hidden");
        renderTop(data.matches);
        renderProgress(data.matches);
        renderGroups(data);
        renderKnockout(data);
        renderSchedule(data, RFILTER, VMODE);
        renderStats(data);
        $("sec-grupe").classList.remove("hidden");
        $("sec-raspored").classList.remove("hidden");
      } else {
        ["sec-uzivo", "sec-grupe", "sec-nokaut", "sec-raspored", "sec-statistika"].forEach((id) => $(id).classList.add("hidden"));
        $("progress").classList.add("hidden");
        renderRegistration(data.allTeams);
      }
      $("load-msg").classList.add("hidden");
      syncQuickNav();
      tickCountdown();
      $("status-text").textContent = "Uživo";
      $("live-dot").className = "w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse";
      $("last-updated").textContent = "Zadnje osvježeno: " + new Date().toLocaleTimeString("hr-HR");
    } catch {
      $("load-msg").innerHTML = `<div class="max-w-lg mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 text-left"><p class="font-bold text-[#10275c] mb-2">Rezultati trenutno nisu dostupni.</p><p class="text-sm text-[#64748B]">Provjeri da je Google tablica podijeljena kao <em>„Bilo tko s poveznicom → Preglednik"</em> i da postoje tabovi <em>${esc(cfg.tabs.teams)}</em> i <em>${esc(cfg.tabs.matches)}</em>.</p></div>`;
      $("status-text").textContent = "Nema veze";
      $("live-dot").className = "w-2.5 h-2.5 rounded-full bg-red-500";
    }
  }

  // ── Događaji ────────────────────────────────────────────────────────
  // Listeneri na document i intervali se pamte da ih `dispose` može maknuti —
  // inače bi svaka navigacija kroz View Transitions ostavila još jedan
  // interval koji dalje gađa Google Sheet.
  document.querySelectorAll<HTMLElement>("#rf .rfbtn").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f!)));
  document.querySelectorAll<HTMLElement>("#vm .vmbtn").forEach((b) => b.addEventListener("click", () => setVMode(b.dataset.v!)));

  const onDocClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-team]");
    if (t) openTeamSheet(t.dataset.team!);
  };
  const closePravila = () => { $("pravila-modal").classList.add("hidden"); document.body.style.overflow = ""; };
  const onKeydown = (e: KeyboardEvent) => { if (e.key === "Escape") { closeTeamSheet(); closePravila(); } };

  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeydown);
  $("team-sheet-close").addEventListener("click", closeTeamSheet);
  $("team-sheet-backdrop").addEventListener("click", closeTeamSheet);
  $("pravila-btn").addEventListener("click", () => { $("pravila-modal").classList.remove("hidden"); document.body.style.overflow = "hidden"; });
  $("pravila-close").addEventListener("click", closePravila);
  $("pravila-backdrop").addEventListener("click", closePravila);
  $("refresh-btn").addEventListener("click", load);

  load();
  const pollId = window.setInterval(load, REFRESH_MS);
  const tickId = window.setInterval(tickCountdown, 1000);

  return () => {
    clearInterval(pollId);
    clearInterval(tickId);
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
  };
}
