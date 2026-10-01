/**
 * Ručno arhiviranje sezone iz starog hns.json — npr. iz git povijesti:
 *
 *   git show <commit>:src/data/hns.json > /tmp/hns-stara.json
 *   node scripts/archive-season.mjs /tmp/hns-stara.json
 *
 * Inače to radi scraper sam kad HNS prijeđe na novu sezonu.
 * Prijateljske se uzimaju iz trenutnog src/data/friendlies.json.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveSeason } from "./lib/season-archive.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) {
  console.error("Upotreba: node scripts/archive-season.mjs <putanja-do-starog-hns.json>");
  process.exit(1);
}

const hns = JSON.parse(await readFile(src, "utf8"));
let friendlies = [];
try {
  friendlies = JSON.parse(await readFile(path.join(ROOT, "src/data/friendlies.json"), "utf8"));
} catch {
  // bez prijateljskih
}
await archiveSeason(hns, friendlies);
