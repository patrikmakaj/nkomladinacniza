# CLAUDE.md

Upute za Claude Code pri radu na ovom repozitoriju. Cilj: ne istraživati sve iznova
svaki put. Sve što je ovdje napisano provjereno je u kodu — ako nešto ne odgovara
stvarnosti, popravi **i kod i ovaj dokument**.

## Što je ovo

Službena web stranica **NK Omladinac Niza** (Niza, Općina Koška, osnovan 1963.).

- **Stack:** Astro 6 + Tailwind CSS v4 + TypeScript (strict). Node ≥ 22.12.
- **Render:** 100 % statički (`output: static`, bez SSR adaptera). Sve se generira u build-u.
- **Hosting:** GitHub Pages, custom domena `omladinacniza.hr` (`public/CNAME`).
- **Jezik:** hrvatski — UI, komentari u kodu, commit poruke. Piši sve na hrvatskom.

## Komande

```bash
npm install
npm run dev        # dev server na http://localhost:4321
npx astro build    # build BEZ scrapea — koristi ovo za provjeru
npm run preview    # preview produkcijskog builda
```

> **Ne pokreći `npm run build` osim ako stvarno želiš scrapeati.** `prebuild` hook
> pokreće sva tri scrapera i prepisuje `src/data/*.json`. Za provjeru da kod radi
> koristi `npx astro build` — to je isto što radi CI u deploy job-u.

Scraperi (rijetko se pokreću ručno):

```bash
npm run scrape:hns         # HNS Semafor → src/data/hns.json
npm run scrape:facebook    # FB postovi → src/data/facebook.json (treba FB_* env)
npm run scrape:fb-albums   # FB albumi → src/data/facebook-albums.json (treba FB_* env)
```

Nema testova, lintera ni formattera. **Provjera prije commita = `npx astro build` mora proći.**

## Tok podataka

```
HNS Semafor (klub 134)  ─┐
Facebook Graph API v21   ─┼─► scripts/*.mjs ─► src/data/*.json ─► Astro build ─► dist/ ─► GH Pages
friendlies.json (ručno) ─┘                          (commit-ano u repo)
```

GitHub Action `scrape-and-deploy.yml` vrti se **svakih 30 min** + na svaki push u `main`.
Scrape job commita svježe podatke, build job gradi točno ono što je commitano
(namjerno **ne** scrapa ponovno — inače se stranica i repo raziđu).

### Datoteke u `src/data/` — što se smije dirati

| Datoteka | Ručno uređivati? |
|---|---|
| `hns.json` | **NE** — generira `scripts/scrape.mjs`, CI ga prepisuje svakih 30 min |
| `facebook.json` | **NE** — generira `scripts/scrape-facebook.mjs` |
| `facebook-albums.json` | **NE** — generira `scripts/scrape-facebook-albums.mjs` |
| `friendlies.json` | **DA** — jedini ručni izvor. Format: `friendlies.README.md` |

Prijateljske, memorijali i turniri nisu na HNS Semaforu → unose se u `friendlies.json`.

## Pravila koja se lako prekrše

### 1. Interni linkovi i public asseti idu kroz `url()`

Astro **ne** prependa `base` na `<a href>`, `<img src>`, `<link href>`.

```astro
---
import { url } from "../lib/url";
---
<a href={url("/raspored")}>Raspored</a>
<img src={url("/images/logo.svg")} />
```

Nikad `href="/raspored"` direktno. Vanjske URL-ove (`http`, `mailto`, `tel`, `#`)
`url()` propušta netaknute.

### 2. Utakmice se čitaju iz `lib/matches.ts`, ne iz `hns.json`

`lib/matches.ts` spaja HNS (liga + kup) i `friendlies.json` u jedinstveni
`UnifiedMatch[]`. Izvozi `allMatches`, `upcoming`, `played`, `nextMatch`,
`lastResults()`, `matchBadge()`, `badgeClass`, `todayInZagreb`, te za filtriranje
`typeLabel`, `typeSlug`, `typeOrder` i `countByType()`.

Ako čitaš `hns.matches` direktno, prijateljske utakmice ti nestanu s ekrana.
(Iznimka: `matchDetails`, `table`, `players`, `stats` postoje samo u `hns.json`.)

### 3. Natjecanje je dimenzija, ne jedna vrijednost

Klub istovremeno igra ligu, kup i (kao početnici) U-11 ligu. `hns.json` zato ima
`competitions[]` — svako natjecanje nosi **svoj** `matches`, `table`, `players`
i `stats`, uz `type` (`league`/`cup`) i `ageCategory` (`Seniors`/`Beginners`).

Top-level `matches`, `table`, `players` i `stats` su **objedinjeni pogled samo za
seniore** (U-11 namjerno nije u njima da ne upadne u seniorski raspored i `.ics`).
Za mlađe kategorije koristi `competitionsFor("Beginners")` iz `lib/matches.ts` —
vraća `Competition[]` s već normaliziranim `matches` (`UnifiedMatch[]`) i `table`
(`LeagueRow[]`). Tako radi U-11 sekcija na `/mladje-kategorije`.

