// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

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
  vite: {
    plugins: [tailwindcss()],
  },
});
