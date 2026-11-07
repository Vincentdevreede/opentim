/**
 * Checks every shipped level's saved frames against the behaviour description, build by build (step E1 of
 * docs/behaviour-plan.md). Fails when a level saves a part on a frame the description doesn't allow, or a decided
 * control value outside its numbers.
 *
 *   pnpm --filter @opentim/content check-level-frames --tim1 <game folder> --evenmore <game folder>
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import { readBehaviour } from "../src/read/behaviour.ts";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import { checkLevelFrames, type CheckedLevel } from "../src/read/level-frame-check.ts";
import { readLevel } from "../src/read/level.ts";
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

const frames = (counts: Map<number, number>) =>
  [...counts]
    .sort(([a], [b]) => a - b)
    .map(([frame, count]) => `${frame} (${count})`)
    .join(", ");
let disagreements = 0;
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
    const report = readBehaviour(program, parts);
    const description = describeBehaviour(report);
    const levels: CheckedLevel[] = [];
    const unread: string[] = [];
    for (const [name, data] of files) {
      if (!/\.(LEV|GKC)$/i.test(name)) continue;
      try {
        levels.push({ name, parts: readLevel(data, { layout: "tim", name }).parts });
      } catch (error) {
        unread.push(name);
        console.error(`  ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // A folder without one level read checked nothing, which must not pass as agreement.
    if (!levels.length) {
      console.error(`${folder}: no level could be read, so nothing was checked.`);
      disagreements++;
    }
    const rows = checkLevelFrames(
      description.parts.map((part) => ({
        description: part,
        frameCount: report.parts.find((item) => item.type === part.type)?.frameCount,
      })),
      levels,
    );
    console.log(
      `${folder}: ${levels.length} levels${unread.length ? `, ${unread.length} unread (${unread.join(", ")})` : ""}`,
    );
    for (const row of rows) {
      const problems = [...row.outside, ...row.controls];
      disagreements += problems.length;
      const notes = [
        ...(row.allowed.frames ? [] : [`no frames to check (${row.allowed.basis})`]),
        ...(row.notResting.size ? [`starts on frames that aren't resting frames: ${frames(row.notResting)}`] : []),
      ];
      if (problems.length || notes.length)
        console.log(`  ${row.type}: ${row.id}: saved ${frames(row.saved)}${notes.map((note) => `; ${note}`).join("")}`);
      for (const problem of problems) console.error(`    Not allowed: ${problem}`);
    }
  }
if (disagreements) {
  console.error(`${disagreements} saved values disagree with the description.`);
  process.exitCode = 1;
} else console.log("Every saved frame and control value is one the description allows.");
