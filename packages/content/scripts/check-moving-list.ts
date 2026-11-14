/**
 * Checks decided assumption 22 (docs/assumptions/behaviour-assumptions.md) in the game's own run: runs every shipped puzzle of a
 * build the level recorder knows (`src/run/game.ts`) and, at every step, looks for a part of a fixed type on the
 * moving list, the list the searches of the moving list walk. A type is fixed when the part factory's starting flags
 * for it have 0x4000, as the analysis reads them. It also reports the types that join a list during a run, and parts
 * whose own list flags disagree with the list they are on. Fails when a fixed type is found on the moving list.
 *
 * TIM 2 and Toons: their run loop doesn't run in the emulator (TIM2.EXE and TOONS.EXE don't start under it), so
 * only the puzzle start is looked at, with the game's own loader and start (`src/run/level-start.ts`): a part with
 * the fixed bit (0x4000 of its list flags, at 0x0a in TIM 2 and 0x06 in Toons) on the moving list fails the check as
 * in TIM, and parts whose flag disagrees with their list are listed. A TIM 1 or Even More build the level recorder
 * doesn't know isn't run, and the output says so.
 *
 *   pnpm --filter @opentim/content check-moving-list --tim1 <game folder> --evenmore <game folder>
 *     --tim2 <game folder> --toons <game folder> [--steps 500] [--jobs 1] [--puzzles 1-20]
 *
 * `--game <game folder>` still names a TIM 1 or Even More folder. `--puzzles` counts the levels of TIM 2 and Toons
 * from 1 in the order of their names.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { readBehaviour } from "../src/read/behaviour.ts";
import { readLevel } from "../src/read/level.ts";
import { exeHash, GAME_BUILDS, runPuzzle } from "../src/run/game.ts";
import {
  buildFolders,
  folderOptions,
  GAMES,
  readBuild,
  readResources,
  type BuildFolder,
  type Game,
  type TimGame,
} from "./builds.ts";
import { gameMachine } from "./game-machine.ts";

const FIXED = 0x4000;
const LIST_FLAGS = 0x06;

/** What one puzzle's run shows. */
export interface PuzzleResult {
  puzzle: number;
  /** The steps the run got through: the last step `onStep` saw. */
  steps: number;
  error?: string;
  /** The parts on each list as the puzzle is loaded. */
  start: { moving: number; fixed: number };
  /** Parts of a fixed type on the moving list: the first step each one is seen there. */
  fixedOnMoving: { step: number; at: number; type: number }[];
  /** Parts that join a list during the run, by list and type, with the first step. */
  joined: { list: "moving" | "fixed"; type: number; step: number }[];
  /** Parts whose own flags at 0x06 disagree with their list (0x4000 on the moving list, or without it on the fixed). */
  flagsDisagree: { step: number; at: number; type: number; list: "moving" | "fixed"; flags: number }[];
}

/** Opens the game's files from its folder and the folder above, as DOS would find them. */
function gameFiles(folder: string) {
  const names = new Map<string, string>();
  for (const dir of [dirname(folder), folder])
    for (const name of readdirSync(dir)) names.set(name.toUpperCase(), join(dir, name));
  return (name: string) => {
    const path = names.get(name);
    try {
      return path ? readFileSync(path) : undefined;
    } catch {
      return undefined;
    }
  };
}

function runOne(folder: string, puzzle: number, steps: number, fixedTypes: Set<number>): PuzzleResult {
  const exe = readFileSync(join(folder, "TIM.EXE"));
  const result: PuzzleResult = {
    puzzle,
    steps: 0,
    start: { moving: 0, fixed: 0 },
    fixedOnMoving: [],
    joined: [],
    flagsDisagree: [],
  };
  const seen = new Map<string, number>();
  const joinedKeys = new Set<string>();
  const flagged = new Set<number>();
  try {
    runPuzzle(exe, gameFiles(folder), puzzle, steps, ({ step, parts }) => {
      result.steps = step;
      if (step === 0)
        result.start = {
          moving: parts.filter((p) => p.list === "moving").length,
          fixed: parts.filter((p) => p.list === "fixed").length,
        };
      for (const part of parts) {
        const type = part.record[4]! | (part.record[5]! << 8);
        const flags = part.record[LIST_FLAGS]! | (part.record[LIST_FLAGS + 1]! << 8);
        const key = `${part.list}:${part.at}:${type}`;
        if (!seen.has(key)) {
          seen.set(key, step);
          if (step > 0 && !joinedKeys.has(`${part.list}:${type}`)) {
            joinedKeys.add(`${part.list}:${type}`);
            result.joined.push({ list: part.list, type, step });
          }
          if (part.list === "moving" && fixedTypes.has(type)) result.fixedOnMoving.push({ step, at: part.at, type });
        }
        if (((flags & FIXED) !== 0) !== (part.list === "fixed") && !flagged.has(part.at)) {
          flagged.add(part.at);
          result.flagsDisagree.push({ step, at: part.at, type, list: part.list, flags });
        }
      }
    });
  } catch (problem) {
    result.error = problem instanceof Error ? problem.message : String(problem);
  }
  return result;
}

