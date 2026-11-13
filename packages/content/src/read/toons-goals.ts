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
import { summariseGoal, type GoalCondition } from "./goal-conditions.ts";
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
import type { Level } from "./level.ts";
import { findToonsTypeTable, loadImage, readToonsActions, TOONS_RECORD_SIZE } from "./toons.ts";

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

/** Types TOONS.EXE puts on a list before the other parts of their kind, whatever their place: the rope and type 76. */
const FIRST_OF_THEIR_KIND = [14, 76];
/** Where the type record keeps the word a parts list is sorted by. */
const LIST_KIND = 0x02;

/**
 * The word of each type's record a parts list is sorted by (TIM 1 keeps the mass there): most fixed types have one of
 * their own from 1000 up, and the moving ones their mass. Empty when the type table isn't found.
 */
export function readToonsListKinds(exe: Uint8Array): Map<number, number> {
  try {
    const image = loadImage(exe);
    const { start, count } = findToonsTypeTable(image);
    const kinds = new Map<number, number>();
    for (let type = 0; type < count; type++) {
      const at = start + type * TOONS_RECORD_SIZE + LIST_KIND;
      const word = image[at]! | (image[at + 1]! << 8);
      kinds.set(type, word >= 0x8000 ? word - 0x10000 : word);
    }
    return kinds;
  } catch {
    return new Map();
  }
}

/** Where the type record keeps the word the parts bin is sorted by. */
const BIN_KIND = 0x2a;

/**
 * The word of each type's record the parts bin (the third list) is sorted by, as TOONS.EXE sets it when it starts: a
 * start-up routine (file offset `0x25b9c`, called at `0x26004` among the routines that load the program's resources)
 * goes along a table of the 85 types in the data (`0x3b6a:0x48`) and writes each type's place in it into the type's
 * record at 0x2a, over the number the file has there (mostly the type's own). So the bin is sorted by that table:
 * Al, Sid and the dragon first, the inclines last. Found by the routine's code: `mov ax, segment; mov es, ax; mov ax,
 * es:[bx + table]; mov dx, 70; imul dx; ...; mov es:[bx + record + 0x2a], cx`. Empty when it isn't found.
 */
export function readToonsBinKinds(exe: Uint8Array): Map<number, number> {
  try {
    const image = loadImage(exe);
    const { start, count } = findToonsTypeTable(image);
    // prettier-ignore
    const code = [0xb8, ANY, ANY, 0x8e, 0xc0, 0x26, 0x8b, 0x87, ANY, ANY, 0xba, 0x46, 0x00, 0xf7, 0xea, 0xba, ANY, ANY,
      0x8b, 0xd8, 0x8e, 0xc2, 0x26, 0x89, 0x8f, ANY, ANY];
    for (let at = find(image, code); at >= 0; at = find(image, code, at + 1)) {
      if (u16(image, at + 16) * 16 + u16(image, at + 25) - BIN_KIND !== start) continue;
      const table = u16(image, at + 1) * 16 + u16(image, at + 8);
      const kinds = new Map<number, number>();
      for (let place = 0; place < count; place++) kinds.set(u16(image, table + 2 * place), place);
      return kinds;
    }
  } catch {
    // No type table: no sort words.
  }
  return new Map();
}

/**
 * A Toons level's list in the order TOONS.EXE keeps it, as level part indices, so a goal's "the 1st al-e-cat on the
 * moving list" is a part of the level. The level loader (file offset `0x2507c`) reads the parts of each list in file
 * order and puts each on its list with one routine (`0xbcd1`), which the game also uses when the player puts a part
 * back. That routine keeps the list sorted by the type record's word at 0x02 (`kinds`), lowest first, and goes along
 * the parts of the same word until one starts higher up (its `savedPositionY` smaller), or at the same height further
 * left; the new part goes before that one. A rope or a part of type 76 goes before the first part of its word, and
 * so does a part right after one of those. The places are the file's: a part the player puts on the board from the
 * bin goes where its new place puts it (see `toonsGoalParts`). Empty for a list the file doesn't have.
 */
