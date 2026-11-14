/**
 * Writes the part lists in `src/lists` from local copies of the games. Give each game's folders with the list they
 * belong to; every build of a list must give the same result, so give all you have:
 *
 *   pnpm --filter @opentim/content extract-parts --tim1 <folder> --evenmore <folder> … --tim2 <folder> --toons <folder>
 *
 * A folder holds `TIM.EXE` (TIM 1, Even More) or `TOONS.EXE` (Toons) and the `RESOURCE` files, or has them in its
 * parent folder, like the French & German versions. Only the lists you give folders for are written. Toons names no
 * parts in its files, so its names list, `toons-names.json`, is kept by hand.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { format } from "prettier";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import type { PartList } from "../src/model.ts";
import { GAMES, readProgramParts, readTim2Parts, readToonsParts, type ListId } from "../src/read/parts.ts";

/** The resources of a game folder, by upper-case name. */
function readResources(folder: string): Map<string, Uint8Array> {
  const at = [folder, dirname(folder)].find((dir) => readdirSync(dir).some(isArchiveName));
  if (!at) throw new Error(`${folder}: no RESOURCE files here or in the parent folder`);
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(at).filter(isArchiveName).sort())
    for (const entry of readArchive(readFileSync(join(at, name)), name)) files.set(entry.name, entry.data);
  return files;
}

function timList(list: "tim1" | "evenmore", folder: string): PartList {
  const files = readResources(folder);
  const spriteCount = (sheet: string) => {
    const data = files.get(`${sheet}.BMP`);
    return data && decodeImage(data).frames.length;
  };
  const read = readProgramParts(list, readFileSync(join(folder, "TIM.EXE")), spriteCount);
  console.log(
    `${list}: ${folder}: type table at ${read.table.toString(16)}, data segment ${read.dataSegment.toString(16)}`,
  );
  return read.list;
}

function toonsList(folder: string): PartList {
  const files = readResources(folder);
  const spriteCount = (sheet: string) => {
    const data = files.get(`${sheet}.BMP`);
    return data && decodeImage(data).frames.length;
  };
  const read = readToonsParts(readFileSync(join(folder, "TOONS.EXE")), spriteCount);
  console.log(`toons: ${folder}: type table at ${read.table.toString(16)}, ${read.records.length} types`);
  return read.list;
}

function tim2List(folder: string): PartList {
  const files = readResources(folder);
  const list = readTim2Parts((name) => files.get(name));
  console.log(`tim2: ${folder}: ${list.parts.length} parts in INFO.RES`);
  return list;
}

const { values } = parseArgs({
  // pnpm passes on the `--` that separates its own options from the script's.
  args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
  options: Object.fromEntries(Object.keys(GAMES).map((id) => [id, { type: "string", multiple: true }])),
});
const out = join(import.meta.dirname, "../src/lists");
for (const list of Object.keys(GAMES) as ListId[]) {
  const folders = (values[list] as string[] | undefined) ?? [];
  if (!folders.length) continue;
  const results = folders.map((folder) => {
    if (list === "tim2") return tim2List(folder);
    if (list === "toons") {
      if (!existsSync(join(folder, "TOONS.EXE"))) throw new Error(`${folder}: no TOONS.EXE`);
      return toonsList(folder);
    }
    if (!existsSync(join(folder, "TIM.EXE"))) throw new Error(`${folder}: no TIM.EXE`);
    return timList(list, folder);
  });
  const [first] = results as [PartList];
  results.forEach((other, i) => {
    const differ = first.parts.filter((p, k) => JSON.stringify(p) !== JSON.stringify(other.parts[k]));
    if (differ.length || other.parts.length !== first.parts.length)
      throw new Error(`${list}: ${folders[i]} differs from ${folders[0]} in types ${differ.map((p) => p.type)}`);
  });
  // TIM 2's names go into the names list, by id, which every game's list shares; the game's list keeps the rest.
  if (list === "tim2") {
    const names = first.parts.flatMap((p) => (p.name ? [{ id: p.id, name: p.name }] : []));
    const json = JSON.stringify({ id: "names", source: "tim2", names });
    writeFileSync(join(out, "names.json"), await format(json, { parser: "json", printWidth: 120 }));
  }
  const json = JSON.stringify({ ...first, parts: first.parts.map((p) => ({ ...p, name: undefined })) });
  writeFileSync(join(out, `${list}.json`), await format(json, { parser: "json", printWidth: 120 }));
  console.log(`${list}: wrote ${results[0]!.parts.length} parts, the same in ${folders.length} builds`);
}
