/** Conditional contracts for routines that consume a list supplied by their caller. */
import type { Evidence, Finding, IterationOutcome } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { discoverListLoops, type ListLoopSummary } from "./behaviour-list-loops.ts";
import type { Instruction, Operand } from "./x86.ts";

/** These effects hold only when the caller proves every listed requirement. */
export interface ExternalListConsumer extends Finding {
  address: number;
  argumentOffset: number;
  headInstruction: number;
  headField: number;
  nextField: number;
  loop: ListLoopSummary;
  fields: { root: "member" | "outline"; offset: number; width: number }[];
  returnConvention: { kind: "near" | "far"; stackBytes: 0 };
  unknownGlobals: boolean;
  requires: { finite: true; acyclic: true; completeBases: true; excludesArgument: true };
  /** What it does to one member, path by path, read from the consumer once its own analysis is done. */
  memberOutcomes?: IterationOutcome[];
}
const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const mem = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const imm = (o: Operand | undefined): o is Extract<Operand, { kind: "immediate" }> => o?.kind === "immediate";
const evidence = ({ address, bytes, text }: Instruction): Evidence => ({ address, bytes, text });
const parent = (name: string) =>
  ({ al: "ax", ah: "ax", bl: "bx", bh: "bx", cl: "cx", ch: "cx", dl: "dx", dh: "dx" })[name] ?? name;
const prefixOperations = new Set([
  "mov",
  "add",
  "sub",
  "and",
  "or",
  "xor",
  "cmp",
  "test",
  "inc",
  "dec",
  "neg",
  "not",
  "shl",
  "sal",
  "shr",
  "sar",
  "cwd",
  "cbw",
  "nop",
]);

/** Checks the entire routine around the independently proved loop, including its frame and all return paths. */
function frame(code: RoutineCode, loop: ListLoopSummary, head: Instruction) {
  const ordered = code.instructions,
    first = ordered[0],
    second = ordered[1];
  if (
    first?.address !== code.address ||
    first.mnemonic !== "push" ||
    !reg(first.operands[0], "bp") ||
    second?.mnemonic !== "mov" ||
    !reg(second.operands[0], "bp") ||
    !reg(second.operands[1], "sp")
  )
    return;
  let cursor = 2,
    locals = 0;
  const allocation = ordered[cursor];
  if (allocation?.mnemonic === "sub" && reg(allocation.operands[0], "sp") && imm(allocation.operands[1])) {
    locals = allocation.operands[1].value;
    if (locals <= 0 || locals % 2 || locals > 0x7fff) return;
    cursor++;
  }
  if (
    loop.possibleFields.some(
      (f) =>
        f.root === "stack" &&
        (![8, 16].includes(f.width) || f.offset < -locals || f.offset >= 0 || f.offset + f.width / 8 > 0),
    )
  )
    return;
  const saved: string[] = [];
  while (
    ordered[cursor]?.mnemonic === "push" &&
    reg(ordered[cursor]!.operands[0]) &&
    ["si", "di"].includes((ordered[cursor]!.operands[0] as Extract<Operand, { kind: "register" }>).name)
  ) {
    saved.push((ordered[cursor]!.operands[0] as Extract<Operand, { kind: "register" }>).name);
    cursor++;
  }
  if (
    new Set(saved).size !== saved.length ||
    loop.writtenRegisters.some((r) => ["si", "di"].includes(r) && !saved.includes(r))
  )
    return;
  const headIndex = ordered.indexOf(head);
  if (headIndex < cursor) return;
  const prefix = ordered.slice(0, headIndex + 1);
  for (const i of ordered.slice(cursor, headIndex + 1)) {
    if (i.flow !== "next" || !prefixOperations.has(i.mnemonic)) return;
    const [destination] = i.operands;
    const writes = !["cmp", "test", "cwd", "cbw", "nop"].includes(i.mnemonic);
    if (writes && reg(destination)) {
      if (["bp", "sp", "ss", "ds", "cs", "es"].includes(destination.name)) return;
      if (["si", "di"].includes(parent(destination.name)) && !saved.includes(parent(destination.name))) return;
    }
    if (
      writes &&
      mem(destination) &&
      !(
        destination.segment === "ss" &&
        destination.base.join() === "bp" &&
        [8, 16].includes(destination.width) &&
        destination.displacement >= -locals &&
        destination.displacement < 0 &&
        destination.displacement + destination.width / 8 <= 0
      )
    )
      return;
    // A frame address cannot escape through a value operand or an alternative SS/SP addressing form.
    if (i.operands.some((o) => reg(o) && ["bp", "sp", "ss"].includes(o.name))) return;
    if (
      i.operands.some(
        (o) => mem(o) && (o.segment === "ss" ? o.base.join() !== "bp" : o.base.some((b) => ["bp", "sp"].includes(b))),
      )
    )
      return;
  }
  let jumpIndex = headIndex + 1;
  while (ordered[jumpIndex]?.mnemonic === "nop") {
    prefix.push(ordered[jumpIndex]!);
    jumpIndex++;
  }
  const jump = ordered[jumpIndex];
  if (jump?.flow !== "jump" || jump.target?.address !== loop.header) return;
  prefix.push(jump);
  const tailStart = ordered.findIndex((i) => i.address === loop.exit);
  if (tailStart < 0) return;
  const tail = ordered.slice(tailStart);
  let at = 0;
  for (const name of [...saved].reverse()) {
    const i = tail[at++];
    if (i?.mnemonic !== "pop" || !reg(i.operands[0], name)) return;
  }
  if (tail[at]?.mnemonic === "mov" && reg(tail[at]!.operands[0], "sp") && reg(tail[at]!.operands[1], "bp")) at++;
  else if (locals) return;
  if (tail[at]?.mnemonic !== "pop" || !reg(tail[at]!.operands[0], "bp")) return;
  const returned = tail[++at];
  if (!returned || !["ret", "retf"].includes(returned.mnemonic) || returned.operands.length || at !== tail.length - 1)
    return;
  const kind = returned.mnemonic === "retf" ? ("far" as const) : ("near" as const);
  const guard = ordered.find((i) => i.address === loop.header),
    branch = guard && ordered.find((i) => i.address === guard.address + guard.size);
  if (!guard || !branch || branch.flow !== "branch") return;
  const gateway = ordered.find((i) => i.address === branch.address + branch.size);
  const allowed = new Set([...prefix, ...tail, guard, branch].map((i) => i.address));
  for (const address of loop.body) allowed.add(address);
  if (gateway?.flow === "jump" && gateway.target?.address === loop.bodyEntry) allowed.add(gateway.address);
  if (ordered.some((i) => !allowed.has(i.address))) return;
  // Prefix and epilogue are straight lines; no hidden edge can enter the loop or skip a saved-register pop.
  for (const sequence of [prefix, tail])
    for (let n = 0; n < sequence.length; n++) {
      const i = sequence[n]!,
        expected = n + 1 < sequence.length ? sequence[n + 1]!.address : sequence === prefix ? loop.header : null;
      const edges = code.edges.filter((e) => e.from === i.address);
      if (i.flow === "return") {
        if (edges.some((e) => e.to !== null)) return;
      } else if (edges.length !== 1 || edges[0]!.to !== expected) return;
      if (n > 0 && code.edges.some((e) => e.to === i.address && e.from !== sequence[n - 1]!.address)) return;
    }
  if (code.edges.some((e) => e.to === loop.exit && e.from !== branch.address)) return;
  return { kind, stackBytes: 0 as const };
}