export function toonsListOrder(level: Level, lists: string, kinds: ReadonlyMap<number, number>): number[] {
  const group = lists === "the fixed list" ? "static" : lists === "the moving list" ? "moving" : undefined;
  if (!group) return [];
  const list: Level["parts"] = [];
  for (const part of level.parts.filter((p) => p.group === group)) {
    const kind = kinds.get(part.type) ?? 0;
    // The list's head is a part record of its own whose type is 0.
    let before = 0;
    let k = 0;
    for (; k < list.length; k++) {
      const at = list[k]!;
      const own = kinds.get(at.type) ?? 0;
      const goesBefore =
        kind === own
          ? FIRST_OF_THEIR_KIND.includes(before) ||
            FIRST_OF_THEIR_KIND.includes(part.type) ||
            at.position.y < part.position.y ||
            (at.position.y === part.position.y && at.position.x < part.position.x)
          : kind < own;
      if (goesBefore) break;
      before = at.type;
    }
    list.splice(k, 0, part);
  }
  return list.map((p) => p.index);
}

/** Bit 0x40 of the third flag word: the part stays where the file puts it, and the player can neither move nor change it. */
const FIXED_IN_PLACE = 0x40;

/** The Toons types the puzzle setup treats on their own. */
const TOONS_BELT = 1;
const TOONS_SWITCH = 2;
const TOONS_ROPE = 14;
const TOONS_PULLEY = 17;
const TOONS_TUNNEL = 46;
const TOONS_ANVIL = 61;
/** Bits 0x1 and 0x2 of the third flag word: the part plugs into another (0x1) or takes plugs itself (0x2). */
const PLUGS_IN = 0x1;
const TAKES_PLUGS = 0x2;

/** A plug the puzzle setup pulls out: `part` was plugged into place `place` (0 or 1) of `into`. */
export interface ToonsUnplug {
  part: number;
  into: number;
  place: number;
}

/** Where the parts are when a Toons puzzle starts, as TOONS.EXE's puzzle setup leaves them. */
export interface ToonsPuzzleStart {
  /** The parts in the bin, by index in the level. Every other part is on the board, except the `gone` ones. */
  bin: Set<number>;
  /** The bin in the order TOONS.EXE keeps it, the third list. */
  binOrder: number[];
  /** Tunnels the setup takes off the board and frees: the other end of a tunnel it puts in the bin. */
  gone: Set<number>;
  /** The plugs the setup pulls out, in the order it pulls them. */
  unplugged: ToonsUnplug[];
  /** Each part's two plugs after the setup, for the parts whose plugs it changes. */
  plugs: Map<number, [number | null, number | null]>;
  /**
   * The state the setup leaves a part on the board with, where it changes it: the frame the part is drawn with while
   * the player builds. Only the types whose routine is read: the electric switch and the anvil.
   */
  states: Map<number, number>;
}

