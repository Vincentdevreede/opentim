/**
 * Finds where the game's level loader puts each field of a level file (step L2 of docs/behaviour-plan-together.md):
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
 *   pnpm --filter @opentim/content check-level-fields --game <game folder> [--jobs <n>] [--puzzles 1-20]
 */
import { readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { readLevel, type LevelPart } from "../src/read/level.ts";
import { exeHash, GAME_BUILDS, loadPuzzle, PART_RECORD } from "../src/run/game.ts";
import { readResources } from "./builds.ts";

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
  error?: string;
  /** Each number of the file's header, with the words of the data segment that hold it after loading. */
  header: [string, number, number[]][];
  parts: number;
  paired: number;
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
  const result: PuzzleResult = { puzzle, header: [], parts: 0, paired: 0, pairs: [] };
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

if (!isMainThread) {
  const { folder, jobs, byType } = workerData as {
    folder: string;
    jobs: { puzzle: number; level: Uint8Array }[];
    byType: boolean;
  };
  for (const { puzzle, level } of jobs) parentPort!.postMessage(runOne(folder, level, puzzle, byType));
} else {
  const { values } = parseArgs({
    options: {
      game: { type: "string" },
      jobs: { type: "string" },
      puzzles: { type: "string" },
      "by-type": { type: "boolean", default: false },
    },
  });
  if (!values.game) throw new Error("--game <game folder> is needed");
  const folder = resolve(values.game);
  const program = readFileSync(join(folder, "TIM.EXE"));
  const build = GAME_BUILDS.get(exeHash(program));
  if (!build) throw new Error(`${folder}: the level recorder doesn't know this TIM.EXE (${exeHash(program)})`);
  const count = (option: string, text: string) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${option} must be a whole number above 0, not ${text}`);
    return n;
  };
  const jobs = values.jobs ? count("jobs", values.jobs) : Math.max(1, availableParallelism() - 1);
  const files = readResources(folder);
  let puzzles = [...files.keys()]
    .map((name) => /^L(\d+)\.LEV$/i.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (values.puzzles) {
    const [from, to = from] = values.puzzles.split("-").map((n) => count("puzzles", n));
    puzzles = puzzles.filter((p) => p >= from! && p <= to!);
  }
  if (!puzzles.length) throw new Error("no puzzles to load");
  const level = (puzzle: number) => files.get(`L${puzzle}.LEV`)!;
  const results: PuzzleResult[] = [];
  const lanes = Array.from({ length: Math.min(jobs, puzzles.length) }, (_, lane) =>
    puzzles.filter((_, k) => k % jobs === lane),
  );
  await Promise.all(
    lanes.map(
      (share) =>
        new Promise<void>((done, fail) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: {
              folder,
              jobs: share.map((puzzle) => ({ puzzle, level: level(puzzle) })),
              byType: values["by-type"],
            },
          });
          worker.on("message", (result: PuzzleResult) => results.push(result));
          worker.once("error", fail);
          worker.once("exit", () => done());
        }),
    ),
  );
  results.sort((a, b) => a.puzzle - b.puzzle);

  const tallies = new Map<string, FieldTally>();
  for (const r of results) {
    const places = new Map(r.pairs.map((pair) => [pair.index, pair.at]));
    for (const pair of r.pairs)
      for (const [field, value, size] of pair.fields) {
        // A link to another part is that part's record, when it is paired; -1 is none.
        const link = LINK.test(field);
        if (link && value !== 0xffff && !places.has(value)) continue;
        const expected = link ? (value === 0xffff ? 0 : places.get(value)!) : value;
        // A link to none and a link to a part are tallied apart: the loader may fill a link the file leaves as none.
        const key = link && value === 0xffff ? `${field} (none)` : field;
        let tally = tallies.get(key);
        if (!tally) {
          const step = size === 1 ? 1 : 2;
          const offsets = Array.from({ length: PART_RECORD / step }, (_, k) => k * step);
          tally = { pairs: 0, nonZero: 0, values: [], offsets, agree: new Map(offsets.map((o) => [o, 0])) };
          tallies.set(key, tally);
        }
        tally.pairs++;
        if (value && value !== 0xffff) tally.nonZero++;
        if (tally.values.length < 6 && !tally.values.includes(value)) tally.values.push(value);
        const at = (offset: number) =>
          size === 1 ? pair.record[offset]! : pair.record[offset]! | (pair.record[offset + 1]! << 8);
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
  const parts = results.reduce((n, r) => n + r.parts, 0);
  const paired = results.reduce((n, r) => n + r.paired, 0);
  console.log(
    `${build.name}: ${results.length - failed.length} puzzles loaded, ${paired} of ${parts} placed parts paired`,
  );
  for (const r of failed) console.error(`Puzzle ${r.puzzle}: ${r.error}`);
  const hex = (n: number) => `0x${n.toString(16)}`;
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
  console.log("Header numbers in the data segment's words (below 0x8000) after loading:");
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
  if (failed.length) process.exitCode = 1;
}
