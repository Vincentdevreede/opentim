/**
 * Finds where the game's level loader puts each field of a level file (step L2 of docs/plans/behaviour-plan-together.md):
 * loads every shipped puzzle of a build the level recorder knows with the game's own puzzle loader (`loadPuzzle` in
 * `src/run/game.ts`), reads the same level with `src/read/level.ts`, and pairs each part of the file with the part
 * record the loader made for it. A file part pairs with a record of its type on the list for its group (fixed parts
 * on the fixed list, moving parts on the moving list) when it is the only one of its type there, or when one record
 * of its type has its flags and its place and the others don't: the place is at 0x8c and 0x8e, as every pair made by
 * type alone shows (`--by-type` pairs that way only). For each field of the file it then lists the words of the record
 * that hold the field's value in every pair (the bytes for a field of one byte), and in how many pairs the value
 * isn't 0, so a field that is always 0 doesn't look found. A field that names another part by its index in the file
 * is compared with the place of that part's record, and -1 with 0.
 *
 * TIM 2 and Toons: TIM2.EXE and TOONS.EXE don't start in the emulator (they ask for EMS memory), so their own level
 * loader runs on its own (`src/run/level-start.ts`), on every level the build ships. Their loader keeps a table of the
 * parts in the file's order, so each part pairs with the record the table holds for it; a link to another part is
 * that part's near place (Toons) or the offset of its far pointer (TIM 2). The files keep no bin.
 *
 * A TIM 1 or Even More build the level recorder doesn't know (`GAME_BUILDS`) isn't checked, and the output says so.
 *
 *   pnpm --filter @opentim/content check-level-fields --tim1 <game folder> --evenmore <game folder>
 *     --tim2 <game folder> --toons <game folder> [--jobs 1] [--puzzles 1-20] [--by-type]
 *
 * `--game <game folder>` still names a TIM 1 or Even More folder. `--puzzles` counts the levels of TIM 2 and Toons
 * from 1 in the order of their names.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { readLevel, type LevelPart } from "../src/read/level.ts";
import { exeHash, GAME_BUILDS, loadPuzzle, PART_RECORD } from "../src/run/game.ts";
import {
  buildFolders,
  folderOptions,
  GAMES,
  readProgram,
  readResources,
  type BuildFolder,
  type Game,
} from "./builds.ts";
import { gameMachine } from "./game-machine.ts";

/** For one field of the file: the record offsets that held its value in every pair so far. */
interface FieldTally {
  pairs: number;
  /** Pairs where the value isn't 0. */
  nonZero: number;
  /** The distinct values seen, up to a few. */
  values: number[];
  /** Offsets of the record whose word equals the value in every pair so far. */
  offsets: number[];
  /** For each offset, the pairs it holds the value in, to show the nearest when none holds it in all. */
  agree: Map<number, number>;
}

