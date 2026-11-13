/**
 * Sid & Al's Incredible Toons' puzzle goals, read from TOONS.EXE the way TIM 1's are read from TIM.EXE. The run loop
 * calls a dispatcher every step while the goal's countdown word is below 0; the dispatcher calls the routine the
 * puzzle's number picks from a table of 100 far pointers (into an overlay). A goal routine looks at the parts and,
 * when the goal is met, sets the countdown to a number of steps: the run loop counts it down and ends the run as
 * solved when it reaches 0. A table entry of 0 would meet the goal at once.
 *
 * The routines are read with `readGoalRoutines` and said with `describeGoal` and `summariseGoal`, as TIM's. Toons'
 * goals find their parts by calling a routine that gives the n-th part of a type on the lists, and keep them in words
 * of a far segment, which the reader follows through `es`.
 */
import { TOONS_IDS } from "../part-ids.ts";
import { describeGoal, type GoalNames } from "./describe-goals.ts";
import { summariseGoal } from "./goal-conditions.ts";
import type { ProgramGoals } from "./program-goals.ts";
import {
  farWord,
  readGoalRoutines,
  type GoalProblem,
  type GoalRoutine,
  type GoalStatement,
  type GoalValue,
} from "./puzzle-goals.ts";
import { readToonsMemory, type ToonsMemory } from "./toons-drawing.ts";
import { readToonsActions } from "./toons.ts";

const ANY = -1;
const u16 = (data: Uint8Array, at: number) => data[at]! | (data[at + 1]! << 8);
const hex = (value: number) => value.toString(16);

function find(memory: Uint8Array, pattern: readonly number[], from = 0, to = memory.length): number {
  for (let i = from; i + pattern.length <= Math.min(to, memory.length); i++)
    if (pattern.every((b, k) => b === ANY || memory[i + k] === b)) return i;
  return -1;
}

/**
 * The dispatcher: `mov al, [puzzle]; mov ah, 0; shl ax, 1; shl ax, 1; mov bx, ax; mov ax, [bx + table]; or ax,
 * [bx + table + 2]`, the puzzle's number a byte.
 */
const DISPATCHER = [0xa0, ANY, ANY, 0xb4, 0x00, 0xd1, 0xe0, 0xd1, 0xe0, 0x8b, 0xd8, 0x8b, 0x87, ANY, ANY, 0x0b, 0x87];
/**
 * The run loop: `cmp word [countdown], 0; jge; nop; push cs; call dispatcher; cmp word [countdown], 0; jne; mov word
 * [mode], 0x200`, and further on `inc word [steps]`.
 */
const RUN_LOOP = [0x83, 0x3e, ANY, ANY, 0x00, 0x7d, 0x05, 0x90, 0x0e, 0xe8, ANY, ANY, 0x83, 0x3e, ANY, ANY, 0x00, 0x75];
const SET_MODE = [0xc7, 0x06, ANY, ANY, 0x00, 0x02];
const COUNT_STEP = [0xff, 0x06];
/**
 * The puzzle's file name: `mov al, [si + starts + 1]; mov ah, 0; cmp ax, [bp-2]; jle; mov al, [si + starts]`, then
 * `push [bx + names]` for the set's name.
 */
const SETS = [0x8a, 0x84, ANY, ANY, 0xb4, 0x00, 0x3b, 0x46, 0xfe, 0x7e, ANY, 0x8a, 0x84, ANY, ANY];
const SET_NAME = [0xff, 0xb7];

/** A Toons part's record: 0xb3 bytes, as TOONS.EXE allocates it with `calloc(1, 0xb3)` (file offset `0x24b45`). */
const TOONS_PART_SIZE = 0xb3;
const ACTION = 0x0c;
const STATE = 0x0e;

/**
 * Al's and Sid's actions and states in words: an action by the sheet it draws from, and a state, which is a frame
 * number, as a frame of the action the goal tests with it when it falls in that action's frames, like "CATFISH frame
 * 16 of 16". A goal can test a state outside the action's frames (CAKE26: action 16 and state 141), so a state is
 * only named next to its action.
 */
function actionNames(exe: Uint8Array): GoalNames["valueName"] {
  const actions = readToonsActions(exe);
  if (!actions.size) return undefined;
  return (type, offset, value, part) => {
    const own = actions.get(type);
    if (!own) return undefined;
    if (offset === ACTION) return own[value]?.sheet;
    const action = own[part.get(ACTION) ?? -1];
    if (offset !== STATE || !action || value < action.start || value >= action.start + action.frames) return undefined;
    return `${action.sheet} frame ${value - action.start + 1} of ${action.frames}`;
  };
}

