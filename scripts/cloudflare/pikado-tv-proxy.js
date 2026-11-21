/**
 * Cloudflare Worker — posrednik za TV prikaz pikado turnira (/turnir/pikado/tv).
 *
 * Zašto: Challonge API v2.1 na preflight odgovori s CORS zaglavljima, ali na
 * sam GET ne pošalje `Access-Control-Allow-Origin`, pa preglednik ne smije
 * pročitati odgovor. Ovaj Worker dohvati podatke na serveru i vrati ih s CORS
 * zaglavljem. Tajne (client id/secret) ostaju u Workeru, ne na stranici.
 *
 * Postavljanje (Cloudflare dashboard → Workers & Pages → Create → Worker):
 *   1. zalijepi ovaj kod, Deploy
 *   2. Settings → Variables and Secrets:
 *        CHALLONGE_CLIENT_ID      (Secret)
 *        CHALLONGE_CLIENT_SECRET  (Secret)
 *        TOURNAMENT               (Text) npr. dsanizapikadoturnir2026
 *   3. URL Workera (https://….workers.dev) upiši u src/config/pikado.json → "tvApi"
 *
 * Turnir je fiksan u varijabli, ne u zahtjevu — Worker se ne može koristiti za
 * čitanje drugih turnira. Odgovor se drži 30 s u cacheu, pa ni više otvorenih
 * TV-a ne troši više od ~2 zahtjeva u minuti (limit aplikacije: 500 mjesečno).
 */

let token = null;
let tokenExp = 0;

async function getToken(env) {
  if (token && Date.now() < tokenExp) return token;
  const res = await fetch("https://api.challonge.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.CHALLONGE_CLIENT_ID,
      client_secret: env.CHALLONGE_CLIENT_SECRET,
      scope: "me tournaments:read matches:read participants:read",
    }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const body = await res.json();
  token = body.access_token;
  tokenExp = Date.now() + Math.min(Number(body.expires_in) || 3600, 86_400) * 1000 - 60_000;
  return token;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS });

    const slug = env.TOURNAMENT;
    const cache = caches.default;
    const key = new Request(`https://pikado-tv.cache/${encodeURIComponent(slug)}`);
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "hit" } });

    try {
      const t = await getToken(env);
      const res = await fetch(
        `https://api.challonge.com/v2.1/tournaments/${encodeURIComponent(slug)}.json?include=participants,matches`,
        {
          headers: {
            "Authorization-Type": "v2",
            Authorization: `Bearer ${t}`,
            "Content-Type": "application/vnd.api+json",
            Accept: "application/json",
          },
        },
      );
      if (res.status === 401) token = null;
      const body = await res.text();
      if (!res.ok) return new Response(body, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=30" } })));
      return new Response(body, { headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "miss" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