/** TIM 1 and Even More: every shipped puzzle run in the game for `steps` steps. Gives the problems. */
async function runTim(folder: string, steps: number, jobs: number, range: [number, number] | undefined) {
  const program = readFileSync(join(folder, "TIM.EXE"));
  const build = GAME_BUILDS.get(exeHash(program));
  if (!build) {
    console.log(`${folder}: the level recorder doesn't know this TIM.EXE (${exeHash(program)}), so it isn't run.`);
    return 0;
  }

  // The fixed types, from the part factory's starting flags as the analysis reads them.
  const game: TimGame = build.name.startsWith("Even More") ? "evenmore" : "tim1";
  const { files, parts } = readBuild({ game, folder, index: 0 });
  const report = readBehaviour(program, parts);
  const starting = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);
  if (!starting) throw new Error("the analysis found no starting flags for the part types");
  const fixedTypes = starting.values.flatMap((value, type) => ((value & FIXED) !== 0 ? [type] : []));
  const names = new Map(report.parts.map((p) => [p.type, p.id]));
  const name = (type: number) => `${names.get(type) ?? "?"} (${type})`;

  let puzzles = [...files.keys()]
    .map((file) => /^L(\d+)\.LEV$/i.exec(file)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (range) puzzles = puzzles.filter((p) => p >= range[0] && p <= range[1]);
  if (!puzzles.length) throw new Error(`no puzzles to run${range ? ` in ${range.join("-")}` : ""}`);
  console.log(`${build.name}: ${puzzles.length} puzzles, ${steps} steps each, ${jobs} at a time`);
  console.log(`Fixed types: ${fixedTypes.map(name).join(", ")}`);

  const started = Date.now();
  const results: PuzzleResult[] = [];
  const lanes = Array.from({ length: Math.min(jobs, puzzles.length) }, (_, lane) =>
    puzzles.filter((_, k) => k % jobs === lane),
  );
  await Promise.all(
    lanes.map(
      (share) =>
        new Promise<void>((done, fail) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { folder, puzzles: share, steps, fixedTypes },
          });
          worker.on("message", (result: PuzzleResult) => results.push(result));
          worker.once("error", fail);
          worker.once("exit", () => done());
        }),
    ),
  );
  results.sort((a, b) => a.puzzle - b.puzzle);

  const failed = results.filter((r) => r.error);
  const short = results.filter((r) => !r.error && r.steps < steps);
  const fixedOnMoving = results.flatMap((r) => r.fixedOnMoving.map((f) => ({ ...f, puzzle: r.puzzle })));
  const disagree = results.flatMap((r) => r.flagsDisagree.map((f) => ({ ...f, puzzle: r.puzzle })));
  const joined = new Map<string, number[]>();
  for (const r of results)
    for (const j of r.joined) {
      const key = `${j.list}: ${name(j.type)}`;
      joined.set(key, [...(joined.get(key) ?? []), r.puzzle]);
    }
  const sum = (pick: (r: PuzzleResult) => number) => results.reduce((total, r) => total + pick(r), 0);

  console.log(
    `Ran ${results.length - failed.length} puzzles in ${((Date.now() - started) / 1000).toFixed(0)} s: ` +
      `${sum((r) => r.start.moving)} moving and ${sum((r) => r.start.fixed)} fixed parts as loaded, ` +
      `${sum((r) => r.steps)} steps.`,
  );
  if (short.length)
    console.log(`Runs that ended before ${steps} steps: ${short.map((r) => `${r.puzzle} (${r.steps})`).join(", ")}`);
  for (const r of failed) console.error(`Puzzle ${r.puzzle} failed after ${r.steps} steps: ${r.error}`);
  console.log("Types that joined a list during a run (puzzles):");
  for (const [key, list] of [...joined].sort())
    console.log(`  ${key}: ${list.length} (${list.slice(0, 12).join(", ")}${list.length > 12 ? ", ..." : ""})`);
  console.log(`Parts whose flags at 0x06 disagree with their list: ${disagree.length}`);
  for (const d of disagree.slice(0, 20))
    console.log(
      `  puzzle ${d.puzzle} step ${d.step}: ${name(d.type)} on the ${d.list} list, flags 0x${d.flags.toString(16)}`,
    );
  console.log(`Parts of a fixed type on the moving list: ${fixedOnMoving.length}`);
  for (const f of fixedOnMoving.slice(0, 20)) console.log(`  puzzle ${f.puzzle} step ${f.step}: ${name(f.type)}`);
  const missing = puzzles.filter((p) => !results.some((r) => r.puzzle === p));
  if (missing.length) console.error(`Puzzles that gave no result: ${missing.join(", ")}`);
  return fixedOnMoving.length + failed.length + missing.length;
}

