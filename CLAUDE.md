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
npm run scrape:images      # grbovi + fotke seniora s HNS-a → public/images/{clubs,players}/
npm run scrape:friendlies  # Google Sheet → src/data/friendlies.json (samo ako je postavljen SHEET_ID)
node scripts/archive-season.mjs <stari-hns.json>   # ručna arhiva sezone (npr. iz git povijesti)
```

Nema testova ni formattera, ali postoji typecheck:

```bash
npm run check     # astro check — provjerava i .astro frontmatter
```

**Provjera prije commita: `npm run check` i `npx astro build` moraju proći.**
CI vrti oba, `check` prije builda.

## Tok podataka

```
HNS Semafor (klub 134)  ─┐
Facebook Graph API v21   ─┼─► scripts/*.mjs ─► src/data/*.json ─► Astro build ─► dist/ ─► GH Pages
friendlies.json (ručno) ─┘                          (commit-ano u repo)
```

GitHub Action `scrape-and-deploy.yml` vrti se **svakih 30 min** + na svaki push u `main`.
Scrape job commita svježe podatke, build job gradi točno ono što je commitano
(namjerno **ne** scrapa ponovno — inače se stranica i repo raziđu).

**Na dan utakmice svakih 10 min.** Treći cron (`10,20,40,50 * * * *`) dodaje
prolaze između redovnih, ali korak „Traje li utakmica?" (`scripts/match-window.mjs`)
ih pusti dalje samo od početka seniorske utakmice do 3 h poslije, po Zagrebu.
Ostatak vremena job završi u par sekundi bez scrapea i deploya. GitHub cron zna
kasniti 5-15 min, pa je to „brže", ne „uživo".

### Datoteke u `src/data/` — što se smije dirati

| Datoteka | Ručno uređivati? |
|---|---|
| `hns.json` | **NE** — generira `scripts/scrape.mjs`, CI ga osvježava svakih 30 min |
| `facebook.json` | **NE** — generira `scripts/scrape-facebook.mjs` |
| `facebook-albums.json` | **NE** — generira `scripts/scrape-facebook-albums.mjs` |
| `crests.json`, `photos.json` | **NE** — generira `scripts/fetch-images.mjs` (HNS URL slike → lokalna kopija) |
| `sezone/*.json` | **NE** — arhiva sezone; zapiše je scraper pri promjeni sezone (vidi 3b) |
| `friendlies.json` | **DA, dok nije postavljen Google Sheet** — tada ga generira `scripts/scrape-friendlies.mjs` i ručne izmjene se gube. Format i stupci tablice: `friendlies.README.md` |

Prijateljske, memorijali i turniri nisu na HNS Semaforu → unose se u Google tablicu
(`FRIENDLIES_SHEET_ID`) ili, dok je nema, ručno u `friendlies.json`. Scraper
prijateljskih ide prije `fetch-images.mjs`, da se skinu i grbovi novih protivnika.

**Scraperi pišu samo kad se sadržaj promijenio.** Prije su na svakom prolazu
upisivali svjež `lastUpdated`, pa je CI commitao i deployao stranicu svakih 30
minuta bez razloga — od 39 uzastopnih botovskih commitova njih 35 mijenjalo je
samo taj timestamp. Sad ide kroz `writeJsonIfChanged` iz `scripts/lib/write-json.mjs`,
koji uspoređuje sadržaj bez `lastUpdated`. Novi scraper mora koristiti isti helper.

Posljedica: `lastUpdated` znači **zadnja promjena podataka**, ne zadnja provjera.
Zato na stranicama piše „podaci od", a ne „zadnje ažurirano".

**HNS scraper ne prepisuje dobre podatke praznima.** Ako HNS promijeni HTML,
parser ne pukne nego vrati prazne nizove. `findDataLoss`
(`scripts/lib/hns-sanity.mjs`) unutar iste sezone odbije pad utakmica ili
ljestvice na nulu i nečitljivu sezonu: `hns.json` ostaje star, FB scraperi i
deploy nastave, a CI job `upozorenje` pukne pa GitHub pošalje obavijest.
Kad stigne takav mail, problem je u parseru, ne u podacima.

**Deploy na cron ide samo kad su se podaci promijenili** — plus jedan dnevni
build iza ponoći po Zagrebu (`7 23 * * *` UTC), koji uvijek deploya. Sve što
se u buildu računa iz „danas" (`todayInZagreb`, `nextMatch`) zato može biti
staro do jedan dan, a bez dnevnog builda bilo je i više. Ono što ovisi o satu
(dan utakmice, odbrojavanje, istek najave turnira) mora se dodatno provjeriti
u pregledniku: naslovnica renderira po jedan `MatchDayHero` za sljedeću
utakmicu seniora i U-11 (kad je poznato vrijeme početka), a skripta prikaže
onaj čija je utakmica danas u Zagrebu i nije završila prije više od 2,5 h.
Kad obje ekipe igraju isti dan, banner tako ujutro odbrojava do U-11, pa
prijeđe na seniore.

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
`nextYouthMatch`, `lastResults()`, `matchBadge()`, `competitionShort()`,
`badgeClass`, `todayInZagreb`, `daysFromToday()`, te za filtriranje
`typeLabel`, `typeSlug`, `typeOrder` i `countByType()`.

Ako čitaš `hns.matches` direktno, prijateljske utakmice ti nestanu s ekrana.
(Iznimka: `matchDetails`, `table`, `players`, `stats` postoje samo u `hns.json`.)

**Odigrana utakmica se svugdje prikazuje kroz `ResultCard`** — naslovnica,
`/raspored`, profil igrača, U-11 i arhiva sezone. Grb i ime protivnika,
rezultat domaćin:gost, ishod riječju; boja samo na lijevoj traci
(`outcomeStyle`). Naše ime i "doma/gosti" namjerno nisu na kartici. Strijelci
idu kroz `ourScorers()`, datum kroz `shortDate()`. Nemoj raditi novu listu
rezultata sa svojim P/N/I kockama — prije su postojale četiri različite.

HNS zna poslati ime kao „Luka, Glavaš" — svako ime igrača iz HNS-a koje se
prikazuje ide kroz `personName()`.

### 3. Natjecanje je dimenzija, ne jedna vrijednost

Klub istovremeno igra ligu, kup i (kao početnici) U-11 ligu. `hns.json` zato ima
`competitions[]` — svako natjecanje nosi **svoj** `matches`, `table`, `players`
i `stats`, uz `type` (`league`/`cup`) i `ageCategory` (`Seniors`/`Beginners`).

Top-level `matches`, `table`, `players` i `stats` su **objedinjeni pogled samo za
seniore** (U-11 namjerno nije u njima da ne upadne u seniorski raspored i `.ics`).
Za mlađe kategorije koristi `competitionsFor("Beginners")` iz `lib/matches.ts` —
vraća `Competition[]` s već normaliziranim `matches` (`UnifiedMatch[]`), `table`
(`LeagueRow[]`), `players` i `stats`. Tako radi U-11 sekcija na
`/mladje-kategorije`, a `nextYouthMatch` je njihova sljedeća utakmica za
naslovnicu.

Na naslovnici U-11 namjerno ima **samo raspored** (`YouthMatchCard`, i to kad
igraju u idućih 7 dana) — bez rezultata, forme i ljestvice. To ostaje na
`/mladje-kategorije`; niz poraza desetogodišnjaka ne ističemo na naslovnici.

Upis u školu nogometa (`YouthSignup.astro`, pun blok na
`/mladje-kategorije#upis`, traka na naslovnici) drži kontakt, termine i uvjete
na jednom mjestu. Kontakt je WhatsApp/poziv predsjednika DŠA Niza, ne
Facebook — tako je klub htio. Mijenja se samo u toj komponenti.

`players` i `stats` HNS objavi **tek nakon prvih odigranih utakmica** — zato
seniorska liga ima prazne, a kup pune. Sve što ih prikazuje mora se znati
sakriti; koristi `hasStats(comp.stats)`. Kod U-11 se kartoni namjerno ne
prikazuju, a prazna rang-lista se ne renderira. Igrači mlađih kategorija nemaju
`/igrac/[id]` profil (te se rute grade samo iz seniorskog `hns.players`), pa se
linka na njihov `profileUrl` na Semaforu.

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

### 3b. Arhiva sezona

Kad HNS prijeđe na novu sezonu, `hns.json` se prepiše i stara sezona nestane
sa stranice. Scraper zato pri promjeni `competition.season` prvo sažme stari
`hns.json` u `src/data/sezone/<2025-26>.json` (`scripts/lib/season-archive.mjs`:
ljestvica, rezultati sa strijelcima, rang-liste, roster; bez fotki i postava;
samo seniori). Postojeća arhiva se ne prepisuje. `/sezona/[slug]` je prikazuje,
a `/povijest#sezone` ih nabraja (`lib/seasons.ts`).

Sezona 2025/26 (prvaci LIGE NS Našice) spašena je ručno iz git povijesti —
zadnji commit sa starom sezonom bio je `6f7e5b23`. Isto se može za starije:
`git show <commit>:src/data/hns.json > /tmp/x.json && node scripts/archive-season.mjs /tmp/x.json`
(skripta podržava i stari oblik `hns.json` bez `competitions`).

### 3c. Objave s Facebooka uz utakmice

`lib/match-posts.ts` uparuje FB objave s utakmicama bez ručnog označavanja:
izvještaj je prva objava s tekstom u 48 h nakon početka koja spominje
protivnika (s padežnim nastavkom), najava zadnja takva u 7 dana prije, ako
već nije izvještaj druge utakmice. Objava bez imena protivnika se namjerno
ne uparuje. Prikaz: `ClubPost` na `/utakmica/[id]` i `/najava/[id]`.
Ako ikad krivo upari, popravlja se u uzorcima imena
(`opponentPatterns`), ne ručnim iznimkama u stranicama.

### 3d. Plakati za društvene mreže

`lib/poster.ts` crta plakat najave i rezultata u dva formata: `plakat` (4:5,
1080×1350) i `story` (9:16, 1080×1920), kao JPEG kroz `renderImage` iz
`lib/og.ts` (isti cache u `.cache/og`). Rute: `/najava/[id]/{plakat,story}.jpg`
za sve neodigrane i `/utakmica/[id]/{plakat,story}.jpg` za odigrane s detaljima.
Gumbi za preuzimanje su u `PosterDownload` na tim dvjema stranicama.

- Grbovi su lokalne kopije iz `crests.json` (HNS ih daje 100×100 px, pa su
  malo mekši); naš je `logo.svg`. Bez lokalnog grba — krug s početnim slovom.
- Fotke igrača se namjerno ne stavljaju: HNS ih daje 80×100 px.
- Pozadina je `POSTER_BACKGROUND`: zatamnjena fotka Grbavice
  (`src/assets/plakat/grbavica.jpg`, 1080 px, ~170 KB) ili klupske boje.
- Promjena izgleda → podigni `v` u `cacheKey`, inače CI vrati stare iz cachea.

### 4. Client skripte moraju preživjeti View Transitions

`BaseLayout` uključuje `<ClientRouter />`. Kod navigacije se `<script>` **ne**
izvršava ponovno. Inicijalizaciju veži na `astro:page-load`:

```astro
<script>
  function setup() { /* … */ }
  document.addEventListener("astro:page-load", setup);
