/**
 * Records a shipped puzzle as the game runs it: every part's record after each step of the game's own run loop, run in
 * the processor (`src/run`). The output is JSON: the parts with their type and list, and per step the records that
 * changed, as hex.
 *
 *   pnpm --filter @opentim/content record-level --game <game folder> --puzzle <n> [--steps 300] --out <file.json>
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { exeHash, GAME_BUILDS, runPuzzle } from "../src/run/game.ts";

const { values } = parseArgs({
  options: {
    game: { type: "string" },
    puzzle: { type: "string" },
    steps: { type: "string", default: "300" },
    out: { type: "string" },
  },
});
if (!values.game || !values.puzzle || !values.out) throw new Error("--game, --puzzle and --out are needed");
const folder = values.game;
const exe = readFileSync(join(folder, "TIM.EXE"));
// The game opens its files from its own folder; the resource files may sit one folder up.
const names = new Map<string, string>();
for (const dir of [dirname(folder), folder])
  for (const name of readdirSync(dir)) names.set(name.toUpperCase(), join(dir, name));
const file = (name: string) => {
  const path = names.get(name);
  try {
    return path ? readFileSync(path) : undefined;
  } catch {
    return undefined;
  }
};
const puzzle = Number(values.puzzle);
const steps = Number(values.steps);
// A value that isn't a number would never end the run: the step count is never reached.
if (!Number.isInteger(puzzle) || puzzle < 0) throw new Error(`--puzzle must be a whole number, not ${values.puzzle}`);
if (!Number.isInteger(steps) || steps < 1)
  throw new Error(`--steps must be a whole number above 0, not ${values.steps}`);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const parts = new Map<number, { at: number; type: number; list: string; first: number }>();
const last = new Map<number, string>();
const recorded: { step: number; records: Record<string, string>; gone?: number[] }[] = [];
const started = Date.now();
runPuzzle(exe, file, puzzle, steps, ({ step, parts: now }) => {
  const records: Record<string, string> = {};
  for (const part of now) {
    if (!parts.has(part.at))
      parts.set(part.at, { at: part.at, type: part.record[4]! | (part.record[5]! << 8), list: part.list, first: step });
    const text = hex(part.record);
    if (last.get(part.at) !== text) records[part.at.toString(16)] = text;
    last.set(part.at, text);
  }
  const present = new Set(now.map((p) => p.at));
  const gone = [...last.keys()].filter((at) => !present.has(at));
  for (const at of gone) last.delete(at);
  recorded.push({ step, records, ...(gone.length ? { gone } : {}) });
});
writeFileSync(
  values.out,
  JSON.stringify({
    build: GAME_BUILDS.get(exeHash(exe))!.name,
    exe: exeHash(exe),
    puzzle,
    steps,
    recordBytes: 0xa0,
    parts: [...parts.values()],
    recorded,
  }),
);
console.log(`Puzzle ${puzzle}: ${parts.size} parts, ${steps} steps in ${((Date.now() - started) / 1000).toFixed(1)} s`);
