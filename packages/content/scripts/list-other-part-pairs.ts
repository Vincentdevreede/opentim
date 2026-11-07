/**
 * Lists which part types can do something to which, as the code allows it, and where each pair is described in the
 * part's "From other parts" (step C2 of docs/behaviour-plan.md). Fails when a pair is neither described, ruled out by
 * a decided assumption, nor missing with a reason.
 *
 *   pnpm --filter @opentim/content list-other-part-pairs --tim1 <game folder> --evenmore <game folder>
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import { readBehaviour } from "../src/read/behaviour.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { otherPartPairs, renderOtherPartPairs } from "../src/read/other-part-pairs.ts";
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
  options: { tim1: { type: "string", multiple: true }, evenmore: { type: "string", multiple: true } },
});
if (!values.tim1?.length && !values.evenmore?.length) throw new Error("Give at least one --tim1 or --evenmore folder");

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
    const pairs = otherPartPairs(readBehaviour(program, parts), evaluateBehaviourCondition);
    console.log(`== ${folder}`);
    console.log(renderOtherPartPairs(pairs));
    if (pairs.pairs.some((p) => p.status !== "described" && !p.reasons.length)) {
      console.error("A pair has no description and no reason.");
      process.exitCode = 1;
    }
  }
