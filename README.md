# NK Omladinac Niza

Službena web stranica nogometnog kluba **NK Omladinac Niza** (Niza, Općina Koška).

Stack: [Astro](https://astro.build) · [Tailwind CSS v4](https://tailwindcss.com) · TypeScript.
Hosting: GitHub Pages.
Izvor podataka uživo: [HNS Semafor](https://semafor.hns.family/klubovi/134/nk-omladinac-niza/).

## Pokretanje lokalno

Zahtjev: **Node.js 20+**.

```bash
npm install
npm run dev    # http://localhost:4321
```

## Skripte

| Komanda | Što radi |
|---|---|
| `npm run dev` | Dev server s hot reload-om |
| `npm run scrape` | Dohvati svježe podatke s HNS Semafora u `src/data/hns.json` |
| `npm run build` | Produkcijski build u `dist/` (automatski prvo scrape-a) |
| `npm run preview` | Lokalni preview produkcijskog builda |

## Struktura

```
src/
├── components/    # Reusable komponente (Header, Footer, kartice, tablica…)
├── data/
│   └── hns.json   # Auto-generirani snapshot HNS podataka (commit-an u repo)
├── layouts/
│   └── BaseLayout.astro
├── lib/
│   └── url.ts     # Helper za base path (GH Pages)
├── pages/         # Jedna .astro datoteka = jedna ruta
└── styles/
    └── global.css # Tailwind direktive + custom utility klase + klupske boje

scripts/
└── scrape.mjs     # Cheerio scraper koji parsira HNS HTML

public/images/     # Logo, fotografije i statički assets

.github/workflows/
└── scrape-and-deploy.yml   # Cron svakih 30 min + auto deploy
```

## Kako se ažuriraju podaci

GitHub Action (`scrape-and-deploy.yml`) se okida:
- **svakih 30 minuta** preko cron rasporeda
- na **svaki push u `main`**
- ručno preko **Actions → Run workflow**

Action pokreće `npm run scrape` koji parsira HNS Semafor stranicu kluba i sprema strukturiran JSON. Ako se podaci razlikuju od posljednjeg snapshot-a → commit + rebuild + deploy.

Što se izvlači:
- Klub: ime, stadion, adresa, grb
- Trenutno natjecanje i sezona
- Cijela tablica lige (sa grbovima i formom)
- Sve utakmice sezone (raspored + rezultati)
- Igrači (slike, brojevi, pozicije, statistike nastupa)
- Ranking liste: strijelci, kartoni, najveći broj nastupa

## Dodavanje sadržaja

### Mlađe kategorije, povijest, info o klubu
Statički sadržaj - edituj odgovarajuću `.astro` datoteku u `src/pages/`.

### Slike u galeriji
Stavi sliku u `public/images/gallery/` i edituj `photos` array u `src/pages/galerija.astro`.

### Klupske boje
Definirane su kao CSS varijable u `src/styles/global.css` u `@theme` bloku.

## Deploy

Na GitHub Pages je uključen u `Settings → Pages → Source: GitHub Actions`. URL: `https://patrikmakaj.github.io/nkomladinacniza/`.

Custom domena (kad bude): dodaj `public/CNAME` s jednim retkom (npr. `nkomladinacniza.hr`) i u `astro.config.mjs` promijeni `SITE` i `BASE`.

## Licenca

Sav sadržaj kluba (logo, fotografije, povijest) vlasništvo je NK Omladinca Niza. Kod je dostupan slobodno za inspiraciju drugim klubovima.
