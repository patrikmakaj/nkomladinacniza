/**
 * schema.org SportsEvent za utakmicu — JSON-LD u <head>, da tražilice znaju
 * kad se i gdje igra (najava, naslovnica) ili kako je završilo.
 */
import { crestSrc } from "./images";
import { competitionShort, kickoffIso, type UnifiedMatch } from "./matches";
import { HOME_GROUND, venueFor } from "./venue";

/**
 * @param m        utakmica
 * @param pageUrl  apsolutni URL stranice utakmice
 * @param site     apsolutni URL stranice (za lokalne grbove)
 */
export function sportsEventLd(m: UnifiedMatch, pageUrl: string, site: URL | string) {
  const venue = venueFor(m);
  const team = (t: UnifiedMatch["home"]) => {
    const logo = crestSrc(t.logo);
    return {
      "@type": "SportsTeam",
      name: t.name,
      ...(logo ? { logo: new URL(logo, site).href } : {}),
    };
  };

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${m.home.name} – ${m.away.name}`,
    description:
      m.played && m.score
        ? `${competitionShort(m)}. Konačni rezultat ${m.home.name} ${m.score.home} : ${m.score.away} ${m.away.name}.`
        : `${competitionShort(m)}. ${m.isHome ? "Domaća utakmica" : "Gostovanje"} NK Omladinac Niza.`,
    startDate: kickoffIso(m),
    url: pageUrl,
    sport: "Soccer",
    eventStatus: m.played
      ? "https://schema.org/EventCompleted"
      : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    homeTeam: team(m.home),
    awayTeam: team(m.away),
    competitor: [team(m.home), team(m.away)],
    location: m.isHome
      ? {
          "@type": "Place",
          name: HOME_GROUND.name,
          address: {
            "@type": "PostalAddress",
            streetAddress: "Kolodvorska 50a",
            addressLocality: "Niza",
            postalCode: "31224",
            addressCountry: "HR",
          },
        }
      : {
          "@type": "Place",
          name: venue.label,
          address: { "@type": "PostalAddress", addressCountry: "HR" },
        },
    organizer: {
      "@type": "SportsOrganization",
      name: m.type === "friendly" ? "NK Omladinac Niza" : "Nogometno središte Našice",
    },
  };
}