/**
 * Which parts TOONS.EXE has in the bin when a puzzle starts, in its order, and what that changes on the board. Its
 * puzzle setup (file offset `0x25829`) walks the moving list and then the fixed list, in the order the level loader
 * leaves them (`toonsListOrder`), and puts every part without bit 0x40 of its third flag word in the bin through the
 * routine of the player's bin handle (`0x281c9`). That routine puts the part on the third list (`0xbe19`) and then
 * takes off what the part holds (`0xbb07`), in this order:
 *
 * - the plugs (`0xb7b3`, for a part with bit 0x1 or 0x2 of its third flag word). A part that plugs into another is
 *   pulled out: the other's plug at the part's plug place and the part's own plug are cleared. A part that takes plugs
 *   lets go of both. The part on the board stays where it is; its type's routine (the record's far pointer at 0x36)
 *   sets its state again, and the routine keeps that state as the one it starts from;
 * - a belt round it, untied at both ends and put in the bin (`0xb88c`, which puts it there at `0xb8f8`). Untying it
 *   clears bit 0x2 of both parts' second flag word, which only says a belt runs round the part: a belt end the player
 *   drops takes a part without it (`0xb0eb`). No drawing code reads it, so the parts look the same;
 * - the ropes tied to it, its first rope place first, each untied at both ends and put in the bin (`0xb902`, at
 *   `0xbabf`). Untying runs the type routine of both parts the rope ties, and clears the links of the pulleys between
 *   the first end and the second.
 *
 * A tunnel first takes the tunnel at its other end off its list and frees it (`0x28253`, `0x23fa8`), so the bin holds
 * one tunnel of the pair, and when the player puts it on the board TOONS.EXE makes a new other end (`0x27fbb`). The
 * setup skips ropes and belts themselves (`0x25892`), so a rope or a belt whose two parts stay on the board stays
 * there, tied. Before it puts a pulley in the bin, it follows the pulley's first links to a part linked back to the
 * last pulley and puts the rope tied there in the bin first (`0x258ac`).
 *
 * The third list is kept sorted by the type record's word at 0x2a (`binKinds`, `readToonsBinKinds`), lowest first;
 * the insertion routine (`0xbcd1`) puts a part before the first one with a higher word, so parts of a type stay in the
 * order the setup puts them there. Without `binKinds` the type's number stands in for the word, which is the file's
 * own word for most types but not the one TOONS.EXE sorts by. `kinds` (the list's sort words) only decide the order
 * the setup walks the lists in; without them it is the order by place alone.
 *
 * The type routines that set a state again are read for two types: the electric switch takes 1 for a plug in its first
 * place and 2 for one in its second, and keeps bit 4 (file offset `0x6f461`); the anvil takes 1 while a rope is tied at
 * its first place, else 0 (`0x5382b`). These are the only parts on the board whose state the setup changes in the
 * shipped levels, as the setup run on the CPU shows. The anvil's routine leaves the state it starts from at 1, and the
 * reset after the setup (`0xec1e`, called at `0x22911`) runs the routine again and keeps its 0 there. That the board
 * is drawn with that 0 is a decided assumption ("Toons: assumptions" in docs/research/levels.md).
 */