</script>
```

Vidi `components/Header.astro` (hamburger meni je već jednom puknuo zbog ovoga),
a za interval koji treba ugasiti pri odlasku sa stranice `MatchDayHero.astro`
(`astro:before-swap`). Odbrojavanje se tamo smrzavalo nakon navigacije.

### 5. Podaci server → client idu kroz JSON script tag

```astro
<script type="application/json" id="gallery-data" set:html={JSON.stringify(payload)} />
<script>
  const data = JSON.parse(document.getElementById("gallery-data").textContent);
</script>
```

Tako rade `galerija.astro` i `TurnirLive.astro`. Ne koristi `define:vars` osim za
skalare (kao `turnir.astro` sa `SHEET_ID`).

Kad je podataka puno, inline payload nije opcija. Galerija ima 4000+ fotki kroz
18 godina — u HTML ide samo najnovijih 100, a starije godine se dohvaćaju s
`/galerija/{godina}.json` (`pages/galerija/[year].json.ts`) tek kad ih netko
odabere. Prije toga je stranica težila 5,5 MB. Kartice za dohvaćene godine
gradi klon `<template id="card-template">` iz iste datoteke, da markup kartice
ostane na jednom mjestu.

### 4a. Grbovi i fotke igrača idu kroz `crestSrc()` / `photoSrc()`

`scripts/fetch-images.mjs` (dio `npm run scrape`, odmah iza HNS scrapera)
svaku sliku skine jednom u `public/images/{clubs,players}/<hash URL-a>.<ext>`
i zapiše manifest `crests.json` / `photos.json`. Svaki `<img>` piše
`src={crestSrc(team.logo)}` ili `src={photoSrc(p.photo)}` iz `lib/images.ts` —
vraća lokalnu kopiju kroz `url()`, a slika koja se nije skinula ostaje na HNS
URL-u. Nikad `src={team.logo}` direktno. Za naš klub (`id === 134`) i dalje
`<Logo />`; `TeamCrest.astro` sve to radi sam.

Fotke se skidaju **samo za naše seniore** (`collectSeniorPhotoUrls`). Djeca
(U-11) i igrači protivnika namjerno ostaju na HNS URL-u — kopija u javnom repou
ostala bi u git povijesti i kad je HNS makne. Ne širi to bez dogovora.

### 5a. FB slike imaju dvije veličine i zapisane dimenzije

Svaka Facebook slika — i album fotka i slika uz objavu — ima `src` (original),
`thumb` (WebP) te `width`/`height` **thumba**.

| | thumb | gdje se koristi |
|---|---|---|
| album fotke | 500 px | mreža u `/galerija`; lightbox otvara `src` |
| slike uz objave | 700 px | feed u `/novosti`; klik otvara `src` |

Kartica u mreži je široka 180-280 CSS px, pa joj original od 1600 px nije trebao
(100 fotki: 30 MB → 5 MB; `/novosti`: 2,8 MB → 1,4 MB). `width`/`height` idu na
`<img>` da masonry mreža ne poskakuje dok se slike učitavaju.

Thumbove rade scraperi pri svakom prolazu, a `npm run thumbs`
(`scripts/backfill-thumbs.mjs`) ih napravi lokalno bez FB tokena. Širine su
definirane na oba mjesta i **moraju ostati usklađene**.

Uvijek piši `thumb || src` — slika bez thumba mora se i dalje prikazati.
RSS namjerno koristi `src`, ne thumb.

`post.images` su **objekti**; stariji `facebook.json` ima obične stringove, pa
potrošači imaju `normalizeImage` fallback dok ga CI ne pregazi.

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
│   ├── utakmica/[id].png.ts   # OG slika rezultata (lib/og.ts: satori + resvg, cache u .cache/og)
│   ├── utakmica/[id].ics.ts   # jedna nadolazeća utakmica (seniori + U-11) za "U kalendar"
│   ├── najava/[id].astro      # najava utakmice za dijeljenje; odigrane preusmjeravaju na detalje
│   ├── najava/[id].png.ts     # OG slika najave ("NAJAVA · 18:00 · subota, 3. listopada")
│   ├── najava/[id]/[format].jpg.ts, utakmica/[id]/[format].jpg.ts  # plakati (vidi 3d)
│   ├── sezona/[slug].astro    # arhivirana sezona (src/data/sezone/)
│   ├── rss.xml.ts             # RSS iz FB postova
│   ├── raspored.ics.ts        # cijeli raspored kao kalendar za pretplatu (webcal://)
│   └── manifest.webmanifest.ts# PWA manifest (endpoint, da poštuje base path)
├── components/                # Header, Footer, Hero (veliki samo na naslovnici,
│                              # podstranice `height="md"` = niska traka), MatchDayHero, LeagueTable,
│                              # NextMatchCard (+ usporedba iz ljestvice), YouthMatchCard
│                              # (traka U-11), TeamCrest, FormStrip, MatchActions
│                              # (kalendar · upute · podijeli), SeasonStats, MatchWeather,
│                              # ClubPost (FB izvještaj/najava), YouthSignup (upis),
│                              # ResultCard (odigrana utakmica, svugdje ista),
│                              # UpcomingCard (nadolazeća, + MatchActions),
│                              # PosterDownload (plakat 4:5 / story 9:16),
│                              # RecentResults (+ traka forme), PlayerCard, StaffCard,
│                              # MatchLineup, MatchEventsList, StatRanking, FacebookPost,
│                              # LatestPostBlock, InstallPrompt, Logo, SchemaSportsTeam
├── lib/                       # url.ts · matches.ts · croatian.ts · facebook.ts · images.ts
│                              # venue.ts (igralište, Google Maps, mjesto za prognozu) · ics.ts
│                              # schema.ts · og.ts · match-posts.ts · seasons.ts · poster.ts
├── data/                      # vidi tablicu gore
├── assets/                    # fontovi (za OG slike) + logotipi sponzora (Astro <Image>)
│                              # + plakat/grbavica.jpg (pozadina plakata)
└── styles/global.css

scripts/    scrape.mjs · scrape-friendlies.mjs · fetch-images.mjs · scrape-facebook.mjs
            scrape-facebook-albums.mjs · match-window.mjs (CI: traje li utakmica)
            archive-season.mjs · lib/ (write-json · hns-sanity · season-archive)
public/     CNAME, favicons/ikone, images/ (logo.svg, og-image.png, facebook/, facebook-albums/)
```

