/**
 * Finds in TOONS.EXE or TIM2.EXE, laid out with its overlays, what `GameMachine` needs to load a level and start its
 * puzzle with the game's own code (`level-start.ts`). Everything is found from the level loader, the one routine that
 * compares the file's first word with the level magic (`cmp word [magic], 0xaced` in Toons, `0xacef` in TIM 2):
 *
 * - the game's `fopen` is the loader's first far call;
 * - the loader's table of parts is made by the routine it calls with the number of parts: that routine's first far
 *   call is the game's far allocation, and it keeps the result (`mov [table + 2], dx; mov [table], ax`). In Toons the
 *   routine then takes each record from the near `calloc` with the record's size (`calloc(1, 0xb3)`);
 * - the far call after `push [table + 2]; push [table]` is the `free` of that table;
 * - the puzzle start is the routine that calls the loader. Toons calls it with the name and 1 for a puzzle, and the
 *   routine that starts a puzzle runs it, then one more routine and the level reset (the far call after it). TIM 2
 *   calls it with the name and the game's mode: any mode but 1 and 6 (which keep every part) and 9 (the designer's
 *   solution) puts the parts in the bin;
 * - Toons sorts its bin by a word of each type's record that a start-up routine writes (`readToonsBinKinds`), so that
 *   routine runs first;
 * - TIM 2 keeps its part records in a store the game makes when it starts: the routine that allocates
 *   `count * size` bytes (`imul ax, ax, size`) with the far allocation, called with the count (`push count`).
 */
import type { ToonsMemory } from "../read/toons-drawing.ts";
import { findToonsBinKindsCode } from "../read/toons-goals.ts";
import { decodeInstruction, type Instruction } from "../read/x86.ts";
import type { FarAddress, GameStart, StartCall } from "./level-start.ts";

const MAGIC = { toons: 0xaced, tim2: 0xacef } as const;
/** The TIM 2 modes the puzzle start is called with: any one that puts the parts in the bin, and the solution. */
export const TIM2_MODES = { puzzle: 2, solution: 9 } as const;

const u16 = (memory: Uint8Array, at: number) => memory[at]! | (memory[at + 1]! << 8);

/** A routine's instructions from its start to its first `retf`, in the order they are laid out. */
function routine(memory: Uint8Array, segment: number, offset: number, limit = 3000): Instruction[] {
  const out: Instruction[] = [];
  for (let at = segment * 16 + offset; out.length < limit;) {
    let instruction: Instruction;
    try {
      instruction = decodeInstruction(memory, at, segment);
    } catch {
      break;
    }
    out.push(instruction);
    if (instruction.mnemonic === "retf") break;
    at += instruction.size;
  }
  return out;
}

/** The segment a place runs in: the overlay or code segment it lies in. */
function segmentAt(program: Pick<ToonsMemory, "overlays" | "codeSegments">, at: number): number | undefined {
  const segments = [...program.overlays, ...program.codeSegments].filter((s) => s * 16 <= at && at - s * 16 < 0x10000);
  return segments.length ? Math.max(...segments) : undefined;
}

/** The start of the routine a place is in: the nearest `push bp; mov bp, sp` before it. */
function routineStart(memory: Uint8Array, at: number, back = 0x400): number | undefined {
  for (let start = at; start >= Math.max(0, at - back); start--)
    if (memory[start] === 0x55 && u16(memory, start + 1) === 0xec8b) return start;
  return undefined;
}

const farTarget = (i: Instruction): FarAddress | undefined =>
  i.mnemonic === "call" && i.far && i.target ? { segment: i.target.segment, offset: i.target.offset } : undefined;
const nearTarget = (i: Instruction): number | undefined =>
  i.mnemonic === "call" && !i.far && i.target ? i.target.offset : undefined;
const direct = (i: Instruction | undefined, k: number) => {
  const operand = i?.operands[k];
  return operand?.kind === "memory" && operand.direct ? operand.displacement : undefined;
};
const immediate = (i: Instruction | undefined, k: number) => {
  const operand = i?.operands[k];
  return operand?.kind === "immediate" ? operand.value : undefined;
};

