// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// GitHub Pages konfiguracija
// Dok je sajt na patrikmakaj.github.io/nkomladinacniza/ koristi base "/nkomladinacniza".
// Kad nabaviš domenu nkomladinacniza.hr, promijeni site na "https://nkomladinacniza.hr"
// i base na "/" (i dodaj public/CNAME s domenom).
const SITE = process.env.ASTRO_SITE || "https://patrikmakaj.github.io";
const BASE = process.env.ASTRO_BASE || "/nkomladinacniza";

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "ignore",
  integrations: [
    sitemap({
      // SEO config: sve stranice imaju sličnu važnost,
      // priority malo veća za /
      changefreq: "daily",
      priority: 0.7,
      lastmod: new Date(),
      serialize(item) {
        // Točan match za homepage URL (site + base + trailing slash)
        const homepageUrl = `${SITE}${BASE}/`;
        if (item.url === homepageUrl) {
          item.priority = 1.0;
          item.changefreq = "daily";
        } else if (item.url.includes("/novosti")) {
          item.priority = 0.9;
          item.changefreq = "hourly";
        } else if (
          item.url.includes("/momcad") ||
          item.url.includes("/mladje-kategorije")
        ) {
          item.priority = 0.8;
          item.changefreq = "daily";
        } else {
          // klub, povijest, galerija - statički sadržaj, mijenja se rijetko
          item.priority = 0.6;
          item.changefreq = "monthly";
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