Nova stranica → dodaj i u `navItems` u `components/Header.astro` te u `serialize()`
prioritete u `astro.config.mjs` (sitemap) ako joj treba drukčiji prioritet.

### Turniri

Stranice turnira uživo dijele motor: `lib/turnir.ts` (dohvat Sheeta, tablice,
eliminacija, render) + `components/TurnirLive.astro` (markup). Stranica turnira
sadrži samo `TurnirConfig` i pravila u slotu — vidi `pages/turnir.astro`
(boćanje) i `pages/turnir/penali.astro`.

Novi turnir = nova datoteka pod `pages/turnir/`, nova konfiguracija, nova
pravila. Ništa se ne kopira.

Dvije stvari koje se ne smiju izgubiti iz vida:

- **Ždrijeb se NE generira na stranici.** Skripta u pregledniku dala bi svakom
  posjetitelju i svakom refreshu drugačiji raspored. Ždrijeb radi Apps Script u
  samom Sheetu (`scripts/apps-script/zdrijeb.gs`) i zapisuje ga jednom.
  Stranica sama popunjava samo eliminacijske parove, kad grupe završe.
- **Ni satnica se ne pomiče na stranici.** Prvi pokušaj (commit `c029b585`)
  računao je kašnjenje iz sata posjetitelja i bio nepouzdan; zamijenjen je
  ručnim stupcem „Pomak", pa sad time upravlja Apps Script: `onEdit` zapiše
  stvarno vrijeme završetka u stupac `Završeno`, a `pomakniRaspored` preračuna
  neodigrane termine po terenima, uz poštovanje redoslijeda faza.
