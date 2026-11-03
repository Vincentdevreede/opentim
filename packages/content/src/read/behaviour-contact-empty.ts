/** Proves the contact scanner's early zero return while retaining its preceding global context store. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { Finding } from "./behaviour.ts";
import type { Operand } from "./x86.ts";
const reg = (o: Operand | undefined, name: string) => o?.kind === "register" && o.name === name;
const global = (o: Operand | undefined) => o?.kind === "memory" && o.segment === "ds" && o.direct && o.width === 16;

export interface EmptyContactReturn extends Finding {
  argumentOffset: 6;
  outlineField: number;
  subjectGlobal: number;
  returnValue: 0;
}

/** The prefix is checked with all internal edges; the selected suffix may only clear AX, jump and restore the frame. */
export function discoverEmptyContactReturn(code: RoutineCode): EmptyContactReturn | undefined {
  if (code.status !== "complete" || code.instructions.length < 14) return;
  const prefix = code.instructions.slice(0, 9),
    branch = prefix[8]!;
  if (branch.mnemonic !== "jne" || branch.flow !== "branch") return;
  const falseEdge = code.edges.find((e) => e.from === branch.address && e.kind === "not-taken");
  if (falseEdge?.to === null || falseEdge?.to === undefined) return;
  const [push, frame, saveSI, saveDI, argument, context, reload, last] = prefix;
  const memory = last!.operands[0],
    zero = last!.operands[1];
  const subject = context!.operands[0];
  if (
    push!.mnemonic !== "push" ||
    !reg(push!.operands[0], "bp") ||
    frame!.mnemonic !== "mov" ||
    !reg(frame!.operands[0], "bp") ||
    !reg(frame!.operands[1], "sp") ||
    saveSI!.mnemonic !== "push" ||
    !reg(saveSI!.operands[0], "si") ||
    saveDI!.mnemonic !== "push" ||
    !reg(saveDI!.operands[0], "di") ||
    argument!.mnemonic !== "mov" ||
    !reg(argument!.operands[0], "ax") ||
    argument!.operands[1]?.kind !== "memory" ||
    argument!.operands[1].segment !== "ss" ||
    argument!.operands[1].base.join() !== "bp" ||
    argument!.operands[1].displacement !== 6 ||
    argument!.operands[1].width !== 16 ||
    context!.mnemonic !== "mov" ||
    !global(subject) ||
    !reg(context!.operands[1], "ax") ||
    reload!.mnemonic !== "mov" ||
    !reg(reload!.operands[0], "bx") ||
    !global(reload!.operands[1]) ||
    reload!.operands[1]?.kind !== "memory" ||
    subject?.kind !== "memory" ||
    reload!.operands[1].displacement !== subject.displacement ||
    last!.mnemonic !== "cmp" ||
    memory?.kind !== "memory" ||
    memory.segment !== "ds" ||
    memory.base.join() !== "bx" ||
    memory.width !== 16 ||
    zero?.kind !== "immediate" ||
    zero.value !== 0
  )
    return;
  for (const [n, i] of prefix.slice(0, 8).entries()) {
    const edges = code.edges.filter((e) => e.from === i.address);
    if (
      i.prefixes.length ||
      i.flow !== "next" ||
      edges.length !== 1 ||
      edges[0]!.kind !== "next" ||
      edges[0]!.to !== prefix[n + 1]!.address ||
      i.address + i.size !== prefix[n + 1]!.address
    )
      return;
  }
  const branchEdges = code.edges.filter((e) => e.from === branch.address);
  if (
    branch.prefixes.length ||
    branchEdges.length !== 2 ||
    !branchEdges.some((e) => e.kind === "taken" && e.to === branch.target?.address) ||
    falseEdge.to !== branch.address + branch.size
  )
    return;
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  let at = falseEdge.to,
    zeroed = false;
  const selected = [];
  for (let n = 0; n < 12; n++) {
    const i = byAddress.get(at);
    if (!i || i.prefixes.length) return;
    selected.push(i);
    const edges = code.edges.filter((e) => e.from === i.address);
    if (
      i.mnemonic === "xor" &&
      i.operands.length === 2 &&
      i.operands.every((o) => o.kind === "register" && o.name === "ax")
    )
      zeroed = true;
    else if (
      i.mnemonic === "jmp" &&
      i.flow === "jump" &&
      edges.length === 1 &&
      edges[0]!.kind === "jump" &&
      edges[0]!.to === i.target?.address
    ) {
      at = i.target.address;
      continue;
    } else if (
      i.mnemonic === "retf" &&
      i.operands.length === 0 &&
      i.flow === "return" &&
      edges.length === 1 &&
      edges[0]!.to === null &&
      edges[0]!.kind === "return"
    ) {
      if (!zeroed) return;
      return {
        argumentOffset: 6,
        outlineField: memory.displacement,
        subjectGlobal: subject.displacement,
        returnValue: 0,
        confidence: "inferred",
        evidence: [...prefix, ...selected].map(({ address, bytes, text }) => ({ address, bytes, text })),
        assumptions: [
          "The valid private C frame and global subject word are separate from the part. The zero-outline branch first stores the passed owner pointer in that global word, then returns zero without any part store or call.",
        ],
      };
    } else if (!(
      i.mnemonic === "pop" &&
      i.operands[0]?.kind === "register" &&
      ["di", "si", "bp"].includes(i.operands[0].name)
    ))
      return;
    if (edges.length !== 1 || edges[0]!.kind !== "next" || edges[0]!.to !== i.address + i.size) return;
    at = i.address + i.size;
  }
}