/** The near calls to `offset` in a segment, as the starts of the routines that make them. */
function callers(program: ToonsMemory, segment: number, offset: number): { start: number; at: number }[] {
  const out: { start: number; at: number }[] = [];
  const { memory } = program;
  const from = segment * 16;
  for (let at = from; at < Math.min(memory.length - 3, from + 0x10000); at++) {
    if (memory[at] !== 0xe8 || ((at - from + 3 + u16(memory, at + 1)) & 0xffff) !== offset) continue;
    if (segmentAt(program, at) !== segment) continue;
    const start = routineStart(memory, at);
    if (start !== undefined) out.push({ start, at });
  }
  return out;
}

/**
 * What `GameMachine` needs for TOONS.EXE or TIM2.EXE, or undefined when the program doesn't have it. `lists` are the
 * words that head the moving list, the fixed list and the bin, which the goal readers find (`toonsLists`,
 * `findTim2GoalRoutine`).
 */
export function findGameStart(
  program: ToonsMemory,
  game: "toons" | "tim2",
  lists: GameStart["lists"],
): GameStart | undefined {
  const { memory } = program;
  const magic = MAGIC[game];
  for (let at = 0; at + 6 <= memory.length; at++) {
    if (memory[at] !== 0x81 || memory[at + 1] !== 0x3e || u16(memory, at + 4) !== magic) continue;
    const start = routineStart(memory, at, 0x100);
    const segment = start === undefined ? undefined : segmentAt(program, start);
    if (start === undefined || segment === undefined) continue;
    const found = fromLoader(program, game, lists, { segment, offset: start - segment * 16 });
    if (found) return found;
  }
  return undefined;
}

