/**
 * Helper-i za render FB postova.
 *
 * - linkify: pretvara URL-ove i hashtag-ove u clickable HTML linkove,
 *   uz HTML escape svega ostalog (siguran za `set:html`).
 * - formatDate: hrvatski friendly format datuma.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/**
 * Tokeniziraj input u (TEXT | URL | HASHTAG) komade pa renderiraj kao HTML.
 * Svaki tekstualni dio ide kroz HTML escape; URL-ovi/hashtag-ovi postaju anchor-ovi.
 */
export function linkify(text: string): string {
  if (!text) return "";

  // Regex koji hvata URL ILI hashtag. Globalni za split-style obradu.
  const pattern = /(https?:\/\/[^\s<>"]+)|(#[\p{L}\p{N}_]+)/gu;

  let lastIndex = 0;
  let html = "";

  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0;

    // Tekst prije match-a → escape + newline → <br>
    if (idx > lastIndex) {
      const chunk = text.slice(lastIndex, idx);
      html += escapeHtml(chunk).replace(/\n/g, "<br>");
    }

    if (match[1]) {
      // URL
      const url = match[1];
      const href = escapeHtml(url);
      // Skidaj trailing interpunkciju iz prikaznog teksta ako je to logičan kraj rečenice
      let display = url;
      const trailing = display.match(/[.,!?)]+$/);
      let trailText = "";
      if (trailing) {
        trailText = trailing[0];
        display = display.slice(0, -trailText.length);
      }
      html +=
        `<a href="${escapeHtml(display)}" target="_blank" rel="noopener noreferrer" ` +
        `class="text-club-primary hover:underline">${escapeHtml(display)}</a>`;
      if (trailText) html += escapeHtml(trailText);
    } else if (match[2]) {
      // Hashtag → samo styled span (ne klikabilan jer ne vodimo internu pretragu)
      html += `<span class="text-club-primary font-medium">${escapeHtml(match[2])}</span>`;
    }

    lastIndex = idx + match[0].length;
  }

  // Ostatak teksta nakon zadnjeg match-a
  if (lastIndex < text.length) {
    html += escapeHtml(text.slice(lastIndex)).replace(/\n/g, "<br>");
  }

  return html;
}

/** "26. travnja 2026. u 14:30" iz ISO stringa */
export function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("hr-HR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("hr-HR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} u ${time}`;
}

/** "prije 3 dana", "prije 2 sata", "upravo" - relative time */
export function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diffMs = Date.now() - d;
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMin / 60);
  const diffD = Math.round(diffH / 24);

  if (diffMin < 1) return "upravo";
  if (diffMin < 60) return `prije ${diffMin} min`;
  if (diffH < 24) return `prije ${diffH} ${diffH === 1 ? "sat" : diffH < 5 ? "sata" : "sati"}`;
  if (diffD < 30) return `prije ${diffD} ${diffD === 1 ? "dan" : "dana"}`;
  return formatPostDate(iso);
}
