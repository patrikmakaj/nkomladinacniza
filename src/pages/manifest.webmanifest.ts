/**
 * Web App Manifest — omogućuje "Dodaj na početni zaslon" na mobitelu.
 *
 * Generira se kao endpoint (a ne statička datoteka u public/) da bi putanje
 * do ikona poštovale Astro `base`, isto kao i ostatak stranice.
 */
import type { APIRoute } from "astro";
import { url } from "../lib/url";

export const GET: APIRoute = () => {
  const manifest = {
    name: "NK Omladinac Niza",
    short_name: "Omladinac",
    description:
      "Rezultati, raspored, tablica i novosti NK Omladinac Niza — nogometnog kluba iz Nize, Općina Koška.",
    lang: "hr",
    dir: "ltr",
    start_url: url("/"),
    scope: url("/"),
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#0f2c6e",
    categories: ["sports", "news"],
    icons: [
      {
        src: url("/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: url("/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Android obrezuje ikonu u krug/squircle — ova ima punu podlogu
        // i grb unutar sigurne zone, pa se rubovi nemaju što odsjeći.
        src: url("/icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Raspored",
        short_name: "Raspored",
        url: url("/raspored"),
      },
      {
        name: "Novosti",
        short_name: "Novosti",
        url: url("/novosti"),
      },
      {
        name: "Tablica",
        short_name: "Tablica",
        url: url("/"),
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
};
