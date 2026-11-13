/**
 * When a puzzle is solved. The goal isn't in the level file: TIM.EXE has a goal routine for each puzzle, and the run
 * loop calls a dispatcher every step that calls the routine the puzzle number picks from a table of far pointers
 * (`0x14ae` with the table at `0x201a` in Even More, English floppy). A routine looks at the parts and sets the game
 * mode word to `0x0200` when the goal is met, which ends the run.
 *
 * `findGoalTable` finds the dispatcher and the table in the code. `readGoalRoutines` reads a goal routine, and every
 * routine it calls, into a small structured program: words of memory and parts' fields read and written, tests,
 * loops and calls, in the routine's own order. Nothing is assumed about what a call does; the list routines a goal
 * walks the parts with are read the same way. `runGoal` runs such a program over the game's memory, so the machine
 * can test a goal the way the game does.
 */
import { decodeInstruction, type Instruction, type Operand, operandText } from "./x86.ts";
import { wordAt } from "./behaviour-terms.ts";

/** A value a goal program works with: all are 16-bit words. */
export type GoalValue =
  | { kind: "constant"; value: number }
  | { kind: "register"; name: string }
  /** The word at a frame offset of the routine: below 0 its locals, from 6 the arguments its caller pushed. */
  | { kind: "local"; offset: number }
  /** Where a local is, for the routine to read and write it through a register. */
  | { kind: "localAddress"; offset: number }
  /** The word at an address of the data segment, like a global word or a part's field (the part's address + offset). */
  | { kind: "word"; address: GoalValue }
  | { kind: "binary"; op: GoalOperator; left: GoalValue; right: GoalValue };

export type GoalOperator = "+" | "-" | "&" | "|" | "^" | "<<" | ">>" | ">>>" | "/" | "%";

export type GoalComparison = "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface GoalTest {
  op: GoalComparison;
  signed: boolean;
  left: GoalValue;
  right: GoalValue;
}

export type GoalTarget = Extract<GoalValue, { kind: "register" | "local" | "word" }>;

export type GoalStatement =
  | { kind: "set"; target: GoalTarget; value: GoalValue }
  /**
   * Calls a routine. Its arguments are the words the caller pushed, from frame offset `stack` up: the routine reads
   * them at its own offsets from 6. `ax` afterwards is the routine's `ax`.
   */
  | { kind: "call"; routine: number; segment: number; offset: number; stack: number }
  | { kind: "if"; test: GoalTest; then: GoalStatement[]; else: GoalStatement[] }
  /** Runs `before`, stops when `test` fails, runs `body`, and again. */
  | { kind: "loop"; before: GoalStatement[]; test: GoalTest; body: GoalStatement[] }
  | { kind: "break" }
  | { kind: "return" };

export interface GoalRoutine {
  /** Where the routine starts in the load image. */
  address: number;
  /** Its code segment and offset, as the program calls it. */
  segment: number;
  offset: number;
  body: GoalStatement[];
}

/** A routine the reader can't read, and why. */
export interface GoalProblem {
  address: number;
  at: number;
  reason: string;
}

export interface GoalTable {
  /** Where the dispatcher starts. */
  dispatcher: number;
  /** The data segment word with the puzzle number. */
  puzzleWord: number;
  /** Where the table's entry for puzzle 0 is in the load image. */
  table: number;
  /** The goal routine for each puzzle number from 1, as segment and offset; the table ends at an entry that isn't one. */
  routines: { puzzle: number; segment: number; offset: number; address: number }[];
}

const hex = (value: number) => `0x${value.toString(16)}`;
/** A routine starts with `push bp; mov bp, sp`. */
const startsRoutine = (image: Uint8Array, at: number) =>
  image[at] === 0x55 && image[at + 1] === 0x8b && image[at + 2] === 0xec;

/**
 * Finds the goal dispatcher: a routine that loads the puzzle number from a word, multiplies it by 4 (two shifts by 1, or
 * one by `cl` = 2), and calls the far pointer at that place in a table, in the data segment or in one it loads into
 * `es` first (the Even More CD). The table's entries from puzzle 1 on must each start a routine.
 */
export function findGoalTable(image: Uint8Array, dataSegment: number): GoalTable | undefined {
  const found: GoalTable[] = [];
  for (let start = 0; start + 3 < dataSegment * 16; start++) {
    if (!startsRoutine(image, start)) continue;
    const segment = Math.max(0, (start >> 4) - 0xfff);
    const code: Instruction[] = [];
    try {
      for (let at = start + 3; code.length < 7;) {
        const instruction = decodeInstruction(image, at, segment);
        code.push(instruction);
        at += instruction.size;
        if (instruction.flow !== "next") break;
      }
    } catch {
      continue;
    }
    const texts = code.map((i) => i.text);
    const load = /^mov bx, word \[(0x[0-9a-f]+)\]$/.exec(texts[0] ?? "");
    if (!load) continue;
    const timesFour =
      (texts[1] === "shl bx, 0x01" && texts[2] === "shl bx, 0x01") ||
      (texts[1] === "mov cl, 0x02" && texts[2] === "shl bx, cl");
    if (!timesFour) continue;
    let k = 3;
    let tableSegment = dataSegment;
    const loadsEs = /^mov ax, (0x[0-9a-f]+)$/.exec(texts[k] ?? "");
    if (loadsEs && texts[k + 1] === "mov es, ax") {
      tableSegment = Number(loadsEs[1]);
      k += 2;
    }
    const call = code[k];
    const pointer = call?.operands[0];
    if (call?.mnemonic !== "call" || pointer?.kind !== "memory" || pointer.width !== 32) continue;
    if (pointer.base.join() !== "bx" || pointer.segment !== (tableSegment === dataSegment ? "ds" : "es")) continue;
    const displacement = pointer.displacement >= 0x8000 ? pointer.displacement - 0x10000 : pointer.displacement;
    const table = tableSegment * 16 + displacement;
    const routines: GoalTable["routines"] = [];
    for (let puzzle = 1; ; puzzle++) {
      const at = table + 4 * puzzle;
      if (at + 4 > image.length) break;
      const offset = wordAt(image, at);
      const routineSegment = wordAt(image, at + 2);
      const address = routineSegment * 16 + offset;
      if (routineSegment >= dataSegment || !startsRoutine(image, address)) break;
      routines.push({ puzzle, segment: routineSegment, offset, address });
    }
    if (routines.length) found.push({ dispatcher: start, puzzleWord: Number(load[1]), table, routines });
  }
  return found.length === 1 ? found[0] : undefined;
}

