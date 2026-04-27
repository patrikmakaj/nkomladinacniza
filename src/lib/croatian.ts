/**
 * Pomoćni helperi za hrvatsku gramatiku — sklanjanje brojeva.
 *
 * Hrvatsko pravilo: 1 → jednina, 2-4 → paucal, 5+ → množina.
 * Iznimke: brojevi koji završavaju s 11-14 idu u množinu (11, 12, 13, 14, 111, ...).
 */

export function pluralCroatian(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** "1 gol", "3 gola", "10 golova" */
export function golLabel(n: number): string {
  return pluralCroatian(n, "gol", "gola", "golova");
}

/** "1 nastup", "3 nastupa", "10 nastupa" */
export function nastupLabel(n: number): string {
  // U hrvatskom su paucal i množina za "nastup" isti oblik (nastupa)
  return pluralCroatian(n, "nastup", "nastupa", "nastupa");
}