interface PuzzleResult {
  puzzle: number;
  /** The level's name, for TIM 2 and Toons. */
  name?: string;
  error?: string;
  /** Each number of the file's header, with the words of the data segment that hold it after loading. */
  header: [string, number, number[]][];
  parts: number;
  paired: number;
  /** The parts in the file's parts bin, and whether the parts bin list after loading has them in the same order. */
  bin: number;
  binInOrder: boolean;
  /**
   * The fields of every paired part: key, value and size, and the record's bytes and place; for a link, the words of
   * the record that point at a record holding the linked part, as "offset+k".
   */
  pairs: {
    index: number;
    type: number;
    group: string;
    fields: [string, number, number][];
    record: number[];
    at: number;
    through: [string, string[]][];
  }[];
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

const words = (record: Uint8Array) =>
  Array.from({ length: PART_RECORD / 2 }, (_, k) => record[2 * k]! | (record[2 * k + 1]! << 8));

/** Fields that name another part of the file by its index. */
const LINK = /^(links|plugs|belt\.parts|ropes\.\d\.parts)\.\d$|^pulley$|^tunnel$/;

function runOne(folder: string, level: Uint8Array, puzzle: number, byType: boolean): PuzzleResult {
  const result: PuzzleResult = { puzzle, header: [], parts: 0, paired: 0, bin: 0, binInOrder: false, pairs: [] };
  try {
    const file = readLevel(level, { layout: "tim", name: `L${puzzle}.LEV` });
    const loaded = loadPuzzle(readFileSync(join(folder, "TIM.EXE")), gameFiles(folder), puzzle);
    const records = loaded.parts.map((p) => ({
      list: p.list,
      words: words(p.record),
      bytes: [...p.record],
      at: p.at,
      used: false,
    }));
    const placed = file.parts.filter((p) => p.group !== "bin");
    result.parts = placed.length;
    const listOf = (p: LevelPart) => (p.group === "static" ? "fixed" : "moving");
    for (const part of placed) {
      const candidates = records.filter((r) => r.list === listOf(part) && r.words[2] === part.type && !r.used);
      // The flags at 0x06 and 0x08 are the file's, as a first look at puzzle 1 shows, and the place at 0x8c and 0x8e.
      const alike = candidates.filter(
        (r) =>
          r.words[3] === part.flags[0] &&
          r.words[4] === part.flags[1] &&
          r.words[0x46] === (part.position.x & 0xffff) &&
          r.words[0x47] === (part.position.y & 0xffff),
      );
      const pick = candidates.length === 1 ? candidates[0] : !byType && alike.length === 1 ? alike[0] : undefined;
      if (!pick) continue;
      pick.used = true;
      result.paired++;
      result.pairs.push({
        index: part.index,
        type: part.type,
        group: part.group,
        fields: part.fields
          .filter((f) => typeof f.value === "number" && f.size <= 2)
          .map(
            (f) => [f.key, (f.value as number) & (f.size === 1 ? 0xff : 0xffff), f.size] as [string, number, number],
          ),
        record: pick.bytes,
        at: pick.at,
        through: [],
      });
    }
    // The parts bin is a list of its own, in the file's order: its fields are tallied as "bin: <field>".
    const bin = file.parts.filter((p) => p.group === "bin");
    result.bin = bin.length;
    result.binInOrder =
      loaded.bin.length === bin.length &&
      bin.every((part, k) => (loaded.bin[k]!.record[4]! | (loaded.bin[k]!.record[5]! << 8)) === part.type);
    if (result.binInOrder)
      bin.forEach((part, k) =>
        result.pairs.push({
          index: part.index,
          type: part.type,
          group: "bin",
          fields: part.fields
            .filter((f) => typeof f.value === "number" && f.size <= 2)
            .map(
              (f) =>
                [`bin: ${f.key}`, (f.value as number) & (f.size === 1 ? 0xff : 0xffff), f.size] as [
                  string,
                  number,
                  number,
                ],
            ),
          record: [...loaded.bin[k]!.record],
          at: loaded.bin[k]!.at,
          through: [],
        }),
      );
    // A link to another part may be kept in a record the part points at, like the belt record at 0x54.
    const segment = loaded.dataSegment;
    const word = (address: number) => segment[address & 0xffff]! | (segment[(address + 1) & 0xffff]! << 8);
    // The header's numbers, and the words of the data segment below the parts that hold each one, at any byte.
    for (const f of file.fields)
      if (typeof f.value === "number" && f.size === 2 && !["magic", "version"].includes(f.key)) {
        const value = f.value & 0xffff;
        const at: number[] = [];
        for (let address = 0; address < 0x8000; address++) if (word(address) === value) at.push(address);
        result.header.push([f.key, value, at]);
      }
    const places = new Map(result.pairs.map((pair) => [pair.index, pair.at]));
    for (const pair of result.pairs)
      for (const [key, value] of pair.fields) {
        if (!LINK.test(key) || value === 0xffff || !places.has(value)) continue;
        const target = places.get(value)!;
        const found: string[] = [];
        for (let offset = 0; offset < PART_RECORD; offset += 2) {
          const pointer = word(pair.at + offset);
          if (pointer < 0x100) continue;
          for (let k = 0; k < 0x10; k += 2)
            if (word(pointer + k) === target) found.push(`0x${offset.toString(16)}+${k}`);
        }
        pair.through.push([key, found]);
      }
  } catch (problem) {
    result.error = problem instanceof Error ? problem.message : String(problem);
  }
  return result;
}

/**
 * TIM 2 and Toons: every level of the build loaded by the game's own loader, each part paired with the record the
 * loader's table holds for it.
 */
function runLoader(build: BuildFolder<"toons" | "tim2">, byType: boolean, range?: [number, number]) {
  const found = gameMachine(build);
  if ("problem" in found) return { problem: found.problem };
  const { machine, start, program } = found;
  const files = readResources(build.folder);
  const names = [...files.keys()].filter((name) => /\.LEV$/i.test(name)).sort();
  const results: PuzzleResult[] = [];
  const data = program.dataSegment * 16;
  const header = new Map<string, number[]>();
  names.forEach((name, k) => {
    if (range && (k + 1 < range[0] || k + 1 > range[1])) return;
    const result: PuzzleResult = {
      puzzle: k + 1,
      name: name.replace(/\.LEV$/i, ""),
      header: [],
      parts: 0,
      paired: 0,
      bin: 0,
      binInOrder: true,
      pairs: [],
    };
    results.push(result);
    try {
      const file = readLevel(files.get(name)!, { layout: build.game, name });
      const { loaded } = machine.run(files.get(name)!, name, file.parts.length, null);
      const memory = loaded.memory;
      const word = (at: number) => memory[at]! | (memory[at + 1]! << 8);
      result.parts = file.parts.length;
      for (const part of file.parts) {
        const at = loaded.pool[part.index];
        const record = at ? loaded.records.get(at) : undefined;
        // By type alone, a part pairs only with the one record of its type.
        if (!at || !record || (byType && file.parts.filter((p) => p.type === part.type).length > 1)) continue;
        if ((record[start.game === "tim2" ? 8 : 4]! | (record[start.game === "tim2" ? 9 : 5]! << 8)) !== part.type)
          continue;
        result.paired++;
        result.pairs.push({
          index: part.index,
          type: part.type,
          group: part.group,
          fields: part.fields
            .filter((f) => typeof f.value === "number" && f.size <= 2)
            .map(
              (f) => [f.key, (f.value as number) & (f.size === 1 ? 0xff : 0xffff), f.size] as [string, number, number],
            ),
          record: [...record],
          at: loaded.pointers[part.index]!,
          through: [],
        });
      }
      // The header's numbers in the data segment's words, below the runner's own file, name and stack. Only the
      // words that held each number in every level so far are kept, for every level, so memory stays small.
      for (const f of file.fields)
        if (typeof f.value === "number" && f.size === 2 && !["magic", "version"].includes(f.key)) {
          const value = f.value & 0xffff;
          const before = header.get(f.key) ?? Array.from({ length: 0xe000 }, (_, address) => address);
          const at = before.filter((address) => word(data + address) === value);
          header.set(f.key, at);
          result.header.push([f.key, value, at]);
        }
      for (const r of results) for (const entry of r.header) entry[2] = header.get(entry[0]) ?? entry[2];
      // A link kept one record further: a near pointer (Toons) or a far one (TIM 2) in the record.
      const places = new Map(result.pairs.map((pair) => [pair.index, pair.at]));
      for (const pair of result.pairs) {
        const own = loaded.pool[pair.index]!;
        for (const [key, value] of pair.fields) {
          if (!LINK.test(key) || value === 0xffff || !places.has(value)) continue;
          const target = places.get(value)!;
          const found: string[] = [];
          for (let offset = 0; offset < start.partSize - 1; offset++) {
            // A near pointer into the data segment, and in TIM 2 also a far one.
            const ways: [string, number][] = [["", word(own + offset) >= 0x100 ? data + word(own + offset) : 0]];
            if (start.far && offset < start.partSize - 3)
              ways.push([" far", word(own + offset + 2) * 16 + word(own + offset)]);
            for (const [kind, pointer] of ways) {
              if (!pointer || pointer + 0x10 > memory.length) continue;
              for (let k = 0; k < 0x10; k += 2)
                if (word(pointer + k) === target) found.push(`0x${offset.toString(16)}+${k}${kind}`);
            }
          }
          pair.through.push([key, found]);
        }
      }
    } catch (problem) {
      result.error = problem instanceof Error ? problem.message : String(problem);
    }
  });
  return { results, size: start.partSize };
}

/** TIM 1 and Even More: the shipped puzzles of a build the recorder knows, loaded on worker threads. */
async function runRecorder(folder: string, jobs: number, byType: boolean, range?: [number, number]) {
  const files = readResources(folder);
  let puzzles = [...files.keys()]
    .map((name) => /^L(\d+)\.LEV$/i.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (range) puzzles = puzzles.filter((p) => p >= range[0] && p <= range[1]);
  if (!puzzles.length) throw new Error("no puzzles to load");
  const level = (puzzle: number) => files.get(`L${puzzle}.LEV`)!;
  const results: PuzzleResult[] = [];
  // A worker that fails is reported with the puzzles it gave no result for, after all workers have stopped.
  const workerErrors: unknown[] = [];
  const lanes = Array.from({ length: Math.min(jobs, puzzles.length) }, (_, lane) =>
    puzzles.filter((_, k) => k % jobs === lane),
  );
  await Promise.all(
    lanes.map(
      (share) =>
        new Promise<void>((done) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { folder, jobs: share.map((puzzle) => ({ puzzle, level: level(puzzle) })), byType },
          });
          worker.on("message", (result: PuzzleResult) => results.push(result));
          worker.once("error", (error) => workerErrors.push(error));
          worker.once("exit", () => done());
        }),
    ),
  );
  results.sort((a, b) => a.puzzle - b.puzzle);
  return { results, puzzles, workerErrors };
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** Prints where each field went, the bin, the header's words and the links kept further; gives the failures. */
function report(results: PuzzleResult[], size: number, hasBin: boolean, headerLimit: string, packed = false): number {
  const tallies = new Map<string, FieldTally>();
  for (const r of results) {
    const places = new Map(r.pairs.map((pair) => [pair.index, pair.at]));
    for (const pair of r.pairs)
      for (const [field, value, width] of pair.fields) {
        // A link to another part is that part's record, when it is paired; -1 is none.
        const link = LINK.test(field);
        if (link && value !== 0xffff && !places.has(value)) continue;
        const expected = link ? (value === 0xffff ? 0 : places.get(value)!) : value;
        // A link to none and a link to a part are tallied apart: the loader may fill a link the file leaves as none.
        const key = link && value === 0xffff ? `${field} (none)` : field;
        let tally = tallies.get(key);
        if (!tally) {
          // TIM 1 keeps its words at even places; Toons' and TIM 2's records are packed, so a word can start anywhere.
          const step = width === 1 || packed ? 1 : 2;
          const places = packed ? size - (width - 1) : Math.floor(size / step);
          const offsets = Array.from({ length: places }, (_, k) => k * step);
          tally = { pairs: 0, nonZero: 0, values: [], offsets, agree: new Map(offsets.map((o) => [o, 0])) };
          tallies.set(key, tally);
        }
        tally.pairs++;
        if (value && value !== 0xffff) tally.nonZero++;
        if (tally.values.length < 6 && !tally.values.includes(value)) tally.values.push(value);
        const at = (offset: number) =>
          width === 1 ? pair.record[offset]! : pair.record[offset]! | ((pair.record[offset + 1] ?? 0) << 8);
        tally.offsets = tally.offsets.filter((offset) => at(offset) === expected);
        for (const offset of tally.agree.keys())
          if (at(offset) === expected) tally.agree.set(offset, tally.agree.get(offset)! + 1);
      }
  }
  // Links kept one record further: the "offset+k" ways that hold the linked part in every pair with such a link.
  const through = new Map<string, { pairs: number; ways: string[]; agree: Map<string, number> }>();
  for (const r of results)
    for (const pair of r.pairs)
      for (const [key, found] of pair.through) {
        let tally = through.get(key);
        if (!tally) {
          tally = { pairs: 0, ways: found, agree: new Map() };
          through.set(key, tally);
        }
        tally.pairs++;
        tally.ways = tally.ways.filter((way) => found.includes(way));
        for (const way of found) tally.agree.set(way, (tally.agree.get(way) ?? 0) + 1);
      }
  // The header: the words that hold each number in every puzzle.
  const header = new Map<string, { puzzles: number; values: Set<number>; at: number[] }>();
  for (const r of results)
    for (const [key, value, at] of r.header) {
      const tally = header.get(key);
      if (!tally) header.set(key, { puzzles: 1, values: new Set([value]), at });
      else {
        tally.puzzles++;
        tally.values.add(value);
        const here = new Set(at);
        tally.at = tally.at.filter((address) => here.has(address));
      }
    }
  const failed = results.filter((r) => r.error);
  for (const r of failed) console.error(`${r.name ?? `Puzzle ${r.puzzle}`}: ${r.error}`);
  for (const [key, tally] of [...tallies].sort(([a], [b]) => a.localeCompare(b))) {
    const nearest = [...tally.agree]
      .filter(([, n]) => n >= tally.pairs / 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([offset, n]) => `${hex(offset)} in ${n}`)
      .join(", ");
    const where = tally.offsets.length
      ? tally.offsets.slice(0, 8).map(hex).join(", ") +
        (tally.offsets.length > 8 ? `, ... (${tally.offsets.length})` : "")
      : `no word in every pair${nearest ? `; nearest ${nearest}` : ""}`;
    console.log(
      `${key.padEnd(24)} ${String(tally.pairs).padStart(5)} pairs, ${String(tally.nonZero).padStart(5)} not 0, ` +
        `values ${tally.values.map(hex).join(" ")}${tally.values.length >= 6 ? " ..." : ""}: in the record at ${where}`,
    );
  }
  if (hasBin) {
    const binParts = results.reduce((n, r) => n + r.bin, 0);
    const binOut = results.filter((r) => !r.error && !r.binInOrder);
    console.log(
      `Parts bin: ${binParts} parts; the parts bin list holds the file's bin in its order in ${results.length - failed.length - binOut.length} puzzles` +
        (binOut.length ? `, not in ${binOut.map((r) => r.puzzle).join(", ")}` : ""),
    );
  } else console.log("Parts bin: the files keep no bin; check-puzzle-start checks what the puzzle start puts there.");
  console.log(`Header numbers in the data segment's words (below ${headerLimit}) after loading:`);
  for (const [key, tally] of header) {
    const where = tally.at.length
      ? tally.at.slice(0, 6).map(hex).join(", ") + (tally.at.length > 6 ? `, ... (${tally.at.length})` : "")
      : "nowhere";
    console.log(
      `${key.padEnd(24)} ${String(tally.puzzles).padStart(4)} puzzles, ${tally.values.size} values: ${where}`,
    );
  }
  console.log("Links kept in a record the part points at (record word + place in that record):");
  for (const [key, tally] of [...through].sort(([a], [b]) => a.localeCompare(b)))
    console.log(
      `${key.padEnd(24)} ${String(tally.pairs).padStart(5)} links: ${
        tally.ways.join(", ") ||
        `none in every link; nearest ${
          [...tally.agree]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([way, n]) => `${way} in ${n}`)
            .join(", ") || "none"
        }`
      }`,
    );
  return failed.length;
}

