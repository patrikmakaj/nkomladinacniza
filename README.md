# NK Omladinac Niza

Službena web stranica nogometnog kluba **NK Omladinac Niza** (Niza, Općina Koška).

Stack: [Astro](https://astro.build) · [Tailwind CSS v4](https://tailwindcss.com) · TypeScript.
Hosting: GitHub Pages.
Izvor podataka uživo: [HNS Semafor](https://semafor.hns.family/klubovi/134/nk-omladinac-niza/).

## Pokretanje lokalno

Zahtjev: **Node.js 22.12+**.

```bash
npm install
npm run dev    # http://localhost:4321
```

## Skripte

| Komanda | Što radi |
|---|---|
| `npm run dev` | Dev server s hot reload-om |
| `npm run scrape:hns` | Dohvati svježe podatke s HNS Semafora u `src/data/hns.json` |
| `npm run scrape:facebook` | Dohvati zadnje FB postove u `src/data/facebook.json` (treba env varijable) |
| `npm run scrape:fb-albums` | Dohvati FB albume i fotke za galeriju (treba env varijable) |
| `npm run scrape` | Pokrene sva tri scraper-a |
| `npm run build` | Produkcijski build u `dist/` (automatski prvo scrape-a) |
| `npx astro build` | Build **bez** scrape-a — ovo koristi za brzu provjeru da kod radi |
| `npm run preview` | Lokalni preview produkcijskog builda |

## Struktura

```
src/
├── assets/                     # Fontovi (za OG slike) + logotipi sponzora (Astro <Image>)
├── components/                 # Reusable komponente (Header, Footer, kartice, tablica…)
├── data/
│   ├── hns.json                # Auto-generirani snapshot HNS podataka (commit-an)
│   ├── facebook.json           # Auto-generirani FB postovi (commit-an)
│   ├── facebook-albums.json    # Auto-generirani FB albumi za galeriju (commit-an)
│   ├── friendlies.json         # RUČNI unos prijateljskih utakmica
│   └── friendlies.README.md    # Upute za unos prijateljskih
├── layouts/
│   └── BaseLayout.astro        # <head>: SEO, OG, favicons, manifest, RSS, View Transitions
├── lib/
│   ├── url.ts                  # Helper za base path (GH Pages)
│   ├── matches.ts              # Objedinjene utakmice: liga + kup + prijateljske
│   ├── croatian.ts             # Sklanjanje brojeva (1 gol / 2 gola / 5 golova)
│   └── facebook.ts             # Linkify i formatiranje datuma za FB postove
├── pages/                      # Jedna datoteka = jedna ruta
│   ├── *.astro                 # Statične stranice (index, klub, momcad, raspored…)
│   ├── igrac/[id].astro        # Profil igrača
│   ├── utakmica/[id].astro     # Detalj utakmice (postave, događaji, suci)
│   ├── utakmica/[id].png.ts    # Dinamička OG slika po utakmici (satori + resvg)
│   ├── rss.xml.ts              # RSS feed novosti
│   ├── raspored.ics.ts         # Raspored kao kalendar za pretplatu
│   └── manifest.webmanifest.ts # PWA manifest
└── styles/
    └── global.css              # Tailwind v4 @theme (klupske boje/fontovi) + @utility klase

scripts/
├── scrape.mjs                  # Cheerio scraper koji parsira HNS HTML
├── scrape-facebook.mjs         # FB postovi preko Graph API-ja
└── scrape-facebook-albums.mjs  # FB albumi i fotke za galeriju

public/images/                  # Logo, OG slika, skinute FB fotke i statički assets

.github/workflows/
└── scrape-and-deploy.yml       # Cron svakih 30 min + auto deploy
```

Detaljne upute za rad na kodu (konvencije, zamke, što se smije ručno dirati) su u
[`CLAUDE.md`](./CLAUDE.md).

## Kako se ažuriraju podaci

Postoje **tri automatska izvora** i **jedan ručni**:

### 1. HNS Semafor (sportski podaci)
Scraper `scripts/scrape.mjs` parsira [stranicu kluba na HNS Semaforu](https://semafor.hns.family/klubovi/134/nk-omladinac-niza/) i izvlači:
- Klub: ime, stadion, adresa, grb
- Trenutno natjecanje i sezona
- Cijela tablica lige (sa grbovima i formom)
- Sve utakmice sezone iz **svih natjecanja** (liga + kup) — raspored i rezultati
- Detalji odigranih utakmica: postave, golovi i kartoni, suci, gledatelji
- Igrači (slike, brojevi, pozicije, statistike nastupa)
- Ranking liste: strijelci, kartoni, najveći broj nastupa

Scrapea **sva natjecanja u kojima klub nastupa**, po uzrastu (seniori + početnici U-11).
Popis natjecanja dolazi kroz Semaforov `getCompetitions` handler jer se uzrast ne može
prebaciti URL parametrom.

Output: `src/data/hns.json` (commit-an u repo) — `competitions[]` s podacima po
natjecanju, plus objedinjeni seniorski pogled u top-level ključevima.

> HNS zna objaviti sastav samo pod jednim natjecanjem (npr. pod kupom, dok je
> ligaški roster prazan), pa se roster i statistika zbrajaju kroz sva seniorska
> natjecanja. Prazni nizovi na početku sezone su normalni — nije greška u scraperu.

### 2. Facebook (novosti i objave)
Scraper `scripts/scrape-facebook.mjs` koristi Graph API v21.0 za dohvat zadnjih objava sa [@omladinacniza](https://www.facebook.com/omladinacniza/) FB stranice. Slike se skidaju lokalno u `public/images/facebook/` (jer FB CDN URL-ovi ekspirira za 1-2 tjedna).

Output: `src/data/facebook.json` + slike u `public/images/facebook/`.

Treba dva GitHub Secrets za rad:
- `FB_PAGE_ID` — Facebook Page ID
- `FB_ACCESS_TOKEN` — Long-lived Page Access Token (admin pristup stranici)

Generiranje tokena: vidi [Facebook Pages API docs](https://developers.facebook.com/docs/pages-api/getting-started). Za vlastiti page admin nije potreban app review.

### 3. Facebook albumi (galerija)
Scraper `scripts/scrape-facebook-albums.mjs` dohvaća **sve** albume stranice i metapodatke fotki, pa primijeni kvotu po kalendarskoj godini (`FB_PHOTOS_PER_YEAR`, default 200) da repo ne naraste bez kontrole. Već skinute fotke ostaju u galeriji i kad ispadnu iz kvote — arhiva raste, git povijest se ne prepisuje. Profilne i naslovne slike se preskaču.

Koristi iste `FB_PAGE_ID` i `FB_ACCESS_TOKEN` secrets.

Output: `src/data/facebook-albums.json` + slike u `public/images/facebook-albums/`.

### 4. Prijateljske utakmice (ručno)
Utakmice kojih nema na HNS Semaforu — prijateljske, memorijali, turniri — unose se ručno u `src/data/friendlies.json`. Format i upute (može se editirati direktno s mobitela preko GitHuba) su u [`src/data/friendlies.README.md`](./src/data/friendlies.README.md).

Ovo je **jedina** datoteka u `src/data/` koja se smije ručno mijenjati — ostale tri scraperi prepisuju svakih 30 minuta.

### GitHub Action workflow
`scrape-and-deploy.yml` se okida:
- **svakih 30 minuta** preko cron rasporeda
- na **svaki push u `main`**
- ručno preko **Actions → Run workflow**

Pokrene sva tri scrapera, commita promjene (JSON-ove i nove FB slike), pa rebuilda i deploya.

Build job namjerno **ne** scrapa ponovo — gradi točno ono što je scrape job commitao, da se objavljena stranica i sadržaj repoa ne raziđu. Na cron pokretanju deploy ide samo ako su se podaci stvarno promijenili.

## Dodavanje sadržaja

### Mlađe kategorije, povijest, info o klubu
Statički sadržaj - edituj odgovarajuću `.astro` datoteku u `src/pages/`.

### Slike u galeriji
Galerija se puni **isključivo** iz Facebook albuma — objavi fotke na FB stranicu kluba i scraper ih pokupi kroz max 30 minuta. Ništa se ne dodaje ručno u repo.

### Prijateljske utakmice i rezultati
Uredi `src/data/friendlies.json` — vidi [upute](./src/data/friendlies.README.md).

### Raspored i ljestvica U11
Ništa se ne unosi ručno — scraper dohvaća natjecanje početnika s HNS Semafora, a
`/mladje-kategorije` prikazuje sljedeće utakmice, odigrane rezultate i ljestvicu.
Sekcija se sama sakrije dok HNS nema ništa objavljeno.

### Klupske boje
Definirane su kao CSS varijable u `src/styles/global.css` u `@theme` bloku.

## Deploy

GitHub Pages, uključen u `Settings → Pages → Source: GitHub Actions`.

Stranica je uživo na **[omladinacniza.hr](https://omladinacniza.hr)**. Domena je konfigurirana kroz `public/CNAME` (deSEC DNS), a `SITE` i `BASE` se postavljaju u `astro.config.mjs` (mogu se pregaziti env varijablama `ASTRO_SITE` i `ASTRO_BASE`).

## Licenca

Sav sadržaj kluba (logo, fotografije, povijest) vlasništvo je NK Omladinca Niza. Kod je dostupan slobodno za inspiraciju drugim klubovima.
