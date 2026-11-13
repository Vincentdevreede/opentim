/**
 * The small building blocks the behaviour readers share: expressions and predicates made by hand, evidence from
 * instructions, tests of instruction operands, and a few words for lists. Each reader used to keep its own copy.
 *
 * The object literals keep their key order, because readers compare expressions by their JSON text.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { Evidence, Expression, Predicate } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";

/** A number, a word unless `width` says otherwise. */
export const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
/** A field of an object the analysis names, like `part` or `collider`. */
export const field = (object: string, offset: number, width = 16): Expression => ({
  kind: "field",
  object,
  offset,
  width,
});
/** A word of the part itself. */
export const partField = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
/** A word of the routine's argument block. */
export const argumentField = (offset: number): Expression => ({ kind: "field", object: "argument", offset, width: 16 });
/** A value the analysis can't name, with why. */
export const unknown = (reason: string, width = 16): Expression => ({ kind: "unknown", reason, width });
/** Two values with an operator between them, as given: unlike the reader's own `binary`, nothing is folded. */
export const binary = (operator: string, left: Expression, right: Expression, width = 16): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width,
});
/** A compare of two values, unsigned unless `signed` says so. */
export const compare = (operator: string, left: Expression, right: Expression, signed = false): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed,
});
/** All of the tests, "always" for none. */
export const conjunction = (list: Predicate[]): Predicate =>
  list.length === 0 ? { kind: "true" } : list.length === 1 ? list[0]! : { kind: "and", terms: list };

/** One instruction as evidence. */
export const evidenceOf = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
/** Every instruction of a routine as evidence. */
export const routineEvidence = (code: RoutineCode): Evidence[] =>
  code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));
/** Evidence without repeats, one item per address. */
export const uniqueEvidence = (list: Evidence[]) => {
  const byAddress = new Map<number, Evidence>();
  for (const e of list) byAddress.set(e.address, e);
  return [...byAddress.values()];
};
/**
 * The instructions that store to memory outside the stack frame: the compact evidence a caller's findings carry. The
 * summary itself keeps the whole routine.
 */
export const outsideStores = (code: RoutineCode): Evidence[] =>
  code.instructions
    .filter(
      (i) =>
        i.flow === "next" &&
        !["cmp", "test", "push"].includes(i.mnemonic) &&
        i.operands[0]?.kind === "memory" &&
        !(i.operands[0].segment === "ss" && i.operands[0].base.join() === "bp"),
    )
    .map(({ address, bytes, text }) => ({ address, bytes, text }));
/** The places a routine's code binds when it matches the first of the patterns it fits, for complete code only. */
export function matchFirst(code: RoutineCode, patterns: string[]): Map<string, number> | undefined {
  if (code.status !== "complete") return undefined;
  for (const pattern of patterns) {
    const bound = matchHeapRoutine(code, pattern, new Map());
    if (bound) return bound;
  }
  return undefined;
}

/** A register operand, and the one named `name` when given. */
export const isRegister = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
/** Whether two register names share bits, like `ax` and `al`. */
const registersOverlap = (a: string, b: string) =>
  a === b ||
  (/^[abcd][xlh]$/.test(a) &&
    /^[abcd][xlh]$/.test(b) &&
    a[0] === b[0] &&
    (a[1] === "x" || b[1] === "x" || a[1] === b[1]));
/** The registers that instructions write whatever their operands say. */
const IMPLICIT_WRITES: Record<string, string[]> = {
  cwd: ["dx"],
  cbw: ["ax"],
  mul: ["ax", "dx"],
  imul: ["ax", "dx"],
  div: ["ax", "dx"],
  idiv: ["ax", "dx"],
  lodsw: ["ax"],
  lodsb: ["ax"],
  in: ["ax"],
};
/**
 * Whether the instruction may change the register or one that shares its bits: as its first operand, as either
 * operand of `xchg` or `pop`, or as a register that multiplies, divides, sign extensions and string loads write.
 */
export const writesRegister = (i: Instruction, name: string) =>
  (isRegister(i.operands[0]) &&
    registersOverlap(i.operands[0].name, name) &&
    !["cmp", "test", "push"].includes(i.mnemonic)) ||
  (["pop", "xchg"].includes(i.mnemonic) && i.operands.some((o) => isRegister(o) && registersOverlap(o.name, name))) ||
  // Only the one operand form of imul writes ax and dx; `imul bx, cx, 2` writes just its first operand.
  ((i.mnemonic !== "imul" || i.operands.length === 1) &&
    (IMPLICIT_WRITES[i.mnemonic] ?? []).some((written) => registersOverlap(written, name)));
/** A 16-bit register operand, and the one named `name` when given. */
export const isWordRegister = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && o.width === 16 && (name === undefined || o.name === name);
/** A memory operand. */
export const isMemory = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
/** The operand when it is memory. */
export const memoryOperand = (o: Operand | undefined): Extract<Operand, { kind: "memory" }> | undefined =>
  o?.kind === "memory" ? o : undefined;
/** An immediate operand, and the one with `value` when given. */
export const isImmediate = (o: Operand | undefined, value?: number): o is Extract<Operand, { kind: "immediate" }> =>
  o?.kind === "immediate" && (value === undefined || o.value === value);
/** Whether two operands are the same. */
export const sameOperand = (a: Operand | undefined, b: Operand | undefined) => JSON.stringify(a) === JSON.stringify(b);
/** The word register a byte register is half of, like ax for al; any other name as it is. */
export const wholeRegister = (name: string) =>
  ({ al: "ax", ah: "ax", bl: "bx", bh: "bx", cl: "cx", ch: "cx", dl: "dx", dh: "dx" })[name] ?? name;
/** An instruction that reads or writes memory its operands don't show, like `movs` or `int`. */
export const implicitMemory = (i: Instruction) =>
  /^(movs|stos|ins|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic);
/** An instruction that stores to the memory of its first operand. */
export const storesToMemory = (i: Instruction) =>
  isMemory(i.operands[0]) && !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
/** Whether a write of `width` bits at `offset` touches the word at `word`. */
export const overlapsWord = (offset: number, width: number, word: number) =>
  offset < word + 2 && word < offset + width / 8;
/** Words at the offsets, as fields. */
export const wordFields = (...offsets: number[]): { offset: number; width: number }[] =>
  offsets.map((offset) => ({ offset, width: 16 }));

/** The little-endian word at `at`. */
export const wordAt = (image: Uint8Array, at: number) => image[at]! | (image[at + 1]! << 8);
/** A number as the unsigned value of `width` bits that holds it. */
export const unsigned = (n: number, width: number) => {
  const size = width === 16 ? 0x10000 : width === 8 ? 0x100 : 2 ** width;
  return n > 0 && n < size ? n : ((n % size) + size) % size;
};
/** An unsigned value of `width` bits read as signed. */
export const toSigned = (value: number, width: number) => (value >= 2 ** (width - 1) ? value - 2 ** width : value);

/** Whether a value is a plain object, not null and not a list. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** Items as words: "a", "a and b", "a, b and c". */
export const listWords = (items: string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