/** The fields of a Toons part record the goals read, by offset, as TOONS.EXE's loader and drawing code use them. */
const TOONS_FIELDS: [number, string][] = [
  [0x04, "type"],
  [0x06, "listFlags"],
  [0x08, "drawingFlags"],
  [0x0a, "thirdFlags"],
  [0x0c, "action"],
  [0x0e, "state"],
  [0x14, "control"],
  [0x1f, "positionX"],
  [0x21, "positionY"],
  [0x4d, "width"],
  [0x4f, "height"],
  [0x63, "link1"],
  [0x65, "link2"],
  [0x6b, "plug1"],
  [0x6d, "plug2"],
  [0x6f, "rope1"],
  [0x71, "rope2"],
  [0x95, "savedPositionX"],
  [0x97, "savedPositionY"],
  [0x99, "savedState"],
  [0x9f, "extra"],
  [0xad, "savedSetting"],
  [0xaf, "setting"],
  [0xb1, "linkedPart"],
];

const AL = 36;
const TUNNEL = 46;
const LINKED_PART = 0xb1;

/**
 * What the part a field holds is, by the type that holds it. The word at 0xb1 is the tunnel at the other end for a
 * tunnel (the level reader ties the two, file offset `0x24f45`), and for Al the angel he leaves when shot: at the end
 * of action 16 (CATSHOT, file offset `0x2aac3`) TOONS.EXE makes a new al-e-cat at his place with action 17
 * (CATANGEL) and keeps it there.
 */
function linkName(type: number, offset: number): string | undefined {
  if (offset !== LINKED_PART) return undefined;
  return type === AL ? "angel" : type === TUNNEL ? "tunnel at the other end" : undefined;
}

/**
 * The words at the start of the data segment, which a read through a 0 part finds: Borland's copyright text, which
 * the program never writes (its runtime reports "Null pointer assignment" at exit if anything did).
 */
function fixedWords(toons: ToonsMemory): Map<number, number> {
  const data = toons.dataSegment * 16;
  const text = "Borland C++ - Copyright 1991 Borland Intl.";
  const found = String.fromCharCode(...toons.memory.subarray(data + 4, data + 4 + text.length));
  if (found !== text) return new Map();
  return new Map(Array.from({ length: 4 + text.length - 1 }, (_, k) => [k, u16(toons.memory, data + k)]));
}

export interface ToonsGoalTable {
  /** Where the dispatcher is, as a file offset of TOONS.EXE. */
  dispatcher: number;
  /** Where the table of goal routines is, as a file offset. */
  table: number;
  /** The goal routine of each puzzle, by the puzzle's number from 0 and its level's name. */
  routines: { puzzle: number; name?: string; segment: number; offset: number; address: number }[];
  /** The words the run loop keeps: the game mode, the goal's countdown and the step count. */
  words: { mode?: number; countdown?: number; steps?: number };
}

/** The names of the levels by puzzle number: the set's name and the number in the set, like `CAKE1` and `BRAN20`. */
function levelNames(toons: ToonsMemory): string[] {
  const { memory } = toons;
  let at = find(memory, SETS);
  let names = -1;
  // The program looks a puzzle's set up twice; the place that names the file pushes the set's name after it.
  for (; at >= 0 && names < 0; at = names < 0 ? find(memory, SETS, at + 1) : at)
    names = find(memory, SET_NAME, at, at + 0x20);
  if (at < 0 || names < 0) return [];
  const data = toons.dataSegment * 16;
  const starts = data + u16(memory, at + 13);
  const out: string[] = [];
  for (let set = 0; set < 16; set++) {
    const from = memory[starts + set]!;
    const to = memory[starts + set + 1]!;
    if (to <= from) break;
    const text = data + u16(memory, data + u16(memory, names + 2) + 2 * set);
    let name = "";
    for (let k = text; memory[k] && name.length < 8; k++) name += String.fromCharCode(memory[k]!);
    for (let n = from; n < to; n++) out[n] = `${name}${n - from + 1}`;
  }
  return out;
}

/** Finds the dispatcher, its table of goal routines, the levels they are for and the run loop's words. */
export function findToonsGoalTable(toons: ToonsMemory): ToonsGoalTable | undefined {
  const { memory } = toons;
  const at = find(memory, DISPATCHER);
  if (at < 0) return undefined;
  // The dispatcher starts with `push bp; mov bp, sp` just before.
  const start = at - 3;
  const data = toons.dataSegment * 16;
  const table = data + u16(memory, at + 13);
  const names = levelNames(toons);
  const routines: ToonsGoalTable["routines"] = [];
  const count = names.length || 100;
  for (let puzzle = 0; puzzle < count; puzzle++) {
    const { segment, offset } = toons.resolve(u16(memory, table + 4 * puzzle + 2), u16(memory, table + 4 * puzzle));
    const address = segment * 16 + offset;
    if (!(segment || offset)) continue;
    if (memory[address] !== 0x55 || memory[address + 1] !== 0x8b || memory[address + 2] !== 0xec) break;
    routines.push({ puzzle, ...(names[puzzle] ? { name: names[puzzle] } : {}), segment, offset, address });
  }
  const words: ToonsGoalTable["words"] = {};
  for (let loop = find(memory, RUN_LOOP); loop >= 0; loop = find(memory, RUN_LOOP, loop + 1)) {
    const call = loop + 12 + u16(memory, loop + 10);
    const segment = Math.floor(loop / 16) * 16;
    // The near call's target, in the segment of the run loop: the dispatcher.
    if ((call & 0xffff) !== (start & 0xffff) && (call - segment) % 0x10000 !== (start - segment) % 0x10000) continue;
    words.countdown = u16(memory, loop + 2);
    const mode = find(memory, SET_MODE, loop, loop + 0x30);
    if (mode >= 0) words.mode = u16(memory, mode + 2);
    const steps = find(memory, COUNT_STEP, loop + 0x20, loop + 0x60);
    if (steps >= 0) words.steps = u16(memory, steps + 2);
    break;
  }
  return { dispatcher: toons.fileOffset(start), table: toons.fileOffset(table), routines, words };
}