- **Grupe se izvode iz podataka**, ne hardkodiraju — broj ekipa se zna tek kad
  se zatvore prijave. Automatsko slaganje parova podržano je za:
  1 grupu (tablica je poredak → finale 1-2, meč za 3. mjesto 3-4), 2 grupe
  (odmah polufinale) i 4 grupe (četvrtfinale). Za drugi broj grupa parovi se
  upisuju ručno u Sheet. Bracket ima tri oblika i sam bira po tome što postoji.

`initTurnir` vraća `dispose` koji gasi pollanje Sheeta; komponenta ga zove na
`astro:before-swap`, inače interval nastavi raditi nakon odlaska sa stranice.

**Nagradni fond** je opcionalan: `teamCols.fee` (stupac s kotizacijom) plus
`prizes` (udjeli, npr. `[0.5, 0.3, 0.2]`). Bez njih se ne prikazuje — turnir
može imati pehare umjesto novca. Zadnje mjesto dobiva ostatak umjesto
zaokruženog udjela, da zbroj iznosa uvijek bude točno onoliko koliko je
skupljeno.

### Sitemap i indeksiranje

`astro.config.mjs` postavlja `lastmod` **samo** stranicama koje ga mogu
potkrijepiti izvorom (`hns.lastUpdated` / `facebook.lastUpdated`). Statične
stranice (`klub`, `povijest`, `sponzori`) ga nemaju — build ide svakih 30
minuta, pa bi im `new Date()` na svakoj izgradnji tvrdio da su se promijenile
i tražilice bi polje prestale gledati.

