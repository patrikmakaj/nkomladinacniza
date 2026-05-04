import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import facebook from "../data/facebook.json";

type Post = {
  id: string;
  message: string;
  createdAt: string;
  permalink: string | null;
  images: string[];
};

function firstLine(message: string): string {
  const trimmed = (message || "").trim();
  if (!trimmed) return "(bez teksta)";
  const firstParagraph = trimmed.split(/\n+/)[0];
  return firstParagraph.length > 100
    ? firstParagraph.slice(0, 97).trimEnd() + "…"
    : firstParagraph;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET(context: APIContext) {
  const enabled = facebook.enabled !== false;
  const posts = (enabled ? (facebook.posts ?? []) : []) as Post[];
  const site = context.site?.toString() ?? "https://omladinacniza.hr/";

  return rss({
    title: "NK Omladinac Niza · Novosti",
    description:
      "Najnovije objave NK Omladinac Niza — utakmice, izjave i fotografije.",
    site,
    items: posts.slice(0, 25).map((p) => {
      const text = (p.message || "").trim();
      const imagesHtml = (p.images || [])
        .map((src) => {
          // Apsolutni URL ako je relativan (počinje s /)
          const absUrl = src.startsWith("/")
            ? new URL(src, site).toString()
            : src;
          return `<p><img src="${escapeXml(absUrl)}" alt=""/></p>`;
        })
        .join("");
      const textHtml = text
        ? `<p>${escapeXml(text).replace(/\n+/g, "</p><p>")}</p>`
        : "";

      return {
        title: firstLine(text),
        link: p.permalink ?? site,
        pubDate: new Date(p.createdAt),
        description: text.slice(0, 280),
        content: textHtml + imagesHtml,
      };
    }),
    customData: "<language>hr-HR</language>",
  });
}
