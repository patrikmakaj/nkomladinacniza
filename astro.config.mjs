// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { EnumChangefreq } from "sitemap";

// Custom domena omladinacniza.hr (preko deSEC DNS-a) → GitHub Pages
// public/CNAME drži vrijednost koja konfigurira GitHub Pages
const SITE = process.env.ASTRO_SITE || "https://omladinacniza.hr";
const BASE = process.env.ASTRO_BASE || "/";

/**
 * Kad su podaci zadnji put scrapeani — koristi se za pošten `lastmod`.
 * @param {string} file putanja do JSON-a, relativno na ovaj config
 * @returns {Date | null}
 */
function lastUpdatedOf(file) {
  try {
    const raw = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
    const d = new Date(raw.lastUpdated);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const hnsUpdated = lastUpdatedOf("./src/data/hns.json");
const facebookUpdated = lastUpdatedOf("./src/data/facebook.json");

// Stranice bez svojih podataka mijenjaju se samo kad ih netko uredi, pa im
// `lastmod` namjerno ne postavljamo — lažni datum na svakom buildu (a build
// ide svakih 30 min) nauči tražilice da polje ignoriraju.
// (mladje-kategorije NIJE ovdje — prikazuje raspored i ljestvicu U-11.)
const STATIC_PAGES = /\/(klub|povijest|sponzori)\/?$/;

/** Apsolutni URL naslovnice, bez dvostrukih kosih crta. */
const HOMEPAGE_URL = new URL(BASE, SITE).href;

// Turniri su jednokratni događaji, nisu u navigaciji i ne želimo ih u indeksu.
// Stranice i dalje rade na direktan link. Prefiks hvata i /turnir/penali i
// svaki idući turnir, pa se ovdje ne treba ništa dopisivati.
const EXCLUDED_PREFIXES = ["/turnir"];

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "ignore",
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, "");
        return !EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
      },
      // SEO config: sve stranice imaju sličnu važnost,
      // priority malo veća za /
      changefreq: EnumChangefreq.DAILY,
      priority: 0.7,
      serialize(item) {
        if (item.url === HOMEPAGE_URL) {
          item.priority = 1.0;
          item.changefreq = EnumChangefreq.DAILY;
        } else if (item.url.includes("/novosti")) {
          item.priority = 0.9;
          item.changefreq = EnumChangefreq.HOURLY;
        } else if (item.url.includes("/raspored")) {
          // Raspored se mijenja kako se odigravaju utakmice
          item.priority = 0.9;
          item.changefreq = EnumChangefreq.DAILY;
        } else if (
          item.url.includes("/momcad") ||
          item.url.includes("/mladje-kategorije")
        ) {
          item.priority = 0.8;
          item.changefreq = EnumChangefreq.DAILY;
        } else {
          // klub, povijest, galerija - statički sadržaj, mijenja se rijetko
          item.priority = 0.6;
          item.changefreq = EnumChangefreq.MONTHLY;
        }

        // `lastmod` samo tamo gdje ga stvarno možemo potkrijepiti izvorom.
        const fromFacebook =
          item.url.includes("/novosti") || item.url.includes("/galerija");
        const updated = fromFacebook ? facebookUpdated : hnsUpdated;
        if (!STATIC_PAGES.test(item.url) && updated) {
          item.lastmod = updated.toISOString();
        } else {
          delete item.lastmod;
        }

        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
