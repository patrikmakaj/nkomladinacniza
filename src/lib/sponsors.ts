/**
 * Sponzori kluba — jedan popis za /sponzori i traku sponzora u podnožju
 * svake stranice (SponsorStrip). Novi sponzor se dodaje samo ovdje.
 *
 * Logotipi su u src/assets/sponzori/ — Astro iz njih radi WebP/AVIF varijante.
 */
export type Sponsor = {
  name: string;
  logo?: string;
  url?: string;
  textOnly?: boolean;
  /** Fotografija (osoba, OPG) umjesto logotipa — puni pločicu, ne stoji u sredini. */
  photo?: boolean;
  /** Svijetli logotip (npr. zlatni natpis) — treba tamnu podlogu da se vidi. */
  dark?: boolean;
};

const logoImports = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/sponzori/*.{jpg,jpeg,png}",
  { eager: true },
);

export function getLogo(filename: string): ImageMetadata | null {
  const match = Object.entries(logoImports).find(([path]) => path.endsWith(`/${filename}`));
  return match ? match[1].default : null;
}

/** Prvi je glavni pokrovitelj — veća kartica iznad ostalih. */
export const sponsors: Sponsor[] = [
  { name: "Općina Koška", logo: "opcinakoska.png", url: "https://www.koska.hr/" },
  { name: "HANA d.o.o.", logo: "hanadoo.jpg", url: "https://hana.hr/" },
  { name: "NEXE d.d.", logo: "nexedd.png", url: "https://www.nexe.hr/" },
  { name: "GRADITELJSTVO NOA j.d.o.o.", logo: "graditeljstvonoa.jpg", url: "https://www.facebook.com/graditeljstvonoa/?locale=hr_HR" },
  { name: "PATERNA d.o.o.", logo: "paternadoo.png", url: "https://webshop.paterna.hr/" },
  { name: "JERKOVIĆ d.o.o. Koška", logo: "jerkovic.png", url: "https://www.jerkovic.hr/" },
  { name: "Nogometno središte Našice", logo: "nsnasice.jpeg", url: "https://nsnasice.blogspot.com/" },
  { name: "OPG Radaković Nedeljko", logo: "nedeljkoradakovic.jpg", url: "https://www.facebook.com/nedeljko.radakovic", photo: true },
  { name: "Branimir Petranović - Maka", logo: "branimirpetranovicmaka.jpg", url: "https://www.facebook.com/branimir.petranovicmaka", photo: true },
  { name: "Osječka pivovara", logo: "osjeckapivovara.png", url: "https://pivovara.hr/", dark: true },
  { name: "ĆOSO POSO", textOnly: true },
  { name: "Pro-mont", textOnly: true },
  { name: "IZOLACIJA-KOŠKA d.o.o.", textOnly: true, url: "https://www.izolacija.hr/" },
  { name: "VODOVOD-HIDROGEOLOŠKI RADOVI d.o.o.", textOnly: true, url: "https://hgr.hr/" },
  { name: "Tunja Tomić", textOnly: true },
];

/** Sponzor bez logotipa: ime kao natpis, bez pravnog oblika ("d.o.o."). */
export const wordmark = (name: string) =>
  name
    .replace(/\s+(d\.o\.o\.|d\.d\.|j\.d\.o\.o\.)$/i, "")
    .replace(/-/g, " ")
    .toUpperCase();