/** The words the run loop counts its steps in, which some goals read. */
export interface StepCounts {
  /** The routine that calls the goal dispatcher every step: the run loop. */
  runLoop: number;
  /** Words the run loop adds 1 to itself: the step count. */
  own: number[];
  /** Words a routine it calls adds 1 to, by that routine: a second count of steps, like Even More's `[0x4a8b]`. */
  called: { routine: number; words: number[] }[];
}

/**
 * Finds the run loop, the one routine that calls the goal dispatcher, and the words it and the routines it calls add 1
 * to (`inc word [address]`). Undefined when not exactly one routine calls the dispatcher or its code can't be followed.
 */
export function findStepCounts(image: Uint8Array, dataSegment: number, table: GoalTable): StepCounts | undefined {
  const segmentFor = (at: number) => Math.max(0, (at >> 4) - 0xfff);
  const routineAt = (at: number) => {
    for (let start = at; start >= 0 && start > at - 0x4000; start--) if (startsRoutine(image, start)) return start;
    return undefined;
  };
  const counted = (graph: RoutineGraph) =>
    [...graph.instructions.values()].flatMap((i) => {
      const target = i.operands[0];
      return i.mnemonic === "inc" && target?.kind === "memory" && target.direct && target.width === 16
        ? [target.displacement]
        : [];
    });
  const callers = new Set<number>();
  for (let at = 0; at + 5 < dataSegment * 16; at++) {
    if (image[at] !== 0xe8 && image[at] !== 0x9a) continue;
    try {
      const call = decodeInstruction(image, at, segmentFor(at));
      if (call.mnemonic !== "call" || call.target?.address !== table.dispatcher) continue;
      const start = routineAt(at);
      if (start !== undefined) callers.add(start);
    } catch {
      // Not an instruction here.
    }
  }
  if (callers.size !== 1) return undefined;
  const runLoop = [...callers][0]!;
  try {
    const graph = new RoutineGraph(image, runLoop, segmentFor(runLoop));
    const called: StepCounts["called"] = [];
    const seen = new Set<number>();
    for (const i of graph.instructions.values()) {
      if (i.mnemonic !== "call" || !i.target || seen.has(i.target.address)) continue;
      seen.add(i.target.address);
      try {
        const words = counted(new RoutineGraph(image, i.target.address, i.target.segment));
        if (words.length) called.push({ routine: i.target.address, words });
      } catch {
        // A routine that can't be followed counts nothing here.
      }
    }
    return { runLoop, own: counted(graph), called };
  } catch {
    return undefined;
  }
}

class Unreadable extends Error {
  readonly at: number;

  constructor(at: number, reason: string) {
    super(reason);
    this.at = at;
  }
}

type Flags =
  | { kind: "compare"; left: GoalValue; right: GoalValue }
  | { kind: "and"; left: GoalValue; right: GoalValue }
  /**
   * The flags of a result, tested against 0; `logic` when it was `or`/`and`/`xor`/`test`, which clear overflow. After
   * `add` or `sub`, `sum` has the operands: the first as it was before (worked out from the result), and the second.
   */
  | {
      kind: "result";
      value: GoalValue;
      logic: boolean;
      sum?: { op: "+" | "-"; left: GoalValue; right: GoalValue };
    };

/** The word register of each low byte register, for `mov al, byte; mov ah, 0`. */
const BYTE_PAIRS: Record<string, string> = { al: "ax", bl: "bx", cl: "cx", dl: "dx" };