function fromLoader(
  program: ToonsMemory,
  game: "toons" | "tim2",
  lists: GameStart["lists"],
  loader: FarAddress,
): GameStart | undefined {
  const { memory } = program;
  const body = routine(memory, loader.segment, loader.offset);
  const open = body.map(farTarget).find((t) => t);
  if (!open) return undefined;
  // The routine that makes the table of parts.
  let pool: number | undefined;
  let alloc: FarAddress | undefined;
  let calloc: FarAddress | undefined;
  let partSize: number | undefined;
  for (const offset of body.map(nearTarget)) {
    if (offset === undefined) continue;
    const made = routine(memory, loader.segment, offset);
    const k = made.findIndex(
      (i, n) =>
        farTarget(i) !== undefined &&
        made
          .slice(n + 1, n + 6)
          .some((m) => m.mnemonic === "mov" && direct(m, 0) !== undefined && m.text.endsWith("dx")),
    );
    if (k < 0) continue;
    const kept = made.slice(k + 1, k + 6).find((m) => m.mnemonic === "mov" && m.text.endsWith(", ax"));
    if (direct(kept, 0) === undefined) continue;
    pool = direct(kept, 0);
    alloc = farTarget(made[k]!);
    // Toons: calloc(1, size), a far call after `mov ax, size; push ax; mov ax, 1; push ax`.
    const n = made.findIndex(
      (i, j) =>
        j > k &&
        farTarget(i) !== undefined &&
        immediate(made[j - 2], 1) === 1 &&
        immediate(made[j - 4], 1) !== undefined,
    );
    if (n >= 0) {
      calloc = farTarget(made[n]!);
      partSize = immediate(made[n - 4], 1);
    }
    break;
  }
  if (pool === undefined || !alloc) return undefined;
  const free: FarAddress[] = body
    .filter((i, n) => farTarget(i) && direct(body[n - 1], 0) === pool && direct(body[n - 2], 0) === pool! + 2)
    .map((i) => farTarget(i)!);

  // The puzzle start: the routine that calls the loader.
  const [caller] = callers(program, loader.segment, loader.offset);
  if (!caller) return undefined;
  const begin: FarAddress = { segment: loader.segment, offset: caller.start - loader.segment * 16 };
  const start: StartCall[] = [];
  const setup: StartCall[] = [];
  if (game === "toons") {
    // The routine that starts a puzzle runs the puzzle start's own caller, then a routine and the level reset.
    start.push({ ...begin, args: ["name", 1] });
    // The one way to it from a routine that goes on with a near call and the level reset (a far call).
    let then: StartCall[] | undefined;
    for (const parent of callers(program, begin.segment, begin.offset))
      for (const grand of callers(program, begin.segment, parent.start - begin.segment * 16)) {
        const after = routine(memory, begin.segment, grand.at - begin.segment * 16, 6).slice(1);
        const k = after.findIndex((i) => nearTarget(i) !== undefined);
        const next = after[k];
        const reset = after[k + 1];
        if (then || !next || !reset || farTarget(reset) === undefined) continue;
        then = [
          { segment: begin.segment, offset: nearTarget(next)!, args: [] },
          { ...farTarget(reset)!, args: [] },
        ];
      }
    if (!then) return undefined;
    start.push(...then);
    // The start-up routine that writes each type's place in the bin's order into its record (`readToonsBinKinds`).
    const image = memory.subarray(0, program.overlays.length ? program.overlays[0]! * 16 : memory.length);
    const code = findToonsBinKindsCode(image);
    const from = code === undefined ? undefined : routineStart(memory, code, 0x80);
    const segment = from === undefined ? undefined : segmentAt(program, from);
    if (from === undefined || segment === undefined) return undefined;
    setup.push({ segment, offset: from - segment * 16, args: [] });
    // The near `free`: the routine that frees a part frees the rope record of a rope or a pulley with it,
    // `cmp word [si + 4], 0x0e; jne; push word [si + 0x6f]; call far free`.
    for (let at = 0; at + 12 <= image.length; at++)
      if (
        u16(memory, at) === 0x7c83 &&
        u16(memory, at + 2) === 0x0e04 &&
        memory[at + 4] === 0x75 &&
        u16(memory, at + 6) === 0x74ff &&
        memory[at + 8] === 0x6f &&
        memory[at + 9] === 0x9a
      ) {
        free.push({ segment: u16(memory, at + 12), offset: u16(memory, at + 10) });
        break;
      }
  } else {
    start.push({ ...begin, args: ["name", TIM2_MODES.puzzle] });
    // The store of part records: `imul ax, ax, size` and the far allocation, called with the count.
    for (let at = 0; at + 4 <= memory.length && partSize === undefined; at++) {
      if (memory[at] !== 0x69 || memory[at + 1] !== 0xc0) continue;
      const from = routineStart(memory, at, 0x40);
      const segment = from === undefined ? undefined : segmentAt(program, from);
      if (from === undefined || segment === undefined) continue;
      const made = routine(memory, segment, from - segment * 16, 60);
      const allocates = made.some((i) => {
        const t = farTarget(i);
        return t && t.segment === alloc!.segment && t.offset === alloc!.offset;
      });
      const [user] = callers(program, segment, from - segment * 16);
      if (!allocates || !user) continue;
      const before = pushedBefore(memory, user.at);
      if (before === undefined) continue;
      partSize = u16(memory, at + 2);
      setup.push({ segment, offset: from - segment * 16, args: [before] });
    }
  }
  if (partSize === undefined) return undefined;
  return {
    game,
    partSize,
    far: game === "tim2",
    lists,
    pool,
    setup,
    loader,
    start,
    stands: { open, alloc, ...(calloc ? { calloc } : {}), free },
  };
}

/** The word pushed just before a near call (`push imm16`, maybe with `nop; push cs` between). */
function pushedBefore(memory: Uint8Array, call: number): number | undefined {
  for (let at = call - 8; at < call; at++) {
    if (memory[at] !== 0x68) continue;
    const between = memory.subarray(at + 3, call);
    if (between.every((b) => b === 0x90 || b === 0x0e)) return u16(memory, at + 1);
  }
  return undefined;
}

/** The far call that runs the TIM 2 puzzle start for the designer's solution instead of the puzzle. */
export function tim2Solution(start: GameStart): StartCall[] {
  return start.start.map((call) => (call.args[0] === "name" ? { ...call, args: ["name", TIM2_MODES.solution] } : call));
}