export function toonsPuzzleStart(
  level: Level,
  kinds: ReadonlyMap<number, number> = new Map(),
  binKinds?: ReadonlyMap<number, number>,
): ToonsPuzzleStart {
  const parts = level.parts;
  const bin = new Set<number>();
  const inserted: number[] = [];
  const gone = new Set<number>();
  const unplugged: ToonsUnplug[] = [];
  const states = new Map<number, number>();
  const tunnels = new Map(parts.map((p) => [p.index, p.tunnel ?? null]));
  const links = new Map(parts.map((p) => [p.index, [...p.links] as (number | null)[]]));
  const plugs = new Map(parts.map((p) => [p.index, [...(p.plugs ?? [null, null])] as [number | null, number | null]]));
  const changedPlugs = new Set<number>();
  // The rope at each rope place of each part, as the rope part that owns the rope's record, and each record's ends.
  const ropeAt = new Map<number, (number | null)[]>(parts.map((p) => [p.index, [null, null]]));
  const ends = new Map<string, { parts: (number | null)[]; slots: number[] }>();
  // The belt part whose belt runs round each part.
  const beltAt = new Map<number, number>();
  for (const p of parts) {
    p.ropes.forEach((place, k) => {
      if (!place.rope) return;
      ropeAt.get(p.index)![k] = p.index;
      ends.set(`${p.index}.${k}`, { parts: [...place.rope.parts], slots: [...place.rope.slots] });
      place.rope.parts.forEach((end, j) => {
        const at = end === null ? undefined : ropeAt.get(end);
        if (at && place.rope!.slots[j]! < 2) at[place.rope!.slots[j]!] = p.index;
      });
    });
    if (p.type === TOONS_BELT && p.belt.parts)
      for (const end of p.belt.parts) if (end !== null) beltAt.set(end, p.index);
  }
  // A pulley keeps the rope over it at its second rope place: the level reader takes the record at the first place of
  // the part the pulley's field names (`0x24f3c`).
  for (const p of parts)
    if (p.type === TOONS_PULLEY && p.pulley !== null && p.pulley !== undefined)
      ropeAt.get(p.index)![1] = ropeAt.get(p.pulley)?.[0] ?? null;
  const state = (index: number) => states.get(index) ?? parts[index]!.state[0];
  const fixed = (index: number) => ((parts[index]!.flags[2] ?? 0) & FIXED_IN_PLACE) !== 0;
  const toBin = (index: number) => {
    if (bin.has(index)) return;
    bin.add(index);
    inserted.push(index);
  };
  // The type routine at the record's far pointer 0x36, for the types it is read for.
  const look = (index: number) => {
    if (bin.has(index)) return;
    const part = parts[index]!;
    if (part.type === TOONS_SWITCH) {
      const [first, second] = plugs.get(index)!;
      states.set(index, (state(index) & 4) | (first !== null ? 1 : 0) | (second !== null ? 2 : 0));
    } else if (part.type === TOONS_ANVIL) states.set(index, ropeAt.get(index)![0] !== null ? 1 : 0);
  };
  const unplug = (index: number) => {
    const own = plugs.get(index)!;
    if ((parts[index]!.flags[2] ?? 0) & TAKES_PLUGS) {
      own.forEach((other, place) => {
        if (other === null) return;
        own[place] = null;
        plugs.get(other)![0] = null;
        changedPlugs.add(index).add(other);
        unplugged.push({ part: other, into: index, place });
        look(other);
      });
      look(index);
      return;
    }
    const into = own[0];
    if (into === null) return;
    const place = parts[index]!.plugPlace ?? 0;
    plugs.get(into)![place] = null;
    own[0] = null;
    changedPlugs.add(index).add(into);
    unplugged.push({ part: index, into, place });
    look(index);
    look(into);
  };
  const untieRope = (rope: number) => {
    for (const k of [0, 1]) {
      const record = ends.get(`${rope}.${k}`);
      if (!record) continue;
      const [first, second] = record.parts;
      if (first !== null && first !== undefined) {
        const place = record.slots[0]!;
        if (place < 2) ropeAt.get(first)![place] = null;
        const own = links.get(first)!;
        let pulley = own[place] ?? null;
        own[place] = null;
        const seen = new Set<number>();
        while (pulley !== null && parts[pulley]?.type === TOONS_PULLEY && !seen.has(pulley)) {
          seen.add(pulley);
          const next = links.get(pulley)![0] ?? null;
          links.set(pulley, [null, null]);
          ropeAt.get(pulley)![1] = null;
          pulley = next;
        }
        look(first);
      }
      if (second !== null && second !== undefined) {
        const place = record.slots[1]!;
        if (place < 2) ropeAt.get(second)![place] = null;
        links.get(second)![place] = null;
        look(second);
      }
      record.parts = [null, null];
      toBin(rope);
    }
  };
  // The routine of the bin handle, for a part that is neither a rope nor a belt.
  const putInBin = (index: number) => {
    const part = parts[index]!;
    const other = tunnels.get(index);
    if (part.type === TOONS_TUNNEL && other !== null && other !== undefined) {
      tunnels.set(index, null);
      tunnels.set(other, null);
      gone.add(other);
    }
    toBin(index);
    if ((part.flags[2] ?? 0) & (PLUGS_IN | TAKES_PLUGS)) unplug(index);
    const belt = beltAt.get(index);
    if (belt !== undefined) {
      for (const end of parts[belt]!.belt.parts ?? []) if (end !== null) beltAt.delete(end);
      toBin(belt);
    }
    if (part.type === TOONS_PULLEY) {
      // The parts on either side of the pulley are linked to each other.
      const [a, b] = links.get(index)!;
      if (a !== null && a !== undefined) {
        const own = links.get(a)!;
        const k = own.indexOf(index);
        if (k >= 0) own[k] = b ?? null;
      }
      if (b !== null && b !== undefined) {
        const own = links.get(b)!;
        const k = own.indexOf(index);
        if (k >= 0) own[k] = a ?? null;
      }
      links.set(index, [null, null]);
      ropeAt.get(index)![1] = null;
      return;
    }
    for (const k of [0, 1]) {
      const rope = ropeAt.get(index)![k];
      if (rope !== null && rope !== undefined) untieRope(rope);
    }
  };
  // The rope over a pulley, as the setup finds it: along the first links to a part linked back.
  const ropeOver = (pulley: number): number | undefined => {
    const seen = new Set<number>();
    for (let at = pulley; parts[at]?.type === TOONS_PULLEY && !seen.has(at);) {
      seen.add(at);
      const next = links.get(at)![0];
      if (next === null || next === undefined) return undefined;
      const back = links.get(next) ?? [];
      const rope = back[1] === at ? ropeAt.get(next)?.[1] : back[0] === at ? ropeAt.get(next)?.[0] : undefined;
      if (rope !== null && rope !== undefined) return rope;
      at = next;
    }
    return undefined;
  };

  const order = [...toonsListOrder(level, "the moving list", kinds), ...toonsListOrder(level, "the fixed list", kinds)];
  for (const index of order) {
    const part = parts[index]!;
    if (gone.has(index) || bin.has(index) || part.type === TOONS_ROPE || part.type === TOONS_BELT || fixed(index))
      continue;
    if (part.type === TOONS_PULLEY) {
      const rope = ropeOver(index);
      if (rope !== undefined && !bin.has(rope)) untieRope(rope);
    }
    putInBin(index);
  }
  const binKind = (index: number) => binKinds?.get(parts[index]!.type) ?? parts[index]!.type;
  const binOrder: number[] = [];
  for (const index of inserted) {
    const k = binOrder.findIndex((other) => binKind(index) < binKind(other));
    binOrder.splice(k < 0 ? binOrder.length : k, 0, index);
  }
  for (const index of [...states.keys()])
    if (bin.has(index) || states.get(index) === parts[index]!.state[0]) states.delete(index);
  return {
    bin,
    binOrder,
    gone,
    unplugged,
    plugs: new Map([...changedPlugs].sort((a, b) => a - b).map((index) => [index, plugs.get(index)!])),
    states,
  };
}