/** TIM 2 and Toons: every level as the game's own puzzle start leaves it. Gives the problems. */
function atStart(build: BuildFolder<"tim2" | "toons">, range: [number, number] | undefined): number {
  const found = gameMachine(build);
  if ("problem" in found) {
    console.error(`${build.folder}: ${found.problem}, so no puzzle is started.`);
    return 1;
  }
  const { machine } = found;
  const flagsAt = build.game === "tim2" ? 0x0a : LIST_FLAGS;
  const files = readResources(build.folder);
  const names = [...files.keys()].filter((name) => /\.LEV$/i.test(name)).sort();
  // An empty choice would check nothing and still pass.
  if (!names.some((_, k) => !range || (k + 1 >= range[0] && k + 1 <= range[1]))) {
    console.error(
      `${build.folder}: no levels${range ? ` in ${range.join("-")} of the ${names.length} it has` : ""}, so no puzzle is started.`,
    );
    return 1;
  }
  console.log(
    `${build.folder}: ${names.length} levels, looked at as the puzzle starts: the game's run loop doesn't run in the emulator`,
  );
  let starts = 0;
  let moving = 0;
  let fixed = 0;
  const failed: string[] = [];
  const fixedOnMoving: string[] = [];
  const disagree: string[] = [];
  names.forEach((file, k) => {
    if (range && (k + 1 < range[0] || k + 1 > range[1])) return;
    const name = file.replace(/\.LEV$/i, "");
    try {
      const level = readLevel(files.get(file)!, { layout: build.game, name: file });
      const { started } = machine.run(files.get(file)!, file, level.parts.length);
      starts++;
      moving += started.lists.moving.length;
      fixed += started.lists.fixed.length;
      for (const list of ["moving", "fixed"] as const)
        for (const at of started.lists[list]) {
          const record = started.records.get(at)!;
          const flags = record[flagsAt]! | (record[flagsAt + 1]! << 8);
          const index = started.pool.indexOf(at);
          const what = `${name} #${index} (type ${level.parts[index]?.type ?? "?"}) on the ${list} list, flags 0x${flags.toString(16)}`;
          if (list === "moving" && flags & FIXED) fixedOnMoving.push(what);
          else if (((flags & FIXED) !== 0) !== (list === "fixed")) disagree.push(what);
        }
    } catch (problem) {
      failed.push(`${name}: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  });
  console.log(`Started ${starts} puzzles: ${moving} moving and ${fixed} fixed parts on the lists.`);
  for (const f of failed) console.error(`  ${f}`);
  console.log(`Parts whose flags at 0x${flagsAt.toString(16)} disagree with their list: ${disagree.length}`);
  for (const d of disagree.slice(0, 20)) console.log(`  ${d}`);
  console.log(`Parts with the fixed bit on the moving list: ${fixedOnMoving.length}`);
  for (const f of fixedOnMoving.slice(0, 20)) console.log(`  ${f}`);
  return fixedOnMoving.length + failed.length;
}

if (!isMainThread) {
  const { folder, puzzles, steps, fixedTypes } = workerData as {
    folder: string;
    puzzles: number[];
    steps: number;
    fixedTypes: number[];
  };
  const fixed = new Set(fixedTypes);
  for (const puzzle of puzzles) parentPort!.postMessage(runOne(folder, puzzle, steps, fixed));
} else {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      game: { type: "string", multiple: true },
      steps: { type: "string", default: "500" },
      jobs: { type: "string" },
      puzzles: { type: "string" },
      ...folderOptions(GAMES),
    },
  });
  // A count that isn't a whole number above 0 would check nothing and still pass.
  const count = (option: string, text: string) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${option} must be a whole number above 0, not ${text}`);
    return n;
  };
  const steps = count("steps", values.steps!);
  // One emulator at a time unless told: a run with four at once took a machine down.
  const jobs = values.jobs ? count("jobs", values.jobs) : 1;
  let range: [number, number] | undefined;
  if (values.puzzles) {
    const [from, to = from] = values.puzzles.split("-").map((n) => count("puzzles", n));
    if (to! < from!) throw new Error(`--puzzles must run from the lower number to the higher, not ${values.puzzles}`);
    range = [from!, to!];
  }
  const builds: BuildFolder<Game>[] = [
    ...buildFolders(values, GAMES),
    ...(values.game ?? []).map((folder) => ({ game: "tim1" as const, folder: resolve(folder), index: 0 })),
  ];
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");
  let problems = 0;
  for (const build of builds)
    problems +=
      build.game === "tim2" || build.game === "toons"
        ? atStart(build as BuildFolder<"tim2" | "toons">, range)
        : await runTim(build.folder, steps, jobs, range);
  if (problems) process.exitCode = 1;
}
