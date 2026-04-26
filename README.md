# NK Omladinac Niža — službena web stranica

Statička web stranica za nogometni klub NK Omladinac Niža.
Stack: **[Astro](https://astro.build)** + **[Tailwind CSS v4](https://tailwindcss.com)** + TypeScript.

## Pokretanje lokalno

Trebaš Node.js 20 ili noviji. (Na ovom Mac-u node je instaliran preko Homebrew-a u `/opt/homebrew/bin/node`.)

```bash
npm install     # samo prvi put
npm run dev     # otvori http://localhost:4321
```

## Komande

| Komanda | Što radi |
|---|---|
| `npm run dev` | pokreće dev server s hot reload-om na portu 4321 |
| `npm run build` | gradi produkcijski build u `dist/` |
| `npm run preview` | pokreće lokalni preview produkcijskog builda |

## Struktura

```
src/
├── components/      # reusable komponente (Header, Footer, kartice, tablica...)
├── layouts/         # BaseLayout — HTML shell s headerom/footerom
├── pages/           # jedna .astro datoteka = jedna ruta
│   ├── index.astro             → /
│   ├── momcad.astro            → /momcad
│   ├── mladje-kategorije.astro → /mladje-kategorije
│   ├── galerija.astro          → /galerija
│   ├── klub.astro              → /klub
│   └── povijest.astro          → /povijest
└── styles/
    └── global.css   # Tailwind + custom utility klase i klubske boje
```

Slike i statički assets idu u `public/` (npr. `/public/images/players/ivan-horvat.jpg` → `/images/players/ivan-horvat.jpg`).

## Dodavanje sadržaja

### Igrač
Otvori `src/pages/momcad.astro` i dodaj objekt u `players` array:
```ts
{ number: 23, name: "Novi Igrač", position: "Vezni", positionGroup: "MID" }
```
`positionGroup` mora biti jedan od: `GK`, `DEF`, `MID`, `FWD`.

### Sljedeća utakmica
Edituj mock objekt u `src/components/NextMatchCard.astro`.

### Tablica lige
Edituj `fullTable` array u `src/components/LeagueTable.astro`.
Naš red treba imati `isUs: true` flag.

### Rezultati
Edituj `allResults` array u `src/components/RecentResults.astro`.
`isUs` polje označava je li klub bio domaćin (`"home"`) ili gost (`"away"`).

### Mlađe kategorije, povijest, klub
Sve je inline u dotičnim `.astro` datotekama u `src/pages/`.

### Slika u galeriji
Stavi sliku u `public/images/gallery/` i edituj `photos` array u `src/pages/galerija.astro`. Trenutno koristi placeholder gradijente.

## Boje kluba

Definirane su kao CSS varijable u `src/styles/global.css` u `@theme` bloku. Trenutno su placeholder (crvena #C8102E + crna + zlatna). Kad dobijemo prave klupske boje, mijenjamo:
```css
--color-club-primary: #...;
--color-club-secondary: #...;
--color-club-accent: #...;
```

Korištenje u Tailwind-u: `bg-[--color-club-primary]`, `text-[--color-club-secondary]`...

## Sljedeći koraci (van trenutnog scope-a)

- Pravi grb kluba u `public/favicon.svg` i `public/images/logo.svg`
- Prave klupske boje
- Hero slike (momčad, stadion) u `public/images/hero.jpg`
- Stvarne fotke u galeriji (`public/images/gallery/`)
- Stvarni popis igrača s fotografijama
- Tekst povijesti, vodstvo, kontakt
- Google Maps embed za stadion (`src/pages/klub.astro`)
- GitHub Action za automatski deploy na GitHub Pages (`.github/workflows/deploy.yml`)
- GitHub Action scraper za tablicu/rezultate sa ŽNS-a → JSON commit → static rebuild
- Setup vlastite domene `nkomladinacniza.hr`