`LeagueTable` prima `rows` i `title`; bez njih pada na seniorsku ligu.

Dvije zamke koje su već jednom ugrizle:

- **Tabovi na Semaforu nemaju fiksne indekse.** Liga ima 4 taba, kup nema
  "Ljestvicu" pa se Igrači i Statistika pomaknu za jedan. `resolveTabs()` u
  scraperu ih traži po nazivu — nikad ne hardkodiraj `#tabContent_1_3`.
- **HNS zna objaviti sastav pod kupom, a ligu ostaviti praznu.** Zato je
  `players` unija kroz sva seniorska natjecanja sa zbrojenom statistikom
  (`mergePlayers`), a `perCompetition` čuva razlomljene brojke.
  Ne piši na `/momcad` da statistika dolazi iz lige.

Uvijek `?? []` — natjecanje bez objavljenih podataka vraća prazne nizove.
Isto vrijedi za `matchDetails`: postoji samo za odigrane utakmice koje smo uspjeli
dohvatiti. `/utakmica/[id]` i `/utakmica/[id].png` generiraju se samo za te utakmice.

### 3a. HNS zna duplirati natjecanje usred sezone

Ako klubovi odustanu, HNS otvori **novi cid za istu ligu** i stari ostavi u
dropdownu. Ako se puste oba, svaki protivnik se pojavi dvaput u rasporedu
(dogodilo se u kolovozu 2026.). `pickActiveCompetitions()` zato od ligaških
natjecanja jednog uzrasta zadrži samo označeno (`selected`), a kupove sve.

### 4. Client skripte moraju preživjeti View Transitions

`BaseLayout` uključuje `<ClientRouter />`. Kod navigacije se `<script>` **ne**
izvršava ponovno. Inicijalizaciju veži na `astro:page-load`:

```astro
<script>
  function setup() { /* … */ }
  document.addEventListener("astro:page-load", setup);
</script>
```

Vidi `components/Header.astro` (hamburger meni je već jednom puknuo zbog ovoga).

### 5. Podaci server → client idu kroz JSON script tag

```astro
<script type="application/json" id="ics-data" set:html={JSON.stringify(payload)} />
<script>
  const data = JSON.parse(document.getElementById("ics-data").textContent);
</script>
```

Tako rade `galerija.astro` i `raspored.astro`. Ne koristi `define:vars` osim za
skalare (kao `turnir.astro` sa `SHEET_ID`).

Kad je podataka puno, inline payload nije opcija. Galerija ima 4000+ fotki kroz
18 godina — u HTML ide samo najnovijih 100, a starije godine se dohvaćaju s
`/galerija/{godina}.json` (`pages/galerija/[year].json.ts`) tek kad ih netko
odabere. Prije toga je stranica težila 5,5 MB. Kartice za dohvaćene godine
gradi klon `<template id="card-template">` iz iste datoteke, da markup kartice
ostane na jednom mjestu.

### 5a. Galerija ima dvije veličine slike

Svaka album fotka ima `src` (originalni JPEG do 1600 px) i `thumb`
(WebP 500 px). **Mreža koristi `thumb`, lightbox `src`** — kartica je široka
180-280 CSS px, pa joj original nije trebao (100 fotki: 30 MB → 5 MB).

Thumbove radi `scrape-facebook-albums.mjs` pri svakom scrapeu, a
`npm run thumbs` (`scripts/backfill-thumbs.mjs`) ih može napraviti lokalno bez
FB tokena. `THUMB_WIDTH` i `THUMB_QUALITY` moraju ostati isti u obje skripte.

Uvijek piši `p.thumb || p.src` — fotka bez thumba mora se i dalje prikazati.

Originale NEMOJ konvertirati u WebP iste dimenzije: FB ih je već stisnuo, pa
ušteda je samo ~22 % uz slaganje artefakata, a stari JPEG-ovi svejedno ostaju
u git povijesti.

### 6. Tailwind v4 — nema `tailwind.config.js`

Sve je u `src/styles/global.css`:
- klupske boje i fontovi u `@theme` bloku (`--color-club-*`, `--font-display`, `--font-sans`)
- custom klase preko `@utility` (`container-narrow`, `btn-primary`, `btn-outline`, `hero-bg`)

Koristi postojeće tokene (`bg-club-primary`, `text-club-accent`, …) umjesto hex vrijednosti.
Naslovi `h1–h4` su globalno Oswald + uppercase.

### 7. Hrvatska gramatika

Za brojeve koristi `lib/croatian.ts` (`pluralCroatian`, `golLabel`, `nastupLabel`) —
1 → jednina, 2-4 → paucal, 5+ → množina, uz iznimku 11-14. Ne piši "3 golova".

Ishod utakmice se kratica **P / N / I** (pobjeda, neriješeno, izgubljeno).
Ne "P" za poraz — razlikuje se od pobjede samo bojom, a daltonisti je ne vide.

