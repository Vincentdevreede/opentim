/**
 * The goal of a TIM 2 puzzle. TIM 2 keeps it in the level file, after the parts (`level.tim2.goal`), and one routine
 * of TIM2.EXE tests it for every puzzle. That routine, as read from the program:
 *
 * - The goal is never met when the first word is 0.
 * - It isn't met while one of its parts is in the parts bin.
 * - Each of the eight entries with a part must hold. An entry is the part, two state limits, a count and an area
 *   (x, y, width, height). For a moving part with an area width other than 0 it tests the part's middle (its position
 *   plus half its base size): strictly inside the area, or, with a width of -1, off the screen, outside 0 to 640
 *   across and 0 to 400 down. Otherwise it tests the part's state, from the first limit to the second.
 * - With a count of 0 the entry is about its own part. With a count of N, N parts of that part's type on the same list
 *   must pass. When the entry's part is the last on its list, though, too few that pass don't fail the goal: the
 *   routine then forgets the entry.
 * - An entry after one without a part is never tested: the routine looks a part's entry up only as far as the first
 *   entry without a part. No shipped level has such a gap.
 * - The goal counts as met only from the routine's Nth check on, N being the last word. The run loop sets the count
 *   back to 0 when the machine starts and runs the routine once a step, so N is a number of steps.
 * - Once the routine says the goal is met, the run loop goes on for 30 more steps and then ends the puzzle as solved,
 *   whatever the routine says in those steps.
 *
 * `runTim2Goal` does what the routine does, step by step; `check-goals --tim2` checks it against the routine in the
 * emulator (`src/run/tim2-goal-check.ts`).
 */

import type { GoalCondition, GoalSummary } from "./goal-conditions.ts";
import type { Level } from "./level.ts";
import type { ToonsMemory } from "./toons-drawing.ts";
import { decodeInstruction, type Instruction, type Operand } from "./x86.ts";

/** TIM2.EXE's screen in the off the screen test: a part is off it when its middle is outside these. */
export const TIM2_SCREEN = { width: 640, height: 400 };

export interface Tim2Goal {
  /** The stored words, one line per entry that has a part, for showing them as they are. */
  lines: string[];
  summary: GoalSummary;
}

/** The goal of a TIM 2 level as conditions, or undefined for a level without one. */
export function summariseTim2Goal(level: Level, nameOf: (type: number) => string): Tim2Goal | undefined {
  const goal = level.tim2?.goal;
  if (!goal) return undefined;
  const lines = [`first word ${goal.first}, last word ${goal.last}`];
  const conditions: GoalCondition[] = [];
  goal.entries.forEach((entry, i) => {
    if (entry.part === null) return;
    // Up to version 0x109 an entry keeps one state limit; TIM2.EXE's loader uses it as the second limit too.
    const values = entry.values.length === 6 ? [entry.values[0]!, ...entry.values] : entry.values;
    const [low = 0, high = 0, count = 0, x = 0, y = 0, width = 0, height = 0] = values;
    lines.push(`entry ${i + 1}: part #${entry.part}, ${entry.values.join(", ")}`);
    const part = level.parts[entry.part];
    if (!part) return;
    const type = { type: part.type, name: nameOf(part.type) };
    const moving = part.group === "moving";
    const condition: GoalCondition = { kind: "part", part: part.index, types: [type], tests: [] };
    let test: string;
    if (moving && width === -1) test = `its middle off the screen (${TIM2_SCREEN.width} × ${TIM2_SCREEN.height})`;
    else if (moving && width !== 0) {
      test = `its middle inside x ${x} to ${x + width}, y ${y} to ${y + height}`;
      // The area of the part's position that puts its middle inside, as the drawing shows goal areas.
      const halfX = part.baseSize.width >> 1;
      const halfY = part.baseSize.height >> 1;
      condition.area = {
        x: { min: x - halfX + 1, max: x + width - halfX - 1 },
        y: { min: y - halfY + 1, max: y + height - halfY - 1 },
      };
    } else test = low === high ? `state ${low}` : `state ${low} to ${high}`;
    // Parts without bit 0x40 of the third flag word start in the parts bin (see the levels research).
    const fromBin = ((part.flags[2] ?? 0) & 0x40) === 0;
    if (count) {
      Object.assign(condition, {
        kind: "count",
        lists: moving ? "the moving list" : "the static list",
        where: [test],
        count: { op: ">=", value: count },
        caution:
          `When #${part.index} is the last part on its list, TIM2.EXE forgets this entry, so the goal can be met with ` +
          `fewer than ${count}. Whether it can end last depends on how the game orders the lists, which isn't read yet.`,
      });
      delete condition.part;
      if (fromBin) condition.tests.push(`#${part.index} out of the parts bin`);
    } else {
      condition.tests.push(test);
      if (fromBin) condition.tests.push("out of the parts bin");
    }
    conditions.push(condition);
  });
  const ways: GoalCondition[][] = [];
  if (goal.first !== 0) {
    if (goal.last > 0)
      conditions.push({ kind: "word", tests: [`at least ${goal.last} steps after the machine starts`] });
    ways.push(conditions);
  }
  return { lines, summary: { ways, remembered: [], ...(goal.first ? {} : { problem: "the first word is 0" }) } };
}

