/**
 * Fotografija ili klupska grafika (plakat najave, rezultat, "Novi igrač")?
 *
 * Facebook ih stavlja u isti album ("Preneseno s mobitela"), pa ih po albumu
 * ne možemo razdvojiti. Grafike se rade u formatu objave 1080×1350 (4:5) —
 * od zadnjih 100 slika 38 ih je točno tog omjera, a fotke s mobitela su
 * 3:4 ili 4:3. Fotka izrezana baš na 4:5 završi među plakatima, zato je
 * "Sve" uvijek jedan klik dalje.
 */
export type GalleryKind = "photo" | "graphic";

export function galleryKind(width?: number | null, height?: number | null): GalleryKind {
  if (!width || !height) return "photo";
  const ratio = height / width;
  return Math.abs(ratio - 1.25) < 0.006 ? "graphic" : "photo";
}
