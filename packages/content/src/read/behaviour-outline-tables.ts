/**
 * Resets that copy their outline from tables in the data segment, like the curved pipe wall's and the electric
 * switch's. The routine loads its part from its first argument, picks a table by tests of the part's frame, and copies
 * N two-byte corners into the outline records its outline pointer leads to, four bytes apart:
 *
 *     mov di, <table>          (one per frame test)
 *     mov word [bp-C], 0
 *     mov ax, word [si+<outline pointer>]
 *     mov word [bp-P], ax
 *   body:
 *     mov al, byte [di]  /  mov bx, word [bp-P]  /  mov byte [bx], al
 *     mov al, byte [di+1]  /  (mov bx, word [bp-P])  /  mov byte [bx+1], al
 *     inc word [bp-C]  /  add word [bp-P], 4  /  add di, 2
 *     cmp word [bp-C], N  /  jl body
 *
 * The reload of `bx` before the second store is only in some builds. Every path from the entry to the loop is
 * followed, so each table comes with the frame tests that pick it.
 */
import type { Evidence, Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { Instruction, Operand } from "./x86.ts";

export interface OutlineTableChoice {
  /** The frame tests of each path that picks this table, like `frame == 0` or `frame >= 4`. */
  when: string[][];
  /** The table's offset in the data segment. */
  address: number;
  corners: [number, number][];
}

export interface OutlineTables extends Finding {
  routine: number;
  tables: OutlineTableChoice[];
}

/**
 * The table a copy takes for a part on this frame with these drawing flags: the one whose tests hold on one of its
 * paths. Undefined when no table or more than one fits, or a test isn't a frame or drawing flag test.
 */
export function pickOutlineTable<Table extends Pick<OutlineTableChoice, "when">>(
  copy: { tables: Table[] },
  frame: number,
  flags: number,
): Table | undefined {
  const holds = (test: string): boolean | undefined => {
    const flag = /^flags & 0x([0-9a-f]+) (==|!=) 0$/.exec(test);
    if (flag) return ((flags & parseInt(flag[1]!, 16)) !== 0) === (flag[2] === "!=");
    const range = /^frame (==|!=|<|<=|>|>=) (-?\d+)$/.exec(test);
    if (!range) return undefined;
    const value = Number(range[2]);
    return {
      "==": frame === value,
      "!=": frame !== value,
      "<": frame < value,
      "<=": frame <= value,
      ">": frame > value,
      ">=": frame >= value,
    }[range[1]!];
  };
  const fits = copy.tables.filter((table) => table.when.some((tests) => tests.every((test) => holds(test) === true)));
  return fits.length === 1 ? fits[0] : undefined;
}

export const OUTLINE_TABLE_ASSUMPTION =
  "The outline tables keep the bytes the program ships with: no instruction found writes to them directly.";

type Memory = Extract<Operand, { kind: "memory" }>;
const memory = (operand: Operand | undefined): Memory | undefined => (operand?.kind === "memory" ? operand : undefined);
const register = (operand: Operand | undefined, name?: string) =>
  operand?.kind === "register" && (name === undefined || operand.name === name);
const immediate = (operand: Operand | undefined) => (operand?.kind === "immediate" ? operand.value : undefined);
const local = (operand: Operand | undefined) => {
  const m = memory(operand);
  return m && m.base.length === 1 && m.base[0] === "bp" && m.displacement < 0 ? m.displacement : undefined;
};
const evidenceOf = (list: Instruction[]): Evidence[] =>
  list.map(({ address, bytes, text }) => ({ address, bytes, text }));

const JUMPS: Record<string, [string, string]> = {
  je: ["==", "!="],
  jne: ["!=", "=="],
  jl: ["<", ">="],
  jge: [">=", "<"],
  jg: [">", "<="],
  jle: ["<=", ">"],
  jb: ["<", ">="],
  jae: [">=", "<"],
  ja: [">", "<="],
  jbe: ["<=", ">"],
};

/** The copy loop's shape: the table register, the corner count and the instructions that prove it, or undefined. */
function copyLoop(code: RoutineCode, outlineOffset: number) {
  const list = code.instructions;
  for (let n = 0; n + 3 < list.length; n++) {
    const [zero, load, keep] = [list[n]!, list[n + 1]!, list[n + 2]!];
    const counter = local(zero.operands[0]);
    const pointerLoad = memory(load.operands[1]);
    if (
      zero.mnemonic !== "mov" ||
      counter === undefined ||
      immediate(zero.operands[1]) !== 0 ||
      load.mnemonic !== "mov" ||
      !register(load.operands[0], "ax") ||
      !pointerLoad ||
      pointerLoad.width !== 16 ||
      pointerLoad.base.length !== 1 ||
      pointerLoad.displacement !== outlineOffset ||
      keep.mnemonic !== "mov" ||
      local(keep.operands[0]) === undefined ||
      !register(keep.operands[1], "ax")
    )
      continue;
    const pointer = local(keep.operands[0])!;
    const owner = pointerLoad.base[0]!;
    // The loop: a jump to the test, the body, the test and a jump back to the body.
    const after = list.slice(n + 3);
    const jump = after[0];
    const test = after.findIndex((i) => i.mnemonic === "cmp" && local(i.operands[0]) === counter);
    if (!jump || jump.mnemonic !== "jmp" || test < 0) continue;
    const back = after[test + 1];
    const body = after.slice(1, test);
    const count = immediate(after[test]!.operands[1]);
    if (
      !back ||
      back.mnemonic !== "jl" ||
      back.target?.address !== body[0]?.address ||
      jump.target?.address !== after[test]!.address
    )
      continue;
    const table = memory(body[0]?.operands[1])?.base[0];
    const reloads = body.length === 9;
    if (!table || count === undefined || count < 1 || count > 64 || (body.length !== 8 && !reloads)) continue;
    const at = (k: number) => body[k]!;
    const store = (i: Instruction, displacement: number) =>
      i.mnemonic === "mov" &&
      memory(i.operands[0])?.base.join() === "bx" &&
      memory(i.operands[0])?.displacement === displacement &&
      memory(i.operands[0])?.width === 8 &&
      register(i.operands[1], "al");
    const read = (i: Instruction, displacement: number) =>
      i.mnemonic === "mov" &&
      register(i.operands[0], "al") &&
      memory(i.operands[1])?.base.join() === table &&
      memory(i.operands[1])?.displacement === displacement &&
      memory(i.operands[1])?.segment === "ds";
    const bx = (i: Instruction) =>
      i.mnemonic === "mov" && register(i.operands[0], "bx") && local(i.operands[1]) === pointer;
    const k = reloads ? 1 : 0;
    const ok =
      read(at(0), 0) &&
      bx(at(1)) &&
      store(at(2), 0) &&
      read(at(3), 1) &&
      (!reloads || bx(at(4))) &&
      store(at(4 + k), 1) &&
      local(at(5 + k).operands[0]) === counter &&
      at(5 + k).mnemonic === "inc" &&
      at(6 + k).mnemonic === "add" &&
      local(at(6 + k).operands[0]) === pointer &&
      immediate(at(6 + k).operands[1]) === 4 &&
      at(7 + k).mnemonic === "add" &&
      register(at(7 + k).operands[0], table) &&
      immediate(at(7 + k).operands[1]) === 2;
    if (!ok) continue;
    return { start: zero.address, owner, table, count, proof: [zero, load, keep, jump, ...body, after[test]!, back] };
  }
  return undefined;
}

/** The data segment addresses an instruction writes by address, in any routine the analysis read. */
export function dataWrites(allCodes: Iterable<RoutineCode>): Set<number> {
  const writes = new Set<number>();
  for (const code of allCodes)
    for (const i of code.instructions) {
      const target = memory(i.operands[0]);
      if (
        target &&
        target.base.length === 0 &&
        target.segment === "ds" &&
        !["cmp", "test", "push"].includes(i.mnemonic)
      )
        for (let k = 0; k < target.width / 8; k++) writes.add((target.displacement + k) & 0xffff);
    }
  return writes;
}

/**
 * Reads a routine's outline table copy, with the frame tests that pick each table. `image` and `dataSegment` give the
 * table bytes. Returns undefined when the routine has no such copy or a path to it does anything else.
 */
export function readOutlineTables(
  code: RoutineCode,
  image: Uint8Array,
  dataSegment: number,
  fields: { outline: number; state: number },
  allCodes: Iterable<RoutineCode>,
): OutlineTables | undefined {
  if (code.status !== "complete") return undefined;
  const loop = copyLoop(code, fields.outline);
  if (!loop) return undefined;
  const byAddress = new Map(code.instructions.map((i, n) => [i.address, n]));
  const list = code.instructions;
  // The owner register is loaded from the first argument.
  const ownerLoad = list.find(
    (i) => i.mnemonic === "mov" && register(i.operands[0], loop.owner) && memory(i.operands[1])?.base.join() === "bp",
  );
  if (!ownerLoad || memory(ownerLoad.operands[1])!.displacement !== 6) return undefined;
  const paths: { when: string[]; table: number; proof: Instruction[] }[] = [];
  const visit = (
    n: number,
    when: string[],
    table: number | undefined,
    proof: Instruction[],
    steps: number,
  ): boolean => {
    if (steps > 64 || paths.length > 16) return false;
    const i = list[n];
    if (!i) return false;
    if (i.address === loop.start) {
      if (table === undefined) return false;
      paths.push({ when, table, proof });
      return true;
    }
    const next = (k: number, w = when, t = table) => visit(k, w, t, [...proof, i], steps + 1);
    const to = (target: number | undefined) => (target === undefined ? undefined : byAddress.get(target));
    if (i.mnemonic === "mov" && register(i.operands[0], loop.table)) {
      const value = immediate(i.operands[1]);
      return value !== undefined && next(n + 1, when, value);
    }
    if (i.mnemonic === "cmp") {
      const frame = memory(i.operands[0]);
      const value = immediate(i.operands[1]);
      const branch = list[n + 1];
      const words = branch && JUMPS[branch.mnemonic];
      const taken = to(branch?.target?.address);
      if (
        !frame ||
        frame.base.join() !== loop.owner ||
        frame.displacement !== fields.state ||
        frame.width !== 16 ||
        value === undefined ||
        !words ||
        taken === undefined
      )
        return false;
      const test = (op: string) => `frame ${op} ${value}`;
      return (
        visit(taken, [...when, test(words[0])], table, [...proof, i, branch!], steps + 1) &&
        visit(n + 2, [...when, test(words[1])], table, [...proof, i, branch!], steps + 1)
      );
    }
    if (i.mnemonic === "jmp") {
      const target = to(i.target?.address);
      return target !== undefined && next(target);
    }
    // Setting up the frame and saving registers changes nothing the copy reads.
    if (
      (i.mnemonic === "push" && i.operands.every((o) => register(o))) ||
      (i.mnemonic === "mov" && register(i.operands[0], "bp") && register(i.operands[1], "sp")) ||
      (i.mnemonic === "sub" && register(i.operands[0], "sp") && immediate(i.operands[1]) !== undefined) ||
      i === ownerLoad
    )
      return next(n + 1);
    return false;
  };
  if (!visit(0, [], undefined, [], 0) || !paths.length) return undefined;
  // No instruction the analysis read writes into a table by its address.
  const writes = [...dataWrites(allCodes)];
  if (paths.some((path) => writes.some((at) => at >= path.table && at < path.table + loop.count * 2))) return undefined;
  const base = dataSegment * 16;
  const tables = new Map<number, OutlineTableChoice & { proof: Instruction[] }>();
  for (const path of paths) {
    const at = base + path.table;
    if (at + loop.count * 2 > image.length) return undefined;
    const corners = Array.from({ length: loop.count }, (_, k): [number, number] => [
      image[at + 2 * k]!,
      image[at + 2 * k + 1]!,
    ]);
    const prior = tables.get(path.table);
    if (prior) prior.when.push(path.when);
    else tables.set(path.table, { when: [path.when], address: path.table, corners, proof: path.proof });
  }
  return {
    routine: code.address,
    tables: [...tables.values()].map(({ when, address, corners }) => ({ when, address, corners })),
    confidence: "inferred",
    assumptions: [OUTLINE_TABLE_ASSUMPTION],
    evidence: evidenceOf([...new Set([...paths.flatMap((p) => p.proof), ...loop.proof])]),
  };
}