/** The words of a part's record TIM2.EXE's goal routine reads. A record starts with the far pointer to the next part. */
export const TIM2_GOAL_FIELDS = {
  next: 0x00,
  type: 0x08,
  state: 0x10,
  x: 0x22,
  y: 0x24,
  baseWidth: 0x54,
  baseHeight: 0x56,
} as const;
/** A goal entry in TIM2.EXE's data segment: the far pointer to its part, then seven words. */
export const TIM2_GOAL_ENTRY_SIZE = 18;
export const TIM2_GOAL_ENTRIES = 8;

/** Where TIM2.EXE's goal routine is and the words it reads, as found in the program. */
export interface Tim2GoalRoutine {
  segment: number;
  offset: number;
  address: number;
  /** The goal as the level loader keeps it: the first word, the first entry and the last word. */
  first: number;
  entries: number;
  last: number;
  /** The word the routine counts its own checks in. */
  checks: number;
  /** The words that hold the first part of each list the routine walks, as far pointers. */
  lists: { bin: number; moving: number; static: number };
}

const u16 = (memory: Uint8Array, at: number) => memory[at]! | (memory[at + 1]! << 8);
const s16 = (value: number) => ((value & 0xffff) ^ 0x8000) - 0x8000;

/**
 * Finds the goal routine of TIM2.EXE, laid out with its overlays (`readToonsMemory`), by the one place that reaches the
 * goal entries by a part's number counted from 1: `mov ax, entries; add ax, -18`. The routine starts at the
 * `push bp; mov bp, sp` before it, and runs in the segment of the overlay (or the code segment) it is in. Its words are
 * read from its instructions: the first word is the first one it compares with 0, the list heads are the far pointers
 * it loads (`mov dx, [head + 2]; mov ax, [head]`, the bin first), the check count is the word it adds 1 to, and the last
 * word is the one it compares that count with.
 */
export function findTim2GoalRoutine(
  program: Pick<ToonsMemory, "memory" | "overlays" | "codeSegments">,
): Tim2GoalRoutine | undefined {
  const { memory } = program;
  for (let at = 0; at + 6 <= memory.length; at++) {
    if (memory[at] !== 0xb8 || memory[at + 3] !== 0x05 || u16(memory, at + 4) !== 0x10000 - TIM2_GOAL_ENTRY_SIZE)
      continue;
    const entries = u16(memory, at + 1);
    let start = at;
    while (start > at - 0x200 && start > 0 && !(memory[start] === 0x55 && u16(memory, start + 1) === 0xec8b)) start--;
    if (memory[start] !== 0x55) continue;
    const segments = [...program.overlays, ...program.codeSegments].filter((s) => s * 16 <= start);
    const segment = Math.max(...segments.filter((s) => start - s * 16 < 0x10000));
    if (!Number.isFinite(segment)) continue;
    const found = readRoutineWords(memory, start, segment);
    if (
      found &&
      found.first === entries - 2 &&
      found.last === entries + TIM2_GOAL_ENTRIES * TIM2_GOAL_ENTRY_SIZE &&
      found.heads.length === 3
    ) {
      const [bin, moving, other] = found.heads as [number, number, number];
      return {
        segment,
        offset: start - segment * 16,
        address: start,
        first: found.first,
        entries,
        last: found.last,
        checks: found.checks,
        lists: { bin, moving, static: other },
      };
    }
  }
  return undefined;
}