Datumi i vremena: `toLocaleDateString("hr-HR", …)`, vremenska zona **`Europe/Zagreb`**
(`todayInZagreb` u `lib/matches.ts`). Nikad ne oslanjaj se na lokalnu zonu build servera.

### 8. Konstante

- ID kluba na HNS Semaforu: **134** (`OUR_CLUB_ID`). Za `id === 134` komponente
  renderiraju lokalni `<Logo />` umjesto HNS grba.
- Facebook Page ID: `55401829691`.

## Struktura

```
src/
├── layouts/BaseLayout.astro   # <head>: SEO, OG, favicons, manifest, RSS, ClientRouter, Umami
├── pages/                     # 1 datoteka = 1 ruta
│   ├── index klub povijest momcad mladje-kategorije sponzori novosti galerija raspored turnir 404
│   ├── igrac/[id].astro       # profil igrača (getStaticPaths iz hns.players)
│   ├── utakmica/[id].astro    # detalj utakmice (postave, događaji, suci)
│   ├── utakmica/[id].png.ts   # dinamička OG slika (satori + resvg), cache u .cache/og
│   ├── rss.xml.ts             # RSS iz FB postova
│   ├── raspored.ics.ts        # cijeli raspored kao kalendar za pretplatu (webcal://)
│   └── manifest.webmanifest.ts# PWA manifest (endpoint, da poštuje base path)
├── components/                # Header, Footer, Hero, MatchDayHero, LeagueTable,
│                              # NextMatchCard, RecentResults, PlayerCard, StaffCard,
│                              # MatchLineup, MatchEventsList, StatRanking, FacebookPost,
│                              # LatestPostBlock, InstallPrompt, Logo, SchemaSportsTeam
├── lib/                       # url.ts · matches.ts · croatian.ts · facebook.ts
├── data/                      # vidi tablicu gore
├── assets/                    # fontovi (za OG slike) + logotipi sponzora (Astro <Image>)
└── styles/global.css

scripts/    scrape.mjs · scrape-facebook.mjs · scrape-facebook-albums.mjs
public/     CNAME, favicons/ikone, images/ (logo.svg, og-image.png, facebook/, facebook-albums/)
```

Nova stranica → dodaj i u `navItems` u `components/Header.astro` te u `serialize()`
prioritete u `astro.config.mjs` (sitemap) ako joj treba drukčiji prioritet.

## Deploy i git

- **Svaki push u `main` deploya stranicu uživo.** Radi na branchu i otvori PR osim ako
  korisnik izričito traži direktan push.
- Commit poruke: hrvatski, `scope: opis` ili conventional prefix.
  Primjeri iz povijesti: `feat(seo): dinamičke OG slike po utakmici`,
  `fix(header): hamburger meni radi nakon view transitions`,
  `galerija: filter po godini kao padajući izbornik`,
  `ci: build više ne scrapa ponovo, gradi commitane podatke`.
- **Ne commitaj velike binarne datoteke.** `public/images/` je već ~519 MB (FB arhiva),
  `.git` ~517 MB. Slike u galeriju dolaze isključivo kroz FB scraper.
- Historija je 95 % `chore(data): update scrape …` botovskih commitova — za pregled
  ljudskih promjena: `git log --oneline --author=Patrik`.

## Vanjske ovisnosti i tajne

| Što | Gdje | Napomena |
|---|---|---|
| HNS Semafor | `scripts/scrape.mjs` | Bez autentikacije. Zna vraćati Cloudflare 52x → scraper ima retry i graceful skip |
| Facebook Graph API | oba FB scrapera | Treba `FB_PAGE_ID` + `FB_ACCESS_TOKEN` (GitHub Secrets). Bez njih scraper ne ruši build |
| Google Sheets | `pages/turnir.astro` | gviz endpoint, fetch iz browsera, sheet mora biti javno čitljiv |
| Umami analytics | `BaseLayout.astro` | `cloud.umami.is`, website id hardkodiran |
| Google Fonts | `BaseLayout.astro` | Inter + Oswald |

Lokalni scrape FB-a bez tokena je bezopasan — skripte samo zadrže postojeće podatke.

## Česte greške

- Zaboravljen `url()` → linkovi pucaju ako se ikad promijeni `base`.
- Čitanje `hns.matches` umjesto `lib/matches` → nestanu prijateljske.
- Hardkodiran `#tabContent_1_N` → kup se tiho parsira krivo.
- `element.hidden` za skrivanje kartica s Tailwind `block` klasom → ne radi
  (preflight `[hidden]` je u `:where()`, klasa pobjeđuje). Koristi `style.display`.
- `npm run build` umjesto `npx astro build` → nepotreban scrape i prljav git status.
- Skripta bez `astro:page-load` → radi na reload, puca na navigaciju.
- Ručna izmjena `hns.json` / `facebook*.json` → CI je prepiše za max 30 minuta.
