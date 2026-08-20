/**
 * Fotke jedne godine kao zaseban JSON, npr. /galerija/2017.json
 *
 * Razlog: galerija ima preko 4000 fotki kroz 18 godina. Kad su sve išle u
 * HTML stranice (skrivene dok se ne odabere godina), /galerija je težila
 * 5,5 MB prije nego se ijedna slika počela učitavati. Sad stranica nosi samo
 * najnovijih 100, a starije godine se dohvaćaju tek kad ih netko odabere.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import albumsData from "../../data/facebook-albums.json";
import { url } from "../../lib/url";

type SourcePhoto = {
  id: string;
  src: string;
  thumb?: string | null;
  caption: string;
  createdAt: string;
};
type Album = { name: string; permalink: string | null; photos: SourcePhoto[] };

/** Oblik koji troši client — bez `createdAt`, jer je godina već u imenu datoteke. */
export type GalleryPhoto = {
  /** Original — otvara ga lightbox. */
  src: string;
  /** Mali WebP za mrežu; pada natrag na `src` ako thumb još ne postoji. */
  thumb: string;
  caption: string;
  albumName: string;
  albumPermalink: string | null;
};

const albums = ((albumsData as { albums?: Album[] }).albums ?? []) as Album[];

/** Sve fotke iz svih albuma, najnovije prvo. */
const allPhotos = albums
  .flatMap((album) =>
    (album.photos ?? []).map((p) => ({
      src: url(p.src),
      thumb: url(p.thumb || p.src),
      caption: p.caption,
      albumName: album.name,
      albumPermalink: album.permalink ?? null,
      createdAt: p.createdAt,
    })),
  )
  .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

export const yearOf = (iso: string): string => /^(\d{4})-/.exec(iso || "")?.[1] ?? "";

export const getStaticPaths: GetStaticPaths = () => {
  const years = [...new Set(allPhotos.map((p) => yearOf(p.createdAt)).filter(Boolean))];
  return years.map((year) => ({ params: { year } }));
};

export const GET: APIRoute = ({ params }) => {
  const photos: GalleryPhoto[] = allPhotos
    .filter((p) => yearOf(p.createdAt) === params.year)
    .map(({ createdAt, ...photo }) => photo);

  return new Response(JSON.stringify(photos), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