/** The words the goal routine reads, from its instructions up to its `retf`. */
function readRoutineWords(memory: Uint8Array, start: number, segment: number) {
  let first: number | undefined;
  let checks: number | undefined;
  let last: number | undefined;
  const heads: number[] = [];
  let previous: Instruction | undefined;
  const direct = (operand: Operand | undefined) =>
    operand?.kind === "memory" && operand.direct && operand.width === 16 ? operand.displacement : undefined;
  for (let at = start, n = 0; n < 2000; n++) {
    let instruction: Instruction;
    try {
      instruction = decodeInstruction(memory, at, segment);
    } catch {
      return undefined;
    }
    const [a, b] = instruction.operands;
    const name = (operand: Operand | undefined) => (operand?.kind === "register" ? operand.name : undefined);
    if (instruction.mnemonic === "cmp" && first === undefined && b?.kind === "immediate" && b.value === 0)
      first = direct(a);
    if (instruction.mnemonic === "inc" && direct(a) !== undefined) checks = direct(a);
    if (instruction.mnemonic === "cmp" && name(a) === "ax" && direct(b) !== undefined && checks !== undefined)
      last = direct(b);
    if (
      instruction.mnemonic === "mov" &&
      name(a) === "ax" &&
      previous?.mnemonic === "mov" &&
      name(previous.operands[0]) === "dx" &&
      direct(b) !== undefined &&
      direct(previous.operands[1]) === direct(b)! + 2 &&
      !heads.includes(direct(b)!)
    )
      heads.push(direct(b)!);
    if (instruction.mnemonic === "retf") break;
    previous = instruction;
    at += instruction.size;
  }
  return first !== undefined && checks !== undefined && last !== undefined ? { first, checks, last, heads } : undefined;
}

/** What TIM2.EXE's goal routine reads of a part. Each value is a word. */
export interface Tim2GoalPart {
  type: number;
  state: number;
  x: number;
  y: number;
  baseWidth: number;
  baseHeight: number;
}

/** The goal and the parts as the goal routine finds them when it runs. */
export interface Tim2GoalWorld<P extends Tim2GoalPart = Tim2GoalPart> {
  first: number;
  /** The eight entries: the part (or null) and the seven words. */
  entries: readonly { part: P | null; values: readonly number[] }[];
  last: number;
  moving: readonly P[];
  static: readonly P[];
  bin: readonly P[];
  /** The routine's count of its own checks, as the run loop left it. */
  checks: number;
}

/** What the goal routine answers: 0 for no goal (the first word is 0), 1 for not met, 2 for met. */
export type Tim2GoalAnswer = 0 | 1 | 2;

/**
 * Tests a TIM 2 goal as TIM2.EXE's goal routine does, and gives its answer and its check count after. `onTest` hears
 * each test it makes, by name, and whether it held. What the routine does, in order:
 *
 * - With a first word of 0 it counts the check and answers 0.
 * - A part of the goal in the parts bin: it answers 1 without counting the check.
 * - Then it walks the moving list and the static list, each from its first part. A part is the goal's when an entry
 *   points at it; the search for it stops at the first entry without a part. An entry with a count of 0 tests its own
 *   part: a part on the moving list with an area width other than 0 by its middle (its position plus half its base
 *   size), strictly inside the area or, for a width of -1, off the screen; any other by its state, from the low to the
 *   high one. When it holds the goal is met so far; when it doesn't, the walk stops and the goal isn't met.
 * - An entry with a count walks its part's list again from the first part and tests each part of the same type, until
 *   the count of them held. Then the goal is met so far and the walk goes on after the entry's own part. Should the list
 *   end first, the goal isn't met, unless the entry's part is the last on its list: then the routine forgets the entry.
 * - It counts the check, and a goal met before the last word's number of checks isn't met yet.
 *
 * All numbers are words, compared with their sign.
 */
