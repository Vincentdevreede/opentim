/**
 * Checks what the Lab says each puzzle starts with (`puzzleStart` in `src/read/puzzle-start.ts`) against what the game's
 * own puzzle start does in the emulator, for every puzzle of every game folder it is given, each the same way: which
 * parts are in the bin and in what order, which stay on the board, which are taken off, and the states, plugs, ropes
 * and belts the start changes on the board. For TIM 2 also the order of the moving and fixed lists after the loader
 * and after the start, which decides which part the goal routine finds last on its list.
 *
 * - TIM 2 and Toons: TIM2.EXE and TOONS.EXE run their level loader and then their puzzle start on the level
 *   (`src/run/level-start.ts`, found in the program by `src/run/level-start-find.ts`). TIM 2 is also started for the
 *   designer's solution, and the parts it leaves in the bin are compared.
 * - TIM 1 and Even More: the game is started and the puzzle loaded as the play screen does (`loadPuzzle` in
 *   `src/run/game.ts`), only for the builds the level recorder knows; for another build the output says it isn't
 *   checked. Their start changes nothing the file has, so the bin's order and each placed part's saved state, plugs and
 *   first rope place are compared with the file.
 *
 * Fails when a puzzle starts otherwise in the game than the Lab says, or a level can't be loaded.
 *
 *   pnpm --filter @opentim/content check-puzzle-start --tim1 <game folder> --evenmore <game folder>
 *     --tim2 <game folder> --toons <game folder> [--jobs n] [--puzzles 1-20]
 *
 * `--puzzles` takes TIM's puzzle numbers, and counts the levels of TIM 2 and Toons from 1 in the order of their names.
 * A TIM puzzle takes about 12 seconds; a TIM 2 or Toons level a fifth of a second.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { readLevel, type Level, type LevelPart } from "../src/read/level.ts";
import { puzzleStart } from "../src/read/puzzle-start.ts";
import { readTim2StartTables, type Tim2StartTables } from "../src/read/tim2-start.ts";
import { readToonsBinKinds, readToonsListKinds } from "../src/read/toons-goals.ts";
import { exeHash, GAME_BUILDS, loadPuzzle } from "../src/run/game.ts";
import { tim2Solution } from "../src/run/level-start-find.ts";
import {
  gameStartResult,
  startDifferences,
  TIM2_START_FIELDS,
  tim2ListDifferences,
  TOONS_START_FIELDS,
} from "../src/run/start-check.ts";
import {
  buildFolders,
  folderOptions,
  GAMES,
  inEachBuild,
  jobsOption,
  readProgram,
  readResources,
  type BuildFolder,
  type Game,
} from "./builds.ts";
import { gameMachine } from "./game-machine.ts";

const hex = (value: number) => `0x${value.toString(16)}`;

/** One build's lines in the order they are printed (errors to stderr), and how many problems it has. */
interface BuildCheck {
  lines: { error: boolean; text: string }[];
  problems: number;
}

/** The levels to check, by name, and the puzzle number or place each has. */
type Range = [number, number] | undefined;
const within = (n: number, range: Range) => !range || (n >= range[0] && n <= range[1]);

/** A check's results as every game prints them, after the build's first line. */
function report(check: BuildCheck, what: string, results: { name: string; differences: string[] }[]) {
  const differ = results.filter((r) => r.differences.length);
  check.lines.push({
    error: false,
    text: `  Checked ${results.length} ${what}: ${results.length - differ.length} start as the Lab says, ${differ.length} differ.`,
  });
  for (const r of differ) check.lines.push({ error: true, text: `  ${r.name} differs: ${r.differences.join("; ")}` });
  check.problems += differ.length;
  // An empty choice would check nothing and still pass.
  if (!results.length) {
    check.lines.push({ error: true, text: `  No ${what} in the levels chosen.` });
    check.problems++;
  }
}