const CONDITIONS: Record<string, { op: GoalComparison; signed: boolean }> = {
  je: { op: "==", signed: false },
  jne: { op: "!=", signed: false },
  jl: { op: "<", signed: true },
  jle: { op: "<=", signed: true },
  jg: { op: ">", signed: true },
  jge: { op: ">=", signed: true },
  jb: { op: "<", signed: false },
  jbe: { op: "<=", signed: false },
  ja: { op: ">", signed: false },
  jae: { op: ">=", signed: false },
  js: { op: "<", signed: true },
  jns: { op: ">=", signed: true },
};
const NEGATED: Record<GoalComparison, GoalComparison> = {
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

export function negate(test: GoalTest): GoalTest {
  return { ...test, op: NEGATED[test.op] };
}

const ZERO: GoalValue = { kind: "constant", value: 0 };
const EXIT = -1;

/**
 * Where a goal's word of another segment than the data segment is: this, plus the segment times 0x10000, plus its
 * offset, past every word of the data segment. Toons' goals keep some of their words in a far segment they load into
 * `es`. `farWord` gives the segment and offset back.
 */
export const FAR_WORDS = 2 ** 32;
export const farWord = (address: number) =>
  address >= FAR_WORDS
    ? { segment: Math.floor((address - FAR_WORDS) / 0x10000), offset: (address - FAR_WORDS) % 0x10000 }
    : undefined;

/** How to read a program whose goals reach past TIM.EXE's ways. */
export interface GoalReading {
  /** Where a far call leads, for calls through the stubs of an overlay manager. */
  resolve?: (segment: number, offset: number) => { segment: number; offset: number };
  /** Whether a goal may read and write words of another segment through `es`, after loading it with a constant. */
  farWords?: boolean;
}

/** One routine's code: its instructions by address, and where each goes next. */
class RoutineGraph {
  readonly instructions = new Map<number, Instruction>();
  readonly successors = new Map<number, number[]>();
  private postDominators?: Map<number, Set<number>>;
  readonly address: number;
  readonly segment: number;

  constructor(image: Uint8Array, address: number, segment: number) {
    this.address = address;
    this.segment = segment;
    const pending = [address];
    while (pending.length) {
      const at = pending.pop()!;
      if (this.instructions.has(at)) continue;
      if (this.instructions.size > 2000) throw new Unreadable(at, "the routine is too long");
      let instruction: Instruction;
      try {
        instruction = decodeInstruction(image, at, segment);
      } catch (problem) {
        throw new Unreadable(at, problem instanceof Error ? problem.message : String(problem));
      }
      this.instructions.set(at, instruction);
      const next = at + instruction.size;
      const targets: number[] = [];
      if (instruction.flow === "return" || instruction.flow === "stop") targets.push(EXIT);
      else if (instruction.flow === "jump") {
        if (!instruction.target) throw new Unreadable(at, `an indirect jump (${instruction.text})`);
        targets.push(instruction.target.address);
      } else if (instruction.flow === "branch") targets.push(instruction.target!.address, next);
      else targets.push(next);
      this.successors.set(at, targets);
      for (const target of targets) if (target !== EXIT) pending.push(target);
    }
  }

  /** The first place every way from `at` to the routine's end goes through, or `EXIT`. */
  join(at: number): number {
    if (!this.postDominators) {
      const nodes = [...this.instructions.keys()];
      const all = new Set([...nodes, EXIT]);
      const sets = new Map<number, Set<number>>(nodes.map((n) => [n, new Set(all)]));
      sets.set(EXIT, new Set([EXIT]));
      for (let changed = true; changed;) {
        changed = false;
        for (const node of nodes) {
          const successors = this.successors.get(node)!;
          let meet: Set<number> | undefined;
          for (const s of successors) {
            const set = sets.get(s)!;
            meet = meet ? new Set([...meet].filter((x) => set.has(x))) : new Set(set);
          }
          meet!.add(node);
          if (meet!.size !== sets.get(node)!.size) {
            sets.set(node, meet!);
            changed = true;
          }
        }
      }
      this.postDominators = sets;
    }
    const own = this.postDominators.get(at)!;
    // The immediate post-dominator: the one, other than itself, that all the others post-dominate too.
    const others = [...own].filter((n) => n !== at);
    return others.find((n) => others.every((m) => this.postDominators!.get(n)!.has(m))) ?? EXIT;
  }
}

interface Region {
  /** Where this part of the code ends: the join it runs to, or the loop's test. */
  stop: number;
  /** Inside a loop's body: where the loop goes on after it, which a jump there means a break. */
  loopExit?: number;
}

/** Reads one routine. `calls` collects the routines it calls. */
class RoutineReader {
  private readonly graph: RoutineGraph;
  private flags?: Flags;
  private flagsAt = -1;
  /** Where the stack pointer is, from the routine's frame pointer: pushes and pops are words at frame offsets. */
  private sp = 0;
  private readonly calls: Set<string>;
  private readonly reading: GoalReading;
  /** The constant each register holds, while it holds one, to know the segment a goal loads into `es`. */
  private constants = new Map<string, number>();
  /** The segment in `es`, when a goal loaded one. */
  private es?: number;
  /** The `mov ah, 0` (or another high byte's) after a byte loaded into the low one, which is said with it. */
  private skip?: number;
  /** The locals read or written as bytes, and as words: one place may not be both. */
  private readonly byteLocals = new Set<number>();
  private readonly wordLocals = new Set<number>();

  constructor(image: Uint8Array, address: number, segment: number, calls: Set<string>, reading: GoalReading = {}) {
    this.calls = calls;
    this.reading = reading;
    // The reading starts past `push bp; mov bp, sp`: a routine without them would lose its first instructions.
    if (!startsRoutine(image, address))
      throw new Unreadable(address, "a routine that doesn't start with push bp; mov bp, sp");
    this.graph = new RoutineGraph(image, address, segment);
  }

  /** The registers' constants and `es`, to put back when a branch's other way starts. */
  private known() {
    return { constants: new Map(this.constants), es: this.es };
  }

  private restore(known: ReturnType<RoutineReader["known"]>) {
    this.constants = new Map(known.constants);
    this.es = known.es;
  }

  /** Where two ways meet, a register keeps its constant (and `es` its segment) only when both ways left the same. */
  private meet(other: ReturnType<RoutineReader["known"]>) {
    for (const [name, value] of this.constants) if (other.constants.get(name) !== value) this.constants.delete(name);
    if (other.es !== this.es) this.es = undefined;
  }

  read(): GoalStatement[] {
    const start = this.graph.address + 3;
    const body = this.run(start, { stop: EXIT });
    while (body.at(-1)?.kind === "return") body.pop();
    for (const offset of this.byteLocals)
      if (this.wordLocals.has(offset) || this.wordLocals.has(offset - 1))
        throw new Unreadable(this.graph.address, "a local read both as a byte and as a word");
    return body;
  }

  private instruction(at: number) {
    const instruction = this.graph.instructions.get(at);
    if (!instruction) throw new Unreadable(at, "a jump into the middle of an instruction");
    return instruction;
  }

  /** Whether the code from `at` only restores registers and returns, maybe through jumps the compiler shares. */
  private returns(at: number): boolean {
    for (let n = 0; n < 12; n++) {
      const i = this.graph.instructions.get(at);
      if (!i) return false;
      if (i.mnemonic === "retf" || i.mnemonic === "ret") return true;
      if (i.mnemonic === "jmp" && i.target) {
        at = i.target.address;
        continue;
      }
      const restores =
        (i.mnemonic === "pop" &&
          i.operands[0]?.kind === "register" &&
          ["si", "di", "bp"].includes(i.operands[0].name)) ||
        i.text === "mov sp, bp";
      if (!restores) return false;
      at += i.size;
    }
    return false;
  }

  private run(at: number, region: Region): GoalStatement[] {
    const out: GoalStatement[] = [];
    for (let guard = 0; ; guard++) {
      if (guard > 5000) throw new Unreadable(at, "the reader went round without end");
      if (at === region.stop) return out;
      // The `mov ah, 0` after a byte loaded into `al` was said with it.
      if (at === this.skip) {
        this.skip = undefined;
        at += this.instruction(at).size;
        continue;
      }
      if (region.loopExit !== undefined && at === region.loopExit) {
        out.push({ kind: "break" });
        return out;
      }
      if (this.returns(at)) {
        out.push({ kind: "return" });
        return out;
      }
      const i = this.instruction(at);
      const next = at + i.size;
      if (i.flow === "branch") {
        if (i.target!.address <= at) throw new Unreadable(at, "a branch back that isn't a loop the reader knows");
        const { test, guard } = this.branchTest(i);
        const join = this.inside(this.graph.join(at), region, at);
        const sp = this.sp;
        const flags = { flags: this.flags, at: this.flagsAt };
        const before = this.known();
        const taken = this.run(i.target!.address, { ...region, stop: join });
        const takenSp = this.sp;
        const takenFlags = { flags: this.flags, at: this.flagsAt };
        const takenKnown = this.known();
        // Both ways start from the flags before the branch, which the branch doesn't change.
        this.sp = sp;
        this.flags = flags.flags;
        this.flagsAt = flags.at;
        this.restore(before);
        const fall = this.run(next, { ...region, stop: join });
        this.meet(takenKnown);
        const ends = (body: GoalStatement[]) => ["break", "return"].includes(body.at(-1)?.kind ?? "");
        if (!ends(taken) && !ends(fall) && takenSp !== this.sp)
          throw new Unreadable(at, "two ways that leave the stack in different places");
        if (ends(fall)) {
          this.sp = takenSp;
          this.flags = takenFlags.flags;
          this.flagsAt = takenFlags.at;
        } else if (
          !ends(taken) &&
          (takenFlags.at !== this.flagsAt || JSON.stringify(takenFlags.flags) !== JSON.stringify(this.flags))
        ) {
          // The ways meet with flags set by different tests: a branch at the join can't tell which, so none may use
          // them (it is then unreadable).
          this.flags = undefined;
          this.flagsAt = -1;
        }
        // A branch on the sign of a sum, whose second number may be -32768: that number decides it alone.
        if (guard)
          out.push({
            kind: "if",
            test: guard.test,
            then: guard.taken ? taken : fall,
            else: [{ kind: "if", test, then: taken, else: fall }],
          });
        else out.push({ kind: "if", test, then: taken, else: fall });
        if (join === EXIT || join === region.stop) return out;
        at = join;
        continue;
      }
      if (i.flow === "jump") {
        const target = i.target!.address;
        const loop = target > at ? this.loopAt(target, next) : undefined;
        if (loop) {
          const exit = loop.exit;
          const before = this.run(target, { stop: loop.at, loopExit: exit });
          const branch = this.test(this.instruction(loop.at));
          // A test that leaves the loop, with a jump back to the body after it, goes on when it fails.
          const test = loop.leaves ? negate(branch) : branch;
          const sp = this.sp;
          const entered = this.known();
          const body = this.run(next, { stop: target, loopExit: exit });
          this.meet(entered);
          if (this.sp !== sp) throw new Unreadable(at, "a loop that moves the stack");
          out.push({ kind: "loop", before, test, body });
          at = exit;
          continue;
        }
        if (target <= at) throw new Unreadable(at, "a jump back that isn't a loop the reader knows");
        at = target;
        continue;
      }
      out.push(...this.step(i));
      if (i.flow === "return" || i.flow === "stop") {
        out.push({ kind: "return" });
        return out;
      }
      at = next;
    }
  }

  /** A join beyond the region's end ends at the region's end. */
  private inside(join: number, region: Region, at: number): number {
    if (join === EXIT || join <= at) return region.stop;
    if (region.stop !== EXIT && join > region.stop) return region.stop;
    return join;
  }

  /**
   * A loop entered by a jump to its test: code from `test` to a branch back to `body`. The test may leave the loop
   * early on the way, by branches to where the loop goes on after it (`while (a && b)`), which then read as breaks,
   * and may call routines (a `do … while` whose first part is jumped into, as Toons' goals find their parts). When the
   * body is too far for a short branch, the test is a branch that leaves the loop with a jump back after it
   * (`leaves`). `exit` is where the loop goes on.
   */
  private loopAt(test: number, body: number): { at: number; exit: number; leaves?: boolean } | undefined {
    let at = test;
    const exits: number[] = [];
    for (let n = 0; n < 40; n++) {
      const i = this.graph.instructions.get(at);
      if (!i) return undefined;
      if (i.flow === "branch" && i.target!.address === body)
        return exits.every((e) => e === at + i.size) ? { at, exit: at + i.size } : undefined;
      const back = this.graph.instructions.get(at + i.size);
      if (
        i.flow === "branch" &&
        back?.mnemonic === "jmp" &&
        back.target?.address === body &&
        i.target!.address === back.address + back.size
      )
        return exits.every((e) => e === i.target!.address) ? { at, exit: i.target!.address, leaves: true } : undefined;
      if (i.flow === "branch" && i.target!.address > at) exits.push(i.target!.address);
      else if (i.flow !== "next" && i.flow !== "call") return undefined;
      at += i.size;
    }
    return undefined;
  }

  /**
   * A branch's test, and for an ordered branch on the result of `add` a test that decides it first. After `sub a, b`
   * the flags are those of `cmp a, b`. After `add a, b` an ordered branch tests the sum without overflow, so `a + b ≥ 0`
   * is `a ≥ -b`, except when b is -32768, whose negation isn't a word: then the sum is below 0 whatever a is.
   */
  private branchTest(branch: Instruction): { test: GoalTest; guard?: { test: GoalTest; taken: boolean } } {
    const condition = CONDITIONS[branch.mnemonic];
    const flags = this.flags;
    const ordered = condition && condition.op !== "==" && condition.op !== "!=";
    if (
      !condition?.signed ||
      !ordered ||
      ["js", "jns"].includes(branch.mnemonic) ||
      flags?.kind !== "result" ||
      !flags.sum ||
      this.flagsAt !== branch.address
    )
      return { test: this.test(branch) };
    const { op, left, right } = flags.sum;
    if (op === "-") return { test: { ...condition, left, right } };
    return {
      test: { ...condition, left, right: { kind: "binary", op: "-", left: ZERO, right } },
      guard: {
        test: { op: "==", signed: false, left: right, right: { kind: "constant", value: 0x8000 } },
        taken: condition.op === "<" || condition.op === "<=",
      },
    };
  }

  private test(branch: Instruction): GoalTest {
    const condition = CONDITIONS[branch.mnemonic];
    if (!condition) throw new Unreadable(branch.address, `a branch the reader doesn't know (${branch.text})`);
    const flags = this.flags;
    if (!flags || this.flagsAt !== branch.address)
      throw new Unreadable(branch.address, "a branch on flags set further back than the instruction before");
    if (flags.kind === "compare") {
      if (branch.mnemonic === "js" || branch.mnemonic === "jns")
        throw new Unreadable(branch.address, "a sign branch after a compare");
      return { ...condition, left: flags.left, right: flags.right };
    }
    if (flags.kind === "and") {
      if (condition.op !== "==" && condition.op !== "!=")
        throw new Unreadable(branch.address, "an ordered branch after a test");
      return {
        ...condition,
        left: { kind: "binary", op: "&", left: flags.left, right: flags.right },
        right: ZERO,
      };
    }
    const ordered = condition.op !== "==" && condition.op !== "!=";
    if (ordered && !flags.logic && !["js", "jns"].includes(branch.mnemonic))
      throw new Unreadable(branch.address, "an ordered branch after arithmetic");
    if (!condition.signed && ordered) throw new Unreadable(branch.address, "an unsigned branch on a result");
    return { ...condition, left: flags.value, right: ZERO };
  }

  private setFlags(i: Instruction, flags: Flags) {
    this.flags = flags;
    this.flagsAt = i.address + i.size;
  }

  private value(operand: Operand | undefined, at: number): GoalValue {
    if (!operand) throw new Unreadable(at, "a missing operand");
    switch (operand.kind) {
      case "register":
        if (operand.width !== 16 || ["cs", "ds", "es", "ss", "sp", "bp"].includes(operand.name))
          throw new Unreadable(at, `the register ${operand.name}`);
        return { kind: "register", name: operand.name };
      case "immediate":
        return { kind: "constant", value: operand.value & 0xffff };
      case "memory": {
        if (operand.width !== 16 && operand.width !== 8)
          throw new Unreadable(at, `a ${operand.width}-bit memory operand`);
        const place = this.place(operand, at);
        // A byte local is kept as a word that holds only the byte; a byte elsewhere is the low byte of its word.
        if (place.kind === "local") {
          (operand.width === 8 ? this.byteLocals : this.wordLocals).add(place.offset);
          return place;
        }
        return operand.width === 8
          ? { kind: "binary", op: "&", left: place, right: { kind: "constant", value: 0xff } }
          : place;
      }
      default:
        throw new Unreadable(at, `an address operand (${operandText(operand)})`);
    }
  }

  /** Where a memory operand is: a local of the frame, or a word of memory at an address. */
  private place(operand: Extract<Operand, { kind: "memory" }>, at: number): GoalTarget {
    const far = operand.segment === "es" && this.es !== undefined ? FAR_WORDS + this.es * 0x10000 : undefined;
    if (operand.segment !== "ds" && far === undefined && !(operand.segment === "ss" && operand.base.join() === "bp"))
      throw new Unreadable(at, `memory through ${operand.segment}`);
    const displacement = (operand.displacement & 0xffff) + (far ?? 0);
    if (operand.base.includes("bp")) {
      if (operand.base.length !== 1) throw new Unreadable(at, "an indexed local");
      return { kind: "local", offset: displacement >= 0x8000 ? displacement - 0x10000 : displacement };
    }
    let address: GoalValue | undefined;
    for (const base of operand.base) {
      const register: GoalValue = { kind: "register", name: base };
      address = address ? { kind: "binary", op: "+", left: address, right: register } : register;
    }
    if (!address) address = { kind: "constant", value: displacement };
    else if (displacement)
      address = { kind: "binary", op: "+", left: address, right: { kind: "constant", value: displacement } };
    return { kind: "word", address };
  }

  /**
   * Writes a byte: a byte local takes the byte, and a byte elsewhere replaces the low byte of its word and keeps the
   * high one.
   */
  private setByte(operand: Extract<Operand, { kind: "memory" }>, value: GoalValue, at: number): GoalStatement {
    const place = this.place(operand, at);
    const byte: GoalValue =
      value.kind === "constant"
        ? { kind: "constant", value: value.value & 0xff }
        : { kind: "binary", op: "&", left: value, right: { kind: "constant", value: 0xff } };
    if (place.kind === "local") {
      this.byteLocals.add(place.offset);
      return this.set(place, byte);
    }
    const high: GoalValue = { kind: "binary", op: "&", left: place, right: { kind: "constant", value: 0xff00 } };
    return this.set(place, { kind: "binary", op: "|", left: high, right: byte });
  }

  private target(operand: Operand | undefined, at: number): GoalTarget {
    const value = this.value(operand, at);
    if (value.kind !== "register" && value.kind !== "local" && value.kind !== "word")
      throw new Unreadable(at, "a write to a constant");
    return value;
  }

  private set(target: GoalTarget, value: GoalValue): GoalStatement {
    return { kind: "set", target, value };
  }

  private step(i: Instruction): GoalStatement[] {
    const [a, b] = i.operands;
    // `mov es, register` after the register was loaded with a segment: the goal reads that segment's words next.
    if (i.mnemonic === "mov" && a?.kind === "register" && a.name === "es" && this.reading.farWords) {
      const segment = b?.kind === "register" ? this.constants.get(b.name) : undefined;
      if (segment === undefined) throw new Unreadable(i.address, "a segment in es that isn't a constant");
      this.es = segment;
      return [];
    }
    // A segment loaded into a register only to go into `es` next is no word of the goal's: it is kept, not said.
    if (this.reading.farWords && i.mnemonic === "mov" && a?.kind === "register" && b?.kind === "immediate") {
      for (let at = i.address + i.size, n = 0; n < 3; n++) {
        const next = this.graph.instructions.get(at);
        if (!next || next.flow !== "next") break;
        const [to, from] = next.operands;
        if (next.mnemonic === "mov" && to?.kind === "register" && to.name === "es") {
          if (from?.kind === "register" && from.name === a.name) {
            this.constants.set(a.name, b.value & 0xffff);
            return [];
          }
          break;
        }
        if (next.operands.some((o) => o.kind === "register" && o.name === a.name)) break;
        at += next.size;
      }
    }
    const statements = this.statements(i);
    for (const s of statements)
      if (s.kind === "set" && s.target.kind === "register") {
        if (s.value.kind === "constant") this.constants.set(s.target.name, s.value.value);
        else this.constants.delete(s.target.name);
      } else if (s.kind === "call") {
        // A routine the goal calls can change every register and es.
        this.constants.clear();
        this.es = undefined;
      }
    return statements;
  }

  private statements(i: Instruction): GoalStatement[] {
    const at = i.address;
    const [a, b] = i.operands;
    const binary = (op: GoalOperator, left: GoalValue, right: GoalValue): GoalValue => ({
      kind: "binary",
      op,
      left,
      right,
    });
    switch (i.mnemonic) {
      case "nop":
        return [];
      case "mov": {
        if (a?.kind === "register" && a.name === "sp") throw new Unreadable(at, "a move of the stack pointer");
        if (a?.kind === "memory" && a.width === 8) return [this.setByte(a, this.value(b, at), at)];
        if (a?.kind === "register" && a.width === 8) {
          // `mov al, byte; mov ah, 0`: the byte as a word in ax.
          const next = this.graph.instructions.get(at + i.size);
          const [high, zero] = next?.operands ?? [];
          const word = BYTE_PAIRS[a.name];
          if (
            !word ||
            next?.mnemonic !== "mov" ||
            high?.kind !== "register" ||
            high.name !== `${word[0]}h` ||
            zero?.kind !== "immediate" ||
            zero.value !== 0
          )
            throw new Unreadable(at, `the register ${a.name}`);
          this.skip = next.address;
          return [this.set({ kind: "register", name: word }, this.value(b, at))];
        }
        return [this.set(this.target(a, at), this.value(b, at))];
      }
      case "lea": {
        const source = this.value(b, at);
        if (source.kind !== "local") throw new Unreadable(at, "an address that isn't a local's");
        return [this.set(this.target(a, at), { kind: "localAddress", offset: source.offset })];
      }
      case "cmp":
        this.setFlags(i, { kind: "compare", left: this.value(a, at), right: this.value(b, at) });
        return [];
      case "test":
        this.setFlags(i, { kind: "and", left: this.value(a, at), right: this.value(b, at) });
        return [];
      case "xor":
      case "or":
      case "and": {
        const target = this.target(a, at);
        const same = b?.kind === "register" && a?.kind === "register" && a.name === b.name;
        if (same && i.mnemonic === "xor") {
          this.setFlags(i, { kind: "result", value: ZERO, logic: true });
          return [this.set(target, ZERO)];
        }
        if (same) {
          this.setFlags(i, { kind: "result", value: target, logic: true });
          return [];
        }
        const op = i.mnemonic === "xor" ? "^" : i.mnemonic === "or" ? "|" : "&";
        this.setFlags(i, { kind: "result", value: target, logic: true });
        return [this.set(target, binary(op, target, this.value(b, at)))];
      }
      case "add":
      case "sub": {
        if (a?.kind === "register" && a.name === "sp") {
          this.sp += (i.mnemonic === "add" ? 1 : -1) * this.count(b, at);
          return [];
        }
        const target = this.target(a, at);
        const source = this.value(b, at);
        const op = i.mnemonic === "add" ? "+" : "-";
        // The first number as it was, from the result: the result less the second, or plus it after `sub`.
        const sum = JSON.stringify(source).includes(JSON.stringify(target))
          ? undefined
          : ({ op, left: binary(op === "+" ? "-" : "+", target, source), right: source } as const);
        this.setFlags(i, { kind: "result", value: target, logic: false, ...(sum ? { sum } : {}) });
        return [this.set(target, binary(op, target, source))];
      }
      case "inc":
      case "dec": {
        if (a?.kind === "memory" && a.width === 8) {
          const op = i.mnemonic === "inc" ? "+" : "-";
          const write = this.setByte(a, binary(op, this.value(a, at), { kind: "constant", value: 1 }), at);
          this.setFlags(i, { kind: "result", value: this.value(a, at), logic: false });
          return [write];
        }
        const target = this.target(a, at);
        this.setFlags(i, { kind: "result", value: target, logic: false });
        return [this.set(target, binary(i.mnemonic === "inc" ? "+" : "-", target, { kind: "constant", value: 1 }))];
      }
      case "shl":
      case "sar":
      case "shr": {
        const target = this.target(a, at);
        this.setFlags(i, { kind: "result", value: target, logic: false });
        const op = i.mnemonic === "shl" ? "<<" : i.mnemonic === "sar" ? ">>" : ">>>";
        if (b?.kind !== "immediate") throw new Unreadable(at, "a shift by a register");
        return [this.set(target, binary(op, target, this.value(b, at)))];
      }
      case "cwd": {
        const next = this.graph.instructions.get(at + i.size);
        if (next?.mnemonic !== "idiv") throw new Unreadable(at, "cwd without a division after it");
        return [];
      }
      case "idiv": {
        const before = [...this.graph.instructions.values()].find((x) => x.address + x.size === at);
        if (before?.mnemonic !== "cwd") throw new Unreadable(at, "a division without cwd before it");
        const divisor = this.value(a, at);
        const ax: GoalTarget = { kind: "register", name: "ax" };
        const dx: GoalTarget = { kind: "register", name: "dx" };
        // The remainder first, from the old ax, kept in dx; then the quotient.
        return [this.set(dx, binary("%", ax, divisor)), this.set(ax, binary("/", ax, divisor))];
      }
      case "push": {
        // `push cs` before a near call makes it a far one: the routine's frame doesn't see it.
        if (a?.kind === "register" && a.name === "cs") return [];
        const value = this.value(a, at);
        this.sp -= 2;
        this.wordLocals.add(this.sp);
        return [this.set({ kind: "local", offset: this.sp }, value)];
      }
      case "pop": {
        if (this.sp >= 0) throw new Unreadable(at, "a pop of a word the routine didn't push");
        const statement = this.set(this.target(a, at), { kind: "local", offset: this.sp });
        this.sp += 2;
        return [statement];
      }
      case "call": {
        if (!i.target) throw new Unreadable(at, `an indirect call (${i.text})`);
        const target = this.reading.resolve?.(i.target.segment, i.target.offset) ?? i.target;
        const routine = target.segment * 16 + target.offset;
        this.calls.add(`${target.segment}:${target.offset}`);
        return [{ kind: "call", routine, segment: target.segment, offset: target.offset, stack: this.sp }];
      }
      case "retf":
      case "ret":
        return [];
      default:
        throw new Unreadable(at, `an instruction the reader doesn't know (${i.text})`);
    }
  }

  private count(operand: Operand | undefined, at: number) {
    if (operand?.kind !== "immediate") throw new Unreadable(at, "a stack change by a value that isn't constant");
    return operand.value;
  }
}

/**
 * Reads the goal routine at `segment:offset` and every routine it calls. Each routine is read once; a routine that
 * can't be read gives a problem instead, and so does every routine that calls it.
 */
export function readGoalRoutines(
  image: Uint8Array,
  segment: number,
  offset: number,
  known = new Map<number, GoalRoutine | GoalProblem>(),
  reading: GoalReading = {},
): Map<number, GoalRoutine | GoalProblem> {
  const pending = [`${segment}:${offset}`];
  const reached = new Set<number>();
  while (pending.length) {
    const [s, o] = pending.pop()!.split(":").map(Number) as [number, number];
    const address = s * 16 + o;
    if (reached.has(address)) continue;
    reached.add(address);
    const calls = new Set<string>();
    if (!known.has(address)) {
      try {
        const body = new RoutineReader(image, address, s, calls, reading).read();
        known.set(address, { address, segment: s, offset: o, body });
      } catch (problem) {
        if (!(problem instanceof Unreadable)) throw problem;
        known.set(address, { address, at: problem.at, reason: problem.message });
      }
    } else {
      const routine = known.get(address)!;
      if ("body" in routine) for (const callee of callsIn(routine.body)) calls.add(callee);
    }
    pending.push(...calls);
  }
  return known;
}

/** The routines a body calls, as `segment:offset`. */
function callsIn(body: GoalStatement[], out = new Set<string>()): Set<string> {
  for (const s of body) {
    if (s.kind === "call") out.add(`${s.segment}:${s.offset}`);
    else if (s.kind === "if") {
      callsIn(s.then, out);
      callsIn(s.else, out);
    } else if (s.kind === "loop") {
      callsIn(s.before, out);
      callsIn(s.body, out);
    }
  }
  return out;
}

/**
 * The words of the data segment a goal reads and writes, for the machine to give it. A word of a far segment comes
 * with its whole address (`FAR_WORDS` and up, see `farWord`).
 */
export interface GoalMemory {
  read(address: number): number;
  write(address: number, value: number): void;
}

/** A goal program read a register or local it never set: the game would read whatever was there. */
export class UnsetValue extends Error {}

/** A goal program divided by 0, which stops the game with a divide error. */
export class GoalDividesByZero extends Error {}

/** A goal program ran past its limit, like a search for a part that isn't there that runs on through memory. */
export class GoalRunsOn extends Error {}

/**
 * Runs a goal routine read by `readGoalRoutines` over the game's data segment words. Locals live on a stack of the
 * runner's own, from `0xf000` down, so a goal can pass their addresses around as the game does.
 */
export function runGoal(
  routines: ReadonlyMap<number, GoalRoutine | GoalProblem>,
  start: number,
  memory: GoalMemory,
  limit = 1_000_000,
  /** Told each test the program makes and whether it holds. */
  observe?: (test: GoalTest, holds: boolean) => void,
): void {
  const stack = new Map<number, number>();
  let steps = 0;
  const STACK_TOP = 0xf000;
  const onStack = (address: number) => address >= STACK_TOP - 0x2000 && address < STACK_TOP + 0x100;
  // A word of a far segment (`FAR_WORDS` and up) goes to the memory as it is.
  const read = (address: number) => {
    if (address >= FAR_WORDS) return memory.read(address) & 0xffff;
    address &= 0xffff;
    if (!onStack(address)) return memory.read(address) & 0xffff;
    const value = stack.get(address);
    if (value === undefined) throw new UnsetValue(`the stack word ${hex(address)} was never set`);
    return value;
  };
  const write = (address: number, value: number) => {
    if (address >= FAR_WORDS) return memory.write(address, value & 0xffff);
    address &= 0xffff;
    if (onStack(address)) stack.set(address, value & 0xffff);
    else memory.write(address, value & 0xffff);
  };

  const call = (address: number, bp: number): number | undefined => {
    const routine = routines.get(address);
    if (!routine) throw new Error(`no routine read at ${hex(address)}`);
    if (!("body" in routine)) throw new Error(`the routine at ${hex(address)} isn't read: ${routine.reason}`);
    const registers = new Map<string, number>();
    const evaluate = (v: GoalValue): number => {
      switch (v.kind) {
        case "constant":
          return v.value >= FAR_WORDS ? v.value : v.value & 0xffff;
        case "register": {
          const value = registers.get(v.name);
          if (value === undefined) throw new UnsetValue(`${v.name} was never set`);
          return value;
        }
        case "local":
          return read(bp + v.offset);
        case "localAddress":
          return (bp + v.offset) & 0xffff;
        case "word":
          return read(evaluate(v.address));
        case "binary": {
          const l = evaluate(v.left);
          const r = evaluate(v.right);
          const sl = l >= 0x8000 ? l - 0x10000 : l;
          const sr = r >= 0x8000 ? r - 0x10000 : r;
          // A place of a far segment plus or less a number stays in that segment.
          const far = farWord(Math.max(l, r));
          if (far && (v.op === "+" || v.op === "-"))
            return FAR_WORDS + far.segment * 0x10000 + ((far.offset + (v.op === "+" ? Math.min(l, r) : -r)) & 0xffff);
          switch (v.op) {
            case "+":
              return (l + r) & 0xffff;
            case "-":
              return (l - r) & 0xffff;
            case "&":
              return l & r;
            case "|":
              return l | r;
            case "^":
              return l ^ r;
            case "<<":
              return (l << (r & 0x1f)) & 0xffff;
            case ">>":
              return (sl >> Math.min(r & 0x1f, 15)) & 0xffff;
            case ">>>":
              return l >>> (r & 0x1f);
            case "/":
            case "%": {
              if (sr === 0) throw new GoalDividesByZero("the goal divides by 0");
              return (v.op === "/" ? Math.trunc(sl / sr) : sl % sr) & 0xffff;
            }
          }
        }
      }
    };
    const holds = (t: GoalTest) => {
      let l = evaluate(t.left);
      let r = evaluate(t.right);
      if (t.signed) {
        l = l >= 0x8000 ? l - 0x10000 : l;
        r = r >= 0x8000 ? r - 0x10000 : r;
      }
      const result =
        t.op === "=="
          ? l === r
          : t.op === "!="
            ? l !== r
            : t.op === "<"
              ? l < r
              : t.op === "<="
                ? l <= r
                : t.op === ">"
                  ? l > r
                  : l >= r;
      observe?.(t, result);
      return result;
    };
    /** Runs statements; says whether a break or a return ended them. */
    const exec = (body: GoalStatement[]): "break" | "return" | undefined => {
      for (const s of body) {
        if (++steps > limit) throw new GoalRunsOn(`the goal ran past ${limit} steps`);
        switch (s.kind) {
          case "set": {
            let value: number | undefined;
            try {
              value = evaluate(s.value);
            } catch (problem) {
              // Copying a register or a stack word that was never set, like saving si on entry, copies nothing.
              if (!(problem instanceof UnsetValue) || !["register", "local"].includes(s.value.kind)) throw problem;
            }
            if (s.target.kind === "register") {
              if (value === undefined) registers.delete(s.target.name);
              else registers.set(s.target.name, value);
            } else {
              const address = s.target.kind === "local" ? bp + s.target.offset : evaluate(s.target.address);
              if (value !== undefined) write(address, value);
              else if (onStack(address & 0xffff)) stack.delete(address & 0xffff);
              else throw new UnsetValue(`a write of an unset value to ${hex(address)}`);
            }
            break;
          }
          case "call": {
            // The caller's pushed words are at `stack`; the far return address and the saved bp lie below them.
            const ax = call(s.routine, bp + s.stack - 6);
            registers.delete("dx");
            if (ax === undefined) registers.delete("ax");
            else registers.set("ax", ax);
            break;
          }
          case "if": {
            const end = exec(holds(s.test) ? s.then : s.else);
            if (end) return end;
            break;
          }
          case "loop": {
            for (;;) {
              // A break in the test's part leaves the loop, as a branch out of `while (a && b)` does.
              const before = exec(s.before);
              if (before === "break") break;
              if (before) return before;
              if (!holds(s.test)) break;
              const end = exec(s.body);
              if (end === "break") break;
              if (end === "return") return end;
            }
            break;
          }
          case "break":
            return "break";
          case "return":
            return "return";
        }
      }
      return undefined;
    };
    exec(routine.body);
    return registers.get("ax");
  };
  call(start, STACK_TOP);
}