/** Every word of a far segment the routines read or write, as constant addresses. */
function farWords(routines: Iterable<GoalRoutine | GoalProblem>): number[] {
  const out = new Set<number>();
  const value = (v: GoalValue) => {
    if (v.kind === "word") {
      if (v.address.kind === "constant" && farWord(v.address.value)) out.add(v.address.value);
      value(v.address);
    } else if (v.kind === "binary") {
      value(v.left);
      value(v.right);
    }
  };
  const body = (statements: readonly GoalStatement[]) => {
    for (const s of statements)
      if (s.kind === "set") {
        value(s.target);
        value(s.value);
      } else if (s.kind === "if") {
        value(s.test.left);
        value(s.test.right);
        body(s.then);
        body(s.else);
      } else if (s.kind === "loop") {
        value(s.test.left);
        value(s.test.right);
        body(s.before);
        body(s.body);
      }
  };
  for (const r of routines) if ("body" in r) body(r.body);
  return [...out];
}

/** The routine the goals call to find the n-th part of a type: the one most goals call first. */
export function toonsFinder(routines: ReadonlyMap<number, GoalRoutine | GoalProblem>, goals: ReadonlySet<number>) {
  const counts = new Map<number, number>();
  for (const [address, r] of routines) {
    if (!goals.has(address) || !("body" in r)) continue;
    const first = r.body.flatMap(function calls(s): number[] {
      if (s.kind === "call") return [s.routine];
      if (s.kind === "if") return [...s.then.flatMap(calls), ...s.else.flatMap(calls)];
      if (s.kind === "loop") return [...s.before.flatMap(calls), ...s.body.flatMap(calls)];
      return [];
    })[0];
    if (first !== undefined && !goals.has(first)) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Reads every puzzle's goal from TOONS.EXE, with Toons' part names by type. */
export function readToonsGoals(
  exe: Uint8Array,
  types: ReadonlyMap<number, string> = new Map(Object.entries(TOONS_IDS).map(([t, id]) => [Number(t), id])),
): ProgramGoals {
  const toons = readToonsMemory(exe);
  const table = findToonsGoalTable(toons);
  if (!table?.routines.length) return { problem: "no goal table found", goals: [] };
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines)
    readGoalRoutines(toons.memory, goal.segment, goal.offset, routines, { resolve: toons.resolve, farWords: true });
  const goalAddresses = new Set(table.routines.map((g) => g.address));
  const find = toonsFinder(routines, goalAddresses);
  const routineNames = new Map<number, string>();
  for (const goal of table.routines)
    if (!routineNames.has(goal.address))
      routineNames.set(goal.address, `${goal.name ?? `puzzle ${goal.puzzle}`}'s goal`);
  if (find !== undefined) routineNames.set(find, "the search for the n-th part of a type on the lists");
  const { mode, countdown, steps } = table.words;
  const valueName = actionNames(exe);
  const names: GoalNames = {
    fields: new Map(TOONS_FIELDS),
    partSize: TOONS_PART_SIZE,
    countedLoops: true,
    exactSums: true,
    linkName,
    fixedWords: fixedWords(toons),
    ...(steps !== undefined ? { firstStep: steps } : {}),
    ...(valueName ? { valueName } : {}),
    types,
    lists: [],
    words: new Map([
      ...(mode !== undefined ? ([[mode, "the game mode"]] as const) : []),
      ...(countdown !== undefined ? ([[countdown, "the goal's countdown"]] as const) : []),
      ...(steps !== undefined ? ([[steps, "the step count"]] as const) : []),
      ...farWords(routines.values()).map((address): [number, string] => {
        const { segment, offset } = farWord(address)!;
        return [address, `word 0x${hex(segment)}:${hex(offset).padStart(4, "0")}`];
      }),
    ]),
    ...(countdown !== undefined ? { mode: { word: countdown } } : {}),
    routines: routineNames,
    ...(find !== undefined ? { finder: find } : {}),
  };
  return {
    goals: table.routines.map((goal) => {
      const own = { ...names, routines: new Map([...names.routines!].filter(([a]) => a !== goal.address)) };
      return {
        puzzle: goal.puzzle,
        ...(goal.name ? { name: goal.name } : {}),
        lines: describeGoal(routines, goal.address, own),
        summary: summariseGoal(routines, goal.address, own),
      };
    }),
  };
}