/**
 * Which rope places of each part hold a rope, by part index. TOONS.EXE's level reader (file offset `0x24e0a`) gives
 * each rope it reads a record of its own, puts it in the rope's own place, and puts it at the place the rope ties on
 * each of its two parts: the word at 0x6f for the first place, 0x71 for the second. With `start`, as the puzzle starts:
 * a rope the setup puts in the bin is first untied from both its parts, which clears their places (`0xb902`).
 */
export function toonsRopePlaces(level: Level, start?: ToonsPuzzleStart): Map<number, [boolean, boolean]> {
  const places = new Map<number, [boolean, boolean]>();
  const tie = (part: number | null, place: number) => {
    if (part === null || place > 1) return;
    const own = places.get(part) ?? [false, false];
    own[place] = true;
    places.set(part, own);
  };
  for (const part of level.parts)
    part.ropes.forEach((place, n) => {
      const rope = place.rope;
      if (!rope) return;
      tie(part.index, n);
      if (!start?.bin.has(part.index)) rope.parts.forEach((end, k) => tie(end, rope.slots[k]!));
    });
  return places;
}

/** The level parts a Toons goal condition is about when the puzzle starts, as far as the level decides them. */
export interface ToonsGoalParts {
  /** The parts, by index in the level; empty when the list has none that fits. */
  parts: number[];
  /** Whether the condition holds when the puzzle starts, when the level alone decides it. */
  holds?: boolean;
  /**
   * What the player can change that may make it other parts: `bin` when parts from the bin can go before them on the
   * list (where the player puts them decides), `ropes` when it depends on the ropes, whose ends the player may take
   * off and tie elsewhere.
   */
  player?: "bin" | "ropes";
}