/** TIM 2 and Toons: the game's level loader and puzzle start on every level. */
function checkWithLoader(build: BuildFolder<"tim2" | "toons">, range: Range): BuildCheck {
  const check: BuildCheck = { lines: [], problems: 0 };
  const found = gameMachine(build);
  if ("problem" in found) {
    check.lines.push({ error: true, text: `${build.folder}: ${found.problem}, so no puzzle is started.` });
    return { ...check, problems: 1 };
  }
  const { machine, start, program } = found;
  const exe = readProgram(build);
  const sort =
    build.game === "toons" ? { kinds: readToonsListKinds(exe), binKinds: readToonsBinKinds(exe) } : undefined;
  const tim2 = build.game === "tim2" ? readTim2StartTables(exe) : undefined;
  const fields = build.game === "toons" ? TOONS_START_FIELDS : TIM2_START_FIELDS;
  const files = readResources(build.folder);
  const names = [...files.keys()].filter((name) => /\.LEV$/i.test(name)).sort();
  const where = (call: { segment: number; offset: number }) =>
    `${hex(call.segment)}:${hex(call.offset)} (file offset ${hex(program.fileOffset(call.segment * 16 + call.offset))})`;
  check.lines.push({
    error: false,
    text:
      `${build.folder}: level loader ${where(start.loader)}, puzzle start ${where(start.start[0]!)}` +
      `${start.start.length > 1 ? ` and ${start.start.length - 1} more` : ""}, ${names.length} levels shipped`,
  });
  const puzzles: { name: string; differences: string[] }[] = [];
  const solutions: { name: string; differences: string[] }[] = [];
  const unknown = new Map<string, Set<string>>();
  names.forEach((file, k) => {
    if (!within(k + 1, range)) return;
    const name = file.replace(/\.LEV$/i, "");
    const data = files.get(file)!;
    let level: Level;
    try {
      level = readLevel(data, { layout: build.game, name: file });
    } catch (problem) {
      puzzles.push({ name, differences: [`the file can't be read: ${(problem as Error).message}`] });
      return;
    }
    try {
      const run = machine.run(data, file, level.parts.length);
      for (const what of run.unknown.keys()) unknown.set(what, (unknown.get(what) ?? new Set()).add(name));
      const ours = puzzleStart(level, { sort, tim2 });
      const differences = startDifferences(level, ours, gameStartResult(run, fields));
      // TIM 2's goal routine walks the lists in their order, so it is checked too.
      if (tim2) differences.push(...tim2ListDifferences(level, tim2, ours, run));
      puzzles.push({ name, differences });
      if (build.game === "tim2") {
        const solved = machine.run(data, file, level.parts.length, tim2Solution(start));
        const ours = puzzleStart(level, { solution: true, tim2 });
        const game = gameStartResult(solved, fields);
        // Only where the parts are: the solution is for looking at.
        const differences = startDifferences(level, ours, game).filter((d) => /^(the bin|on the board)/.test(d));
        solutions.push({ name, differences });
      }
    } catch (problem) {
      puzzles.push({ name, differences: [`the game's code stopped: ${(problem as Error).message}`] });
    }
  });
  report(check, "puzzles", puzzles);
  if (build.game === "tim2") report(check, "solutions", solutions);
  const made = tim2 ? plugLevels(files, names, tim2) : [];
  // A build whose levels have no part plugged into another (the demo) has nothing to make the levels from.
  if (tim2 && !made.length)
    check.lines.push({
      error: false,
      text: "  No shipped level has a part plugged into another, so there are no made-up levels to check.",
    });
  if (tim2 && made.length) {
    const results = made.map(({ name, data, socket, stateAt }) => {
      try {
        let level = readLevel(data, { layout: "tim2", name });
        let run = machine.run(data, name, level.parts.length);
        // The loader lets some types set their state by their plugs, so the file takes the state the loader leaves.
        const record = run.loaded.records.get(run.loaded.pool[socket]!)!;
        const loaded = record[fields.state]! | (record[fields.state + 1]! << 8);
        if (loaded !== (level.parts[socket]!.state[0] & 0xffff)) {
          new DataView(data.buffer).setUint16(stateAt, loaded, true);
          level = readLevel(data, { layout: "tim2", name });
          run = machine.run(data, name, level.parts.length);
        }
        return {
          name,
          differences: startDifferences(level, puzzleStart(level, { tim2 }), gameStartResult(run, fields)),
        };
      } catch (problem) {
        return { name, differences: [`the game's code stopped: ${(problem as Error).message}`] };
      }
    });
    report(check, "made-up levels that unplug every type with a plug or places to plug into", results);
  }
  for (const [what, levels] of unknown)
    check.lines.push({
      error: false,
      text: `  Not answered, ${what}: ${[...levels].slice(0, 8).join(", ")}${levels.size > 8 ? ", ..." : ""}`,
    });
  return check;
}

/**
 * TIM 2: made-up levels for the routine that pulls a plug out. The first shipped level with a part plugged into
 * another, neither of them tied by a rope or a belt, is changed in its bytes: the two parts take every pair of a type
 * with places to plug into and a type with a plug (bits 2 and 1 of the type's third flag word), the one or the other
 * goes to the bin (bit 0x40 of the third flag word in the file), and the one with places starts in two states, or the
 * state the loader gives it for its plugs. The loader reads nothing more for these types, so only the type, the flag
 * word and the state change.
 */
