/**
 * Helper za prependanje Astro `base` putanje na interne linkove i public assete.
 *
 * Razlog: Astro NE prependa `base` automatski na <a href="/...">, <img src="/...">,
 * niti na <link href="/favicon...">. Mora se ručno koristiti `url("/path")`.
 *
 * Eksterne URL-ove (http, https, mailto, tel, fragmente #x) ostavlja netaknute.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function url(path: string | undefined | null): string {
  if (!path) return "";
  if (/^(https?:|mailto:|tel:|#)/i.test(path)) return path;
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return BASE + prefixed;
}
