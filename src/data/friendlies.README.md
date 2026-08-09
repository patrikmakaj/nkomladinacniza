# Prijateljske utakmice — ručni unos

Utakmice koje **nisu na HNS Semaforu** (prijateljske, memorijali, turniri) unose se
ručno u [`friendlies.json`](./friendlies.json). Nakon commita stranica se
automatski ponovno buildá i utakmice se pojave na rasporedu i naslovnici.

Najlakše s mobitela: otvori datoteku na GitHubu → ikona olovke → uredi → **Commit changes**.

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