function plugLevels(
  files: Map<string, Uint8Array>,
  names: string[],
  tables: Tim2StartTables,
): { name: string; data: Uint8Array; socket: number; stateAt: number }[] {
  const bits = (type: number) => tables.third.get(type) ?? 0;
  const sockets = [...tables.third.keys()].filter((t) => bits(t) & 2);
  const withPlugs = [...tables.third.keys()].filter((t) => bits(t) & 1 && !(bits(t) & 2));
  const loose = (p: LevelPart) => !p.belt.parts && !p.ropes.some((r) => r.rope);
  for (const file of names) {
    const data = files.get(file)!;
    const level = readLevel(data, { layout: "tim2", name: file });
    const tied = new Set(level.parts.flatMap((p) => [...(p.ropes[0].rope?.parts ?? []), ...(p.belt.parts ?? [])]));
    const socket = level.parts.find(
      (s) =>
        bits(s.type) & 2 &&
        loose(s) &&
        !tied.has(s.index) &&
        s.plugs?.some((i) => i !== null && level.parts[i]!.plugs?.[0] === s.index && !tied.has(i)),
    );
    if (!socket) continue;
    const plug = level.parts[socket.plugs!.find((i) => i !== null && level.parts[i]!.plugs?.[0] === socket.index)!]!;
    const at = (part: LevelPart, key: string) => part.fields.find((f) => f.key === key)!.offset;
    const out: { name: string; data: Uint8Array; socket: number; stateAt: number }[] = [];
    for (const socketType of sockets)
      for (const plugType of withPlugs)
        for (const binned of ["socket", "plug"] as const)
          for (const state of [2, 13]) {
            const made = Uint8Array.from(data);
            const view = new DataView(made.buffer);
            const set = (part: LevelPart, type: number, fixed: boolean) => {
              view.setUint16(at(part, "type"), type, true);
              const third = view.getUint16(at(part, "flags.2"), true) & ~0x140;
              view.setUint16(at(part, "flags.2"), fixed ? third | 0x40 : third, true);
            };
            set(socket, socketType, binned === "plug");
            set(plug, plugType, binned === "socket");
            view.setInt16(at(socket, "state.0"), state, true);
            const name = `${file.replace(/\.LEV$/i, "")} ${socketType}+${plugType} ${binned} binned, state ${state}`;
            out.push({ name, data: made, socket: socket.index, stateAt: at(socket, "state.0") });
          }
    return out;
  }
  return [];
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

const u16 = (record: Uint8Array, at: number) => record[at]! | (record[at + 1]! << 8);

/**
 * TIM 1 and Even More: each puzzle loaded by the game, its bin compared by type in order, and each placed part paired
 * with its record as `check-level-fields` pairs them (type, flags and place on its list), then its saved state (0x90),
 * plugs (0x62, 0x64) and first rope place (0x66: the rope's record, in the rope and in each part it ties there)
 * compared with the file. A part no one record pairs with (another of its type with the same flags and place) isn't
 * compared.
 */
function differencesTim(
  level: Level,
  loaded: ReturnType<typeof loadPuzzle>,
): { differences: string[]; unpaired: number } {
  const out: string[] = [];
  const ours = puzzleStart(level);
  const bin = ours.bin.map((i) => level.parts[i]!.type);
  const game = loaded.bin.map((b) => u16(b.record, 4));
  if (bin.length !== game.length || bin.some((t, k) => game[k] !== t))
    out.push(`the bin by type: ours ${bin.join(", ") || "none"}, the game's ${game.join(", ") || "none"}`);
  // The parts whose first rope place holds a rope's record: the rope itself, and each part it ties there.
  const tied = new Set<number>();
  for (const part of level.parts) {
    const rope = part.ropes[0].rope;
    if (!rope) continue;
    tied.add(part.index);
    rope.parts.forEach((end, k) => end !== null && rope.slots[k] === 0 && tied.add(end));
  }
  const records = loaded.parts.map((p) => ({ ...p, used: false }));
  const paired = new Map<number, (typeof records)[number]>();
  const unpaired: number[] = [];
  for (const part of level.parts.filter((p) => p.group !== "bin")) {
    const list = part.group === "static" ? "fixed" : "moving";
    const candidates = records.filter((r) => r.list === list && u16(r.record, 4) === part.type && !r.used);
    const alike = candidates.filter(
      (r) =>
        u16(r.record, 6) === part.flags[0] &&
        u16(r.record, 8) === part.flags[1] &&
        u16(r.record, 0x8c) === (part.position.x & 0xffff) &&
        u16(r.record, 0x8e) === (part.position.y & 0xffff),
    );
    const pick = candidates.length === 1 ? candidates[0] : alike.length === 1 ? alike[0] : undefined;
    if (!pick) {
      unpaired.push(part.index);
      continue;
    }
    pick.used = true;
    paired.set(part.index, pick);
  }
  // Counted apart from the pairing, so a part without a record shows even when no record pairs with it.
  const extra = records.length - (paired.size + unpaired.length);
  if (extra > 0) out.push(`${extra} records on the lists no part of the file pairs with`);
  if (extra < 0) out.push(`${-extra} placed parts of the file the game made no record for`);
  for (const [index, record] of paired) {
    const part = level.parts[index]!;
    if (u16(record.record, 0x90) !== (part.state[0] & 0xffff))
      out.push(`#${index}'s state: ours ${part.state[0]}, the game's ${u16(record.record, 0x90)}`);
    (part.plugs ?? [null, null]).forEach((plug, k) => {
      const expected = plug === null ? 0 : (paired.get(plug)?.at ?? -1);
      if (expected >= 0 && u16(record.record, 0x62 + 2 * k) !== expected)
        out.push(`#${index}'s plug ${k + 1}: ours ${plug === null ? "none" : `#${plug}`}, the game's differs`);
    });
    if (tied.has(index) !== !!u16(record.record, 0x66))
      out.push(
        `#${index}'s first rope place: ours ${tied.has(index) ? "tied" : "none"}, the game's ${u16(record.record, 0x66) ? "tied" : "none"}`,
      );
  }
  return { differences: out, unpaired: unpaired.length };
}

function checkTim(build: BuildFolder, range: Range): BuildCheck {
  const check: BuildCheck = { lines: [], problems: 0 };
  const exe = readProgram(build);
  const known = GAME_BUILDS.get(exeHash(exe));
  if (!known) {
    check.lines.push({
      error: false,
      text: `${build.folder}: the level recorder doesn't know this TIM.EXE (${exeHash(exe)}), so its puzzle start isn't checked.`,
    });
    return check;
  }
  const files = readResources(build.folder);
  const puzzles = [...files.keys()]
    .map((name) => /^L(\d+)\.LEV$/i.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((n) => within(n, range));
  check.lines.push({
    error: false,
    text: `${build.folder}: ${known.name}, the play screen's entry ${hex(known.enterPlay.segment)}:${hex(known.enterPlay.offset)}, ${puzzles.length} puzzles`,
  });
  const open = gameFiles(build.folder);
  const results: { name: string; differences: string[] }[] = [];
  let unpaired = 0;
  for (const puzzle of puzzles) {
    const name = `L${puzzle}`;
    try {
      const level = readLevel(files.get(`${name}.LEV`)!, { layout: "tim", name: `${name}.LEV` });
      const found = differencesTim(level, loadPuzzle(exe, open, puzzle));
      unpaired += found.unpaired;
      results.push({ name, differences: found.differences });
    } catch (problem) {
      results.push({ name, differences: [`not loaded: ${(problem as Error).message}`] });
    }
  }
  report(check, "puzzles", results);
  if (unpaired)
    check.lines.push({
      error: false,
      text: `  Placed parts not compared, as no one record pairs with them: ${unpaired}`,
    });
  return check;
}

export function inBuild(build: BuildFolder<Game>, given: { range?: Range }): BuildCheck {
  if (build.game === "tim2" || build.game === "toons")
    return checkWithLoader(build as BuildFolder<"tim2" | "toons">, given.range);
  return checkTim(build as BuildFolder, given.range);
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: { jobs: { type: "string" }, puzzles: { type: "string" }, ...folderOptions(GAMES) },
  });
  const builds = buildFolders(values, GAMES);
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");
  let range: Range;
  if (values.puzzles) {
    const [from, to = from] = values.puzzles.split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 1 || to! < from!)
      throw new Error(`--puzzles must be a number or a range like 1-20, not ${values.puzzles}`);
    range = [from!, to!];
  }
  let problems = 0;
  await inEachBuild<BuildCheck, Game>(
    import.meta.url,
    builds,
    (result) => {
      for (const { error, text } of result.lines) (error ? console.error : console.log)(text);
      problems += result.problems;
    },
    // One emulator at a time unless told: TIM's emulator holds the whole game.
    { jobs: values.jobs === undefined ? 1 : jobsOption(values.jobs), given: { range } },
  );
  if (problems) {
    console.error(
      `${problems} problems: puzzles that start otherwise in the game than the Lab says, or that don't load.`,
    );
    process.exitCode = 1;
  } else console.log("Every puzzle starts in the game as the Lab says.");
}
