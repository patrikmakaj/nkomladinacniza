/**
 * Cijeli raspored sezone kao jedan .ics kalendar.
 *
 * Za razliku od pojedinačnog preuzimanja po utakmici (/utakmica/[id].ics),
 * ovo je stalna adresa (/raspored.ics) na koju se kalendar može
 * PRETPLATITI — Google i Apple je povremeno sami ponovo dohvate, pa se
 * promjene termina i novododane utakmice pojave bez ikakve akcije korisnika.
 *
 * Sadrži ligu, kup i prijateljske — sve iz lib/matches.
 */
import type { APIContext } from "astro";
import { allMatches } from "../lib/matches";
import { buildCalendar } from "../lib/ics";

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "";
  const body = buildCalendar(allMatches, {
    name: "NK Omladinac Niza — raspored",
    description: `Sve utakmice NK Omladinac Niza — liga, kup i prijateljske. ${site}`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="omladinac-raspored.ics"',
    },
  });
}