/**
 * The level part a condition of a Toons goal is about, when the level decides it: the n-th part of a type on a list
 * (`nth`), or the first part of a type, or of any type, on a list whose rope places and type pass the condition's
 * `where` (`first`); and for `every` and `first`, whether tests of only the rope places and the type hold as the
 * puzzle starts. Undefined for a condition it can't place.
 *
 * The lists are in the order the level loader leaves them (`toonsListOrder`), less the parts the puzzle setup puts in
 * the bin or takes off (`toonsPuzzleStart`). When a run starts, TOONS.EXE doesn't sort them again: it puts the parts
 * back where they were and only moves Al and Sid from the fixed list to the moving list and the rug the other way
 * (file offset `0xec1e`), which none of the shipped levels needs. A part the player puts on the board from the bin goes
 * into its list by the place the player gives it (`0x27f87`, `0x280c4`), so when a part from the bin could come before
 * the found one, `player` is `bin`. The rope places are those of the ropes the setup leaves tied
 * (`toonsRopePlaces`). The setup clears every rope's fixed bit (`0x25892`), which lets the player take either end of
 * a tied rope off and tie it elsewhere (`0x280f3`), or put the rope in the bin (`0x281c9`), so a condition on rope
 * places is `ropes`.
 */
export function toonsGoalParts(
  level: Level,
  condition: GoalCondition,
  kinds: ReadonlyMap<number, number>,
): ToonsGoalParts | undefined {
  const c = condition;
  const group = c.lists === "the fixed list" ? "static" : c.lists === "the moving list" ? "moving" : undefined;
  if (!group || (c.types?.length ?? 0) > 1) return undefined;
  const type = c.types?.[0]?.type;
  const start = toonsPuzzleStart(level, kinds);
  const order = toonsListOrder(level, c.lists!, kinds).filter((i) => !start.bin.has(i) && !start.gone.has(i));
  const ofType = type === undefined ? order : order.filter((index) => level.parts[index]?.type === type);
  const ropes = toonsRopePlaces(level, start);
  // A test of a rope place or of the type, as the condition says it, against a part; undefined for any other test.
  const test = (text: string): ((index: number) => boolean) | undefined => {
    const rope = /^rope([12]) ([=≠]) 0$/.exec(text);
    if (rope) return (index) => (ropes.get(index)?.[Number(rope[1]) - 1] ?? false) === (rope[2] === "≠");
    const named = /^type (is|isn't) (.+)$/.exec(text);
    if (named) return (index) => (TOONS_IDS[level.parts[index]!.type] === named[2]) === (named[1] === "is");
    return undefined;
  };
  const decided = (texts: readonly string[]) => {
    const tests = texts.map(test);
    // Tests that held at some step, or of the part a field holds, aren't the part's as the puzzle starts.
    if (c.once || c.ago || c.via) return undefined;
    return tests.every((t) => t) ? (index: number) => tests.every((t) => t!(index)) : undefined;
  };
  const onRopes = (texts: readonly string[]) => texts.some((t) => t.startsWith("rope"));
  // A part from the bin that could come before the found one: one of its type, or, for any type, one sorted no later.
  const fromBin = (found: number | undefined) => {
    const kind = found === undefined ? Infinity : (kinds.get(level.parts[found]!.type) ?? 0);
    return level.parts.some(
      (p) =>
        p.group === group &&
        start.bin.has(p.index) &&
        (type === undefined ? (kinds.get(p.type) ?? 0) <= kind : p.type === type),
    );
  };
  const player = (texts: readonly string[], found: number | undefined): Pick<ToonsGoalParts, "player"> =>
    onRopes(texts) ? { player: "ropes" } : fromBin(found) ? { player: "bin" } : {};

  if (c.kind === "nth") {
    if (type === undefined) return undefined;
    const found = ofType[c.nth! - 1];
    const holds = decided(c.tests);
    return {
      parts: found === undefined ? [] : [found],
      ...(holds && found !== undefined ? { holds: holds(found) } : {}),
      ...player(c.tests, found),
    };
  }
  if (c.kind === "first") {
    const where = (c.where ?? []).map(test);
    if (!where.every((t) => t)) return undefined;
    const found = ofType.find((index) => where.every((t) => t!(index)));
    const holds = decided(c.tests);
    return {
      parts: found === undefined ? [] : [found],
      ...(holds && found !== undefined ? { holds: holds(found) } : {}),
      ...player([...(c.where ?? []), ...c.tests], found),
    };
  }
  if (c.kind === "every" && !c.where?.length && type !== undefined) {
    const holds = decided(c.tests);
    if (!holds) return undefined;
    return { parts: ofType, holds: ofType.every(holds), ...player(c.tests, undefined) };
  }
  return undefined;
}
