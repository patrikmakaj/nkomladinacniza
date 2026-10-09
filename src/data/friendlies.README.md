# Prijateljske utakmice

Utakmice koje **nisu na HNS Semaforu** (prijateljske, memorijali, turniri) žive u
[`friendlies.json`](./friendlies.json).

## Google Sheet

Izvor je tablica [NK Omladinac Niza - prijateljske utakmice](https://docs.google.com/spreadsheets/d/1OWowTPFOH_Fy7DcW3sqxercGa_Q9JHj_HqBpH39Ox2g/edit)
na Driveu kluba (`FRIENDLIES_SHEET_ID` u `scripts/scrape-friendlies.mjs`).
`friendlies.json` generira scraper pri svakom prolazu (svakih 30 min), pa se
JSON **ne uređuje ručno** — CI bi ga prepisao. Upisuje se u tablicu:

| Datum | Vrijeme | Protivnik | Doma/Gosti | Mjesto | Natjecanje | Naši golovi | Golovi protivnika | Strijelci | HNS ID | Grb |
|---|---|---|---|---|---|---|---|---|---|---|
| 16.8.2026. | 19:00 | NK Mladost Stipanovci | Doma | Niza | Prijateljska utakmica | 0 | 3 | | 133 | |

- Obavezni su samo **Datum**, **Protivnik** i **Doma/Gosti**.
- Golovi idu u **dva stupca** iz naše perspektive (ne "3:1" — Sheets to pretvori u vrijeme).
  Dok se ne odigra, ostave se prazni.
- **Strijelci**: `Denis Ćosić 2, Karlo Grubač` (broj iza imena = koliko golova).
- **HNS ID** je broj iz linka kluba na Semaforu; ako ga upišeš, grb se uzme sam
  kad klub postoji u našim HNS podacima. Inače se link na grb može zalijepiti u **Grb**.
- Redak bez datuma, protivnika ili Doma/Gosti se preskače (vidi se u logu CI-a).
- Tablica mora biti dijeljena kao *Svatko s linkom može pregledavati*.

Ako tablica nije javno čitljiva ili je dohvat ne uspije, `friendlies.json`
ostaje kakav je bio — stranica ne izgubi utakmice.

## Ručni unos (samo ako se tablica isključi)

S `FRIENDLIES_SHEET_ID=""` scraper ne dira JSON, pa se uređuje ručno: na GitHubu
→ ikona olovke → uredi → **Commit changes**.

## Format jedne utakmice

```json
{
  "date": "2026-08-16",
  "time": "17:30",
  "opponent": "NK Mladost Stipanovci",
  "opponentId": 133,
  "opponentLogo": "https://hns.family/files/images_comet/…png",
  "opponentUrl": "https://semafor.hns.family/klubovi/133/nk-mladost-stipanovci/",
  "isHome": true,
  "venue": "Niza",
  "competition": "Prijateljska utakmica",
  "score": { "home": 3, "away": 1 },
  "scorers": [{ "name": "Denis Ćosić", "goals": 2 }]
}
```

| Polje         | Značenje                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `date`        | Datum u formatu `GGGG-MM-DD`                                             |
| `time`        | Vrijeme `"HH:MM"` ili `null` ako još nije poznato — **kad se objavi raspored, samo upiši vrijeme ovdje** |
| `opponent`    | Ime protivnika (običan tekst)                                            |
| `opponentId`  | (opcionalno) ID kluba na HNS Semaforu — broj iz URL-a                    |
| `opponentLogo`| (opcionalno) URL grba — desni klik na grb na Semafor stranici kluba → "Copy image address" |
| `opponentUrl` | (opcionalno) Link na Semafor stranicu kluba                              |
| `isHome`      | `true` = igramo doma (Grbavica), `false` = gostujemo                     |
| `venue`       | Mjesto igranja (npr. `"Niza"`, `"Breznica"`)                             |
| `competition` | Naziv koji se prikazuje (npr. `"Prijateljska utakmica"`, `"Bujdin memorijal"`) |
| `score`       | `null` dok se ne odigra; poslije `{ "home": X, "away": Y }` — **home je uvijek domaćin utakmice**, ne nužno mi! |
| `scorers`     | Naši strijelci — `[]` ako nema/nije odigrano                             |

⚠️ Pazi na zareze između utakmica i navodnike oko teksta — mora ostati ispravan JSON.
Brzo možeš provjeriti lijepljenjem sadržaja na https://jsonlint.com.
