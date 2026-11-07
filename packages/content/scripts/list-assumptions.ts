/**
 * Lists every assumption the behaviour analysis states in the given builds, or checks the list is complete.
 *
 *   pnpm --filter @opentim/content list-assumptions --out <document> --tim1 <game folder> --evenmore <game folder>
 *   pnpm --filter @opentim/content list-assumptions --check <document> --tim1 <game folder> --evenmore <game folder>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import {
  addBuild,
  collectAssumptions,
  compareAssumptions,
  renderAssumptions,
  type AssumptionTable,
} from "../src/read/behaviour-assumption-list.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { readProgramParts } from "../src/read/parts.ts";

function readResources(folder: string): Map<string, Uint8Array> {
  const at = [folder, dirname(folder)].find((dir) => readdirSync(dir).some(isArchiveName));
  if (!at) throw new Error(`${folder}: no RESOURCE files here or in the parent folder`);
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(at).filter(isArchiveName).sort())
    for (const entry of readArchive(readFileSync(join(at, name)), name)) files.set(entry.name, entry.data);
  return files;
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
  options: {
    out: { type: "string" },
    check: { type: "string" },
    tim1: { type: "string", multiple: true },
    evenmore: { type: "string", multiple: true },
  },
});
if ((!values.out && !values.check) || (!values.tim1?.length && !values.evenmore?.length))
  throw new Error("Give --out or --check <document> and at least one --tim1 or --evenmore <game folder>");

const table: AssumptionTable = new Map();
const builds = { tim1: 0, evenmore: 0 };
for (const [game, folders] of [
  ["tim1", values.tim1 ?? []],
  ["evenmore", values.evenmore ?? []],
] as const)
  for (const folder of folders.map((f) => resolve(f))) {
    const program = readFileSync(join(folder, "TIM.EXE"));
    const files = readResources(folder);
    const parts = readProgramParts(
      game,
      program,
      (sheet) => {
        const data = files.get(`${sheet}.BMP`);
        return data && decodeImage(data).frames.length;
      },
      (sheet) => files.get(`${sheet}.BMP`),
    );
    addBuild(table, game, collectAssumptions(readBehaviour(program, parts)));
    builds[game]++;
    console.log(`${folder}: ${table.size} assumptions so far`);
  }

if (values.out) {
  writeFileSync(resolve(values.out), renderAssumptions(table, builds));
  console.log(`Wrote ${table.size} assumptions to ${values.out}`);
} else {
  const { missing, stale } = compareAssumptions(table, readFileSync(resolve(values.check!), "utf8"));
  for (const text of stale) console.log(`No longer stated by these builds: ${text}`);
  for (const text of missing) console.error(`Not listed: ${text}`);
  if (missing.length) {
    console.error(`${missing.length} assumptions are not listed. Regenerate the list with --out.`);
    process.exitCode = 1;
  } else console.log(`All ${table.size} assumptions are listed.`);
}