if (!isMainThread) {
  const { folder, jobs, byType } = workerData as {
    folder: string;
    jobs: { puzzle: number; level: Uint8Array }[];
    byType: boolean;
  };
  for (const { puzzle, level } of jobs) parentPort!.postMessage(runOne(folder, level, puzzle, byType));
} else {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      game: { type: "string", multiple: true },
      jobs: { type: "string" },
      puzzles: { type: "string" },
      "by-type": { type: "boolean", default: false },
      ...folderOptions(GAMES),
    },
  });
  const count = (option: string, text: string) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${option} must be a whole number above 0, not ${text}`);
    return n;
  };
  // One emulator at a time unless told: a run with four at once took a machine down.
  const jobs = values.jobs ? count("jobs", values.jobs) : 1;
  let range: [number, number] | undefined;
  if (values.puzzles) {
    const [from, to = from] = values.puzzles.split("-").map((n) => count("puzzles", n));
    range = [from!, to!];
  }
  // `--game` is a TIM 1 or Even More folder; which of the two the recorder says.
  const named = (values.game ?? []).map((folder): BuildFolder<Game> => {
    const known = GAME_BUILDS.get(exeHash(readFileSync(join(resolve(folder), "TIM.EXE"))));
    return { game: known?.name.startsWith("Even More") ? "evenmore" : "tim1", folder: resolve(folder), index: 0 };
  });
  const builds = [...buildFolders(values, GAMES), ...named];
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");
  let problems = 0;
  for (const build of builds) {
    if (build.game === "tim2" || build.game === "toons") {
      const run = runLoader(build as BuildFolder<"tim2" | "toons">, values["by-type"], range);
      if ("problem" in run) {
        console.error(`${build.folder}: ${run.problem}, so the levels aren't loaded.`);
        problems++;
        continue;
      }
      const { results, size } = run;
      const parts = results.reduce((n, r) => n + r.parts, 0);
      const paired = results.reduce((n, r) => n + r.paired, 0);
      console.log(
        `${build.folder}: ${results.filter((r) => !r.error).length} levels loaded by the game's loader, ` +
          `${paired} of ${parts} parts paired`,
      );
      problems += report(results, size, false, "0xe000", true);
      continue;
    }
    const program = readProgram(build);
    const known = GAME_BUILDS.get(exeHash(program));
    if (!known) {
      console.log(
        `${build.folder}: the level recorder doesn't know this TIM.EXE (${exeHash(program)}), so its loader isn't checked.`,
      );
      continue;
    }
    const { results, puzzles, workerErrors } = await runRecorder(build.folder, jobs, values["by-type"], range);
    const failed = results.filter((r) => r.error);
    const parts = results.reduce((n, r) => n + r.parts, 0);
    const paired = results.reduce((n, r) => n + r.paired, 0);
    console.log(
      `${known.name}: ${results.length - failed.length} puzzles loaded, ${paired} of ${parts} placed parts paired`,
    );
    problems += report(results, PART_RECORD, true, "0x8000");
    const missing = puzzles.filter((p) => !results.some((r) => r.puzzle === p));
    if (missing.length) console.error(`Puzzles that gave no result: ${missing.join(", ")}`);
    for (const error of workerErrors) console.error("A worker failed:", error);
    problems += missing.length + workerErrors.length;
  }
  if (problems) process.exitCode = 1;
}