Stranice koje ne smiju u indeks idu u `EXCLUDED_PREFIXES` u configu **i** dobiju
`noIndex` na `BaseLayout`. Prefiks `/turnir` pokriva sve turnire odjednom.

### Fontovi

Inter i Oswald su self-hostani (`src/assets/fonts/*.woff2`, `@font-face` u
`global.css`). Oba su **variable** — jedna datoteka po podskupu pokriva
400-700, zato su samo 4 datoteke. Podskup `latin-ext` je obavezan: bez njega
č, ć, š, ž, đ padaju na fallback font. Ne vraćaj Google Fonts `<link>`.

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
| Umami analytics | `BaseLayout.astro` | `cloud.umami.is`, website id hardkodiran. Klikovi na gumbe se broje atributom `data-umami-event` (+ `data-umami-event-*` za detalje) — bez našeg JS-a |
| Open-Meteo | `MatchWeather.astro` | Prognoza i geokodiranje iz preglednika, bez ključa. Samo utakmice u idućih 7 dana i poznato mjesto; svaka greška = bez prognoze |
| Google Fonts | `BaseLayout.astro` | Inter + Oswald |

Lokalni scrape FB-a bez tokena je bezopasan — skripte zadrže postojeće podatke.
(Do 21.08.2026. nije bilo tako: `scrape-facebook.mjs` je bez tokena pisao prazan
JSON i brisao sve objave. Ako ikad dodaješ novi scraper, put "nema tajni" mora
ići kroz `preserveExisting`, nikad kroz `writeEmpty`.)

## Česte greške

- Zaboravljen `url()` → linkovi pucaju ako se ikad promijeni `base`.
- Čitanje `hns.matches` umjesto `lib/matches` → nestanu prijateljske.
- Hardkodiran `#tabContent_1_N` → kup se tiho parsira krivo.
- `element.hidden` za skrivanje kartica s Tailwind `block` klasom → ne radi
  (preflight `[hidden]` je u `:where()`, klasa pobjeđuje). Koristi `style.display`.
- `npm run build` umjesto `npx astro build` → nepotreban scrape i prljav git status.
- Skripta bez `astro:page-load` → radi na reload, puca na navigaciju.
- Ručna izmjena `hns.json` / `facebook*.json` → CI je prepiše za max 30 minuta.
- `<img src={team.logo}>` bez `crestSrc()` → grb se opet vuče s hns.family.
- Nova OG slika bez `renderOgPng` / `renderImage` iz `lib/og.ts` → generira se na svakom buildu.