export function runTim2Goal<P extends Tim2GoalPart>(
  world: Tim2GoalWorld<P>,
  onTest?: (test: string, holds: boolean) => void,
): { answer: Tim2GoalAnswer; checks: number } {
  const test = (name: string, holds: boolean) => {
    onTest?.(name, holds);
    return holds;
  };
  const counted = (world.checks + 1) & 0xffff;
  if (!test("the first word isn't 0", world.first !== 0)) return { answer: 0, checks: counted };
  // The entry pointing at a part, counted from 1, or 0. Past the eighth the game reads on through the words after the
  // entries, where no part is.
  const entryOf = (part: P) => {
    for (let k = 0; k < world.entries.length && world.entries[k]!.part; k++)
      if (world.entries[k]!.part === part) return k + 1;
    return 0;
  };
  for (const part of world.bin)
    if (test("a part in the bin is the goal's", entryOf(part) > 0)) return { answer: 1, checks: world.checks };

  /** Met so far (2), not met so far (1), or failed (3). */
  let answer: 1 | 2 | 3 = 1;
  // The word that holds the counted entry's type while an entry counts, -1 otherwise. Each list starts with -1.
  let counting: number;
  let entry = 0;
  let held = 0;
  // Where the walk goes on after an entry has counted: the part after the entry's own, or null after the last one.
  let after: number | null = null;
  lists: for (const [list, parts] of [world.moving, world.static].entries()) {
    counting = 0xffff;
    let at = 0;
    while (at < parts.length) {
      const part = parts[at]!;
      if (counting === 0xffff) entry = entryOf(part);
      let next = true;
      const goal = entry ? world.entries[entry - 1]! : undefined;
      if (test("a part on a list is the goal's", !!goal) && goal) {
        const [low = 0, high = 0, count = 0, x = 0, y = 0, width = 0, height = 0] = goal.values.map(s16);
        if (test(`entry ${entry}: the type`, (goal.part!.type & 0xffff) === (part.type & 0xffff))) {
          if (count !== 0 && counting === 0xffff) {
            // Count from the first part of the list: the walk goes on from before it.
            after = at + 1 < parts.length ? at + 1 : null;
            counting = part.type & 0xffff;
            at = -1;
          } else {
            let holds: boolean;
            if (width !== 0 && list === 0) {
              const middleX = s16(part.x + (s16(part.baseWidth) >> 1));
              const middleY = s16(part.y + (s16(part.baseHeight) >> 1));
              holds = test(
                `entry ${entry}: holds`,
                width === -1
                  ? middleX < 0 || middleX > TIM2_SCREEN.width || middleY > TIM2_SCREEN.height || middleY < 0
                  : x < middleX && middleX < s16(x + width) && y < middleY && middleY < s16(y + height),
              );
            } else {
              const state = s16(part.state);
              holds = test(`entry ${entry}: holds`, low <= state && state <= high);
            }
            if (holds) {
              held = (held + 1) & 0xffff;
              if (count === 0) {
                counting = 0xffff;
                answer = 2;
                held = 0;
              } else if (test(`entry ${entry}: enough parts`, (count & 0xffff) === held)) {
                counting = 0xffff;
                answer = 2;
                held = 0;
                at = after ?? parts.length;
                after = null;
                next = false;
              }
            } else if (count === 0) {
              answer = 3;
              break lists;
            }
          }
        }
      }
      if (next) {
        at++;
        if (at >= parts.length && after !== null) {
          answer = 3;
          break lists;
        }
      }
    }
  }
  if (answer === 3) answer = 1;
  if (answer === 2 && !test("enough checks", s16(counted) >= s16(world.last))) answer = 1;
  return { answer, checks: counted };
}