/** Discovers conditional list consumers; it never establishes that the incoming list actually has these properties. */
export function discoverExternalListConsumers(
  code: RoutineCode,
  helpers: Map<number, EngineSummary>,
  stateOffset: number,
): ExternalListConsumer[] {
  if (code.status !== "complete") return [];
  const results: ExternalListConsumer[] = [];
  for (const head of code.instructions) {
    const [destination, source] = head.operands;
    if (
      head.mnemonic !== "mov" ||
      !reg(destination) ||
      !mem(source) ||
      source.segment !== "ds" ||
      source.base.length !== 1 ||
      source.width !== 16
    )
      continue;
    if (
      source.base[0] === destination.name ||
      !code.instructions.some(
        (i) =>
          i.mnemonic === "mov" &&
          reg(i.operands[0], destination.name) &&
          mem(i.operands[1]) &&
          i.operands[1].base.join() === destination.name &&
          i.operands[1].displacement === source.displacement &&
          i.operands[1].width === 16,
      )
    )
      continue;
    for (const loop of discoverListLoops(code, helpers, stateOffset, false, { headInstruction: head.address })) {
      if (
        loop.source !== "external-list" ||
        loop.headField === undefined ||
        !Number.isInteger(loop.headField) ||
        loop.headField < 0 ||
        loop.headField + 2 > 0x10000 ||
        !Number.isInteger(loop.nextField) ||
        loop.nextField < 0 ||
        loop.nextField + 2 > 0x10000 ||
        loop.queries.length ||
        !loop.exitOnNullOnly ||
        loop.nodeRegister !== destination.name ||
        loop.headField !== source.displacement ||
        loop.possibleFields.some(
          (f) => f.root === "part" || !["other", "buffer", "stack", "global"].includes(f.root ?? ""),
        )
      )
        continue;
      const convention = frame(code, loop, head);
      if (!convention) continue;
      const argumentOffset = convention.kind === "far" ? 6 : 4;
      const fields = loop.possibleFields
        .filter((f) => f.root === "other" || f.root === "buffer")
        .map((f) => ({
          root: f.root === "other" ? ("member" as const) : ("outline" as const),
          offset: f.offset,
          width: f.width,
        }));
      if (
        fields.some(
          (f) =>
            !Number.isInteger(f.offset) ||
            f.offset < 0 ||
            f.offset + f.width / 8 > 0x10000 ||
            ![8, 16].includes(f.width),
        )
      )
        continue;
      results.push({
        address: code.address,
        argumentOffset,
        headInstruction: head.address,
        headField: loop.headField,
        nextField: loop.nextField,
        loop,
        fields: [...new Map(fields.map((f) => [JSON.stringify(f), f])).values()],
        returnConvention: convention,
        unknownGlobals: loop.unknownGlobals,
        requires: { finite: true, acyclic: true, completeBases: true, excludesArgument: true },
        confidence: "inferred",
        evidence: [
          ...new Map(
            [...code.instructions.map(evidence), ...loop.evidence].map((item) => [JSON.stringify(item), item]),
          ).values(),
        ],
        assumptions: [
          ...new Set([
            ...loop.assumptions,
            "This is a conditional consumer contract. The caller must prove that the incoming list is finite and acyclic, consists of complete part bases, and excludes this argument owner; the routine does not establish those properties.",
            "Only the listed member fields and explicitly separate outline fields can change in part storage under that precondition. Private frame stores are omitted from caller effects. Return registers remain unspecified.",
          ]),
        ],
      });
    }
  }
  return [...new Map(results.map((r) => [JSON.stringify([r.headInstruction, r.loop.header]), r])).values()];
}
