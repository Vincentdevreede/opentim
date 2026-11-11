/** Certifies the per-node flag clear and guarded gear dispatch without assuming a runtime list or driver. */
import type { Finding } from "./behaviour.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import type { GearRunContract } from "./behaviour-gear-run.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import { findDataSegment } from "./type-table.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf, isMemory, wordAt } from "./behaviour-terms.ts";

export interface GearScheduling extends Finding {
  routine: number;
  gearRun: number;
  gearType: number;
  flagsField: number;
  processedMask: number;
  excludedMask: number;
  list: { globalHead: number; nextField: number };
  clear: { entry: number; store: number; header: number; latch: number; exit: number; clearedMask: number };
  pass: {
    entry: number;
    typeGuard: number;
    flagsGuard: number;
    dispatch: number;
    header: number;
    latch: number;
    exit: number;
  };
  description: string;
}
const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && o.width === 16 && (name === undefined || o.name === name);
const imm = (o: Operand | undefined, value?: number): o is Extract<Operand, { kind: "immediate" }> =>
  o?.kind === "immediate" && (value === undefined || o.value === value);
const object = (o: Operand | undefined, base: string, offset?: number) =>
  isMemory(o) &&
  o.segment === "ds" &&
  o.width === 16 &&
  o.base.join() === base &&
  !o.direct &&
  (offset === undefined || o.displacement === offset);
const direct = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> =>
  isMemory(o) && o.segment === "ds" && o.width === 16 && o.direct;
const plain = (i: Instruction | undefined, name: string) => !!i && i.mnemonic === name && !i.prefixes.length;
const jump = (i: Instruction | undefined, name: string, target: Instruction) =>
  plain(i, name) && i!.target?.address === target.address;

/** Checks all region edges, including the only permitted exit, and every incoming edge in the complete routine. */
function region(code: RoutineCode, sequence: Instruction[]): boolean {
  const addresses = new Set(sequence.map((i) => i.address));
  if (
    !sequence.length ||
    sequence.some((i, n) => n > 0 && sequence[n - 1]!.address + sequence[n - 1]!.size !== i.address)
  )
    return false;
  for (const [n, i] of sequence.entries()) {
    const next = i.address + i.size;
    const expected =
      i.flow === "branch"
        ? [i.target?.address, next]
        : i.flow === "jump"
          ? [i.target?.address]
          : ["next", "call"].includes(i.flow)
            ? [next]
            : [];
    const edges = code.edges.filter((e) => e.from === i.address);
    if (
      !expected.length ||
      expected.some((to) => to === undefined) ||
      edges.length !== expected.length ||
      expected.some(
        (to, edgeIndex) =>
          !edges.some(
            (e) =>
              e.to === to &&
              e.kind ===
                (i.flow === "branch" ? (edgeIndex === 0 ? "taken" : "not-taken") : i.flow === "jump" ? "jump" : "next"),
          ),
      )
    )
      return false;
    if (expected.some((to) => !addresses.has(to!) && !(n === sequence.length - 1 && to === next))) return false;
  }
  return (
    !code.edges.some(
      (e) =>
        e.to !== null &&
        addresses.has(e.to) &&
        !addresses.has(e.from) &&
        (e.to !== sequence[0]!.address || e.from >= sequence[0]!.address),
    ) &&
    (!addresses.has(code.address) || code.address === sequence[0]!.address)
  );
}
function dominates(code: RoutineCode, gate: number, target: number): boolean {
  const pending = [code.address],
    seen = new Set<number>();
  while (pending.length) {
    const at = pending.pop()!;
    if (at === gate || seen.has(at)) continue;
    if (at === target) return false;
    seen.add(at);
    for (const edge of code.edges) if (edge.from === at && edge.to !== null) pending.push(edge.to);
  }
  return true;
}

/** The call's receiver, type index and table slot must all describe the same actual callback record. */
function dispatch(
  sequence: Instruction[],
  field: number,
  typeField: number,
  base: string,
  ds: number,
): { call: Instruction; table: number } | undefined {
  const [push, load, stride, multiply] = sequence;
  if (
    !plain(push, "push") ||
    !reg(push!.operands[0], base) ||
    !plain(load, "mov") ||
    !reg(load!.operands[0], "ax") ||
    !object(load!.operands[1], base, typeField) ||
    !plain(stride, "mov") ||
    !reg(stride!.operands[0], "dx") ||
    !imm(stride!.operands[1], 58) ||
    !plain(multiply, "imul") ||
    multiply!.operands.length !== 1 ||
    !reg(multiply!.operands[0], "dx")
  )
    return;
  let call: Instruction, table: number;
  if (sequence.length === 10) {
    const [segment, index, es, candidate] = sequence.slice(4, 8);
    if (
      !plain(segment, "mov") ||
      !reg(segment!.operands[0], "dx") ||
      !imm(segment!.operands[1]) ||
      !plain(index, "mov") ||
      !reg(index!.operands[0], "bx") ||
      !reg(index!.operands[1], "ax") ||
      !plain(es, "mov") ||
      es!.operands[0]?.kind !== "register" ||
      es!.operands[0].name !== "es" ||
      !reg(es!.operands[1], "dx")
    )
      return;
    call = candidate!;
    table = segment!.operands[1].value * 16;
    const operand = call.operands[0];
    if (!isMemory(operand) || operand.segment !== "es" || operand.displacement !== field) return;
  } else if (sequence.length === 8) {
    const [index, candidate] = sequence.slice(4, 6);
    if (!plain(index, "mov") || !reg(index!.operands[0], "bx") || !reg(index!.operands[1], "ax")) return;
    call = candidate!;
    const operand = call.operands[0];
    if (!isMemory(operand) || operand.segment !== "ds") return;
    table = ds * 16 + operand.displacement - field;
  } else return;
  const operand = call.operands[0],
    cleanup = sequence.at(-2),
    advance = sequence.at(-1);
  if (
    call.mnemonic !== "call" ||
    call.flow !== "call" ||
    !call.far ||
    call.target ||
    call.operands.length !== 1 ||
    !isMemory(operand) ||
    operand.width !== 32 ||
    operand.base.join() !== "bx" ||
    operand.direct ||
    call.prefixes.some((p) => p !== "es") ||
    !plain(cleanup, "pop") ||
    !reg(cleanup!.operands[0], "cx") ||
    !plain(advance, "mov") ||
    !reg(advance!.operands[0], base) ||
    !object(advance!.operands[1], base)
  )
    return;
  return { call, table };
}

/** Candidate coordinates are found from references; only complete decoded graphs containing a checked site are retained. */
function containing(image: Uint8Array, codes: Map<number, RoutineCode>, sites: number[], ds: number): RoutineCode[] {
  const found = new Map<number, RoutineCode>();
  for (const code of codes.values())
    if (code.status === "complete" && sites.some((s) => code.instructions.some((i) => i.address === s)))
      found.set(code.address, code);
  const missing = sites.filter((s) => ![...found.values()].some((c) => c.instructions.some((i) => i.address === s)));
  if (!missing.length) return [...found.values()];
  const references = new Map<number, Set<number>>();
  const add = (address: number, segment: number) =>
    references.set(address, new Set([...(references.get(address) ?? []), segment]));
  for (const code of codes.values())
    for (const call of code.calls) if (call.target) add(call.target.address, call.target.segment);
  for (let at = 0; at + 5 <= image.length; at++)
    if (image[at] === 0x9a) add(wordAt(image, at + 3) * 16 + wordAt(image, at + 1), wordAt(image, at + 3));
  for (const site of missing) {
    if ([...found.values()].some((c) => c.instructions.some((i) => i.address === site))) continue;
    let candidates = 0;
    for (let start = site; start >= Math.max(0, site - 4096) && candidates < 16; start--) {
      if (image[start] !== 0x55 || image[start + 1] !== 0x8b || image[start + 2] !== 0xec) continue;
      candidates++;
      const segments = references.get(start);
      if (segments?.size !== 1) continue;
      const segment = [...segments][0]!,
        offset = start - segment * 16;
      if (offset < 0 || offset > 65535) continue;
      const code = readRoutineCode(image, { address: start, segment, offset }, ds);
      if (code.status === "complete" && code.instructions.some((i) => i.address === site)) {
        found.set(start, code);
        break;
      }
    }
  }
  return [...found.values()];
}

/** An eligible node gets one dispatch in this pass; other passes, graph effects and runtime membership remain conditional. */
export function discoverGearScheduling(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  layout: BehaviourLayout,
  gearRuns: Pick<GearRunContract, "address" | "flagsField" | "visitedMask" | keyof Finding>[],
): GearScheduling[] {
  const run = layout.callbacks.find((c) => c.role === "run"),
    flags = layout.fields.find((f) => f.name === "drawingFlags"),
    type = layout.fields.find((f) => f.name === "type");
  if (!run || !flags || !type || !gearRuns.length) return [];
  const ds = findDataSegment(image),
    result: GearScheduling[] = [];
  for (const code of containing(image, codes, run.sites, ds)) {
    const sequence = code.instructions;
    if (
      sequence.some(
        (i) =>
          i.mnemonic === "lds" ||
          (i.operands[0]?.kind === "register" &&
            i.operands[0].name === "ds" &&
            !["push", "cmp", "test"].includes(i.mnemonic)),
      )
    )
      continue;
    for (let n = 0; n < sequence.length; n++) {
      const entry = sequence[n],
        toHeader = sequence[n + 1],
        typeGuard = sequence[n + 2],
        typeBranch = sequence[n + 3],
        flagsGuard = sequence[n + 4],
        flagsBranch = sequence[n + 5];
      if (
        !plain(entry, "mov") ||
        !reg(entry!.operands[0]) ||
        !direct(entry!.operands[1]) ||
        !plain(typeGuard, "cmp") ||
        !object(typeGuard!.operands[0], entry!.operands[0].name, type.offset) ||
        !imm(typeGuard!.operands[1], 14) ||
        !plain(flagsGuard, "test") ||
        !object(flagsGuard!.operands[0], entry!.operands[0].name, flags.offset) ||
        !imm(flagsGuard!.operands[1], 0x2040)
      )
        continue;
      const base = entry!.operands[0].name;
      if (!["si", "di"].includes(base)) continue;
      for (const length of [10, 8]) {
        const setup = sequence.slice(n + 6, n + 6 + length),
          advance = setup.at(-1),
          header = sequence[n + 6 + length],
          latch = sequence[n + 7 + length];
        if (
          !advance ||
          !header ||
          !latch ||
          !jump(toHeader, "jmp", header) ||
          !jump(typeBranch, "jne", advance) ||
          !jump(flagsBranch, "jne", advance) ||
          !plain(header, "or") ||
          !reg(header.operands[0], base) ||
          !reg(header.operands[1], base) ||
          !jump(latch, "jne", typeGuard!)
        )
          continue;
        const dispatched = dispatch(setup, run.field, type.offset, base, ds);
        if (!dispatched || !run.sites.includes(dispatched.call.address)) continue;
        const call = code.calls.find((c) => c.instruction === dispatched.call.address);
        if (!call?.far || call.target || call.operand?.kind !== "memory") continue;
        const recordOffset = (setup.length === 10 ? 0 : dispatched.table - ds * 16) + 14 * 58 + run.field;
        if (recordOffset < 0 || recordOffset + 4 > 65536) continue;
        const record = dispatched.table + 14 * 58 + run.field;
        if (record < 0 || record + 4 > image.length) continue;
        const address = wordAt(image, record + 2) * 16 + wordAt(image, record);
        const gear = gearRuns.find(
          (g) => g.address === address && g.flagsField === flags.offset && g.visitedMask === 64,
        );
        if (!gear) continue;
        const pass = sequence.slice(n, n + 8 + length);
        if (!region(code, pass)) continue;
        const nextField = (advance.operands[1] as Extract<Operand, { kind: "memory" }>).displacement;
        for (let c = 0; c + 6 <= n; c++) {
          const clear = sequence.slice(c, c + 6),
            [load, branch, store, next, guard, loop] = clear;
          if (
            !plain(load, "mov") ||
            !reg(load!.operands[0]) ||
            !direct(load!.operands[1]) ||
            load!.operands[1].displacement !== entry!.operands[1].displacement ||
            !jump(branch, "jmp", guard!) ||
            !plain(store, "and") ||
            !object(store!.operands[0], load!.operands[0].name, flags.offset) ||
            !imm(store!.operands[1], 0xf9bf) ||
            !plain(next, "mov") ||
            !reg(next!.operands[0], load!.operands[0].name) ||
            !object(next!.operands[1], load!.operands[0].name, nextField) ||
            !plain(guard, "or") ||
            !reg(guard!.operands[0], load!.operands[0].name) ||
            !reg(guard!.operands[1], load!.operands[0].name) ||
            !jump(loop, "jne", store!) ||
            !region(code, clear) ||
            !dominates(code, loop!.address + loop!.size, entry!.address)
          )
            continue;
          if (
            flags.offset < 0 ||
            flags.offset + 2 > 65536 ||
            nextField < 0 ||
            nextField + 2 > 65536 ||
            (flags.offset < nextField + 2 && nextField < flags.offset + 2)
          )
            continue;
          const assumptions = [
            ...gear.assumptions,
            ...run.assumptions,
            ...flags.assumptions,
            ...type.assumptions,
            "This is a per-node pass contract for complete, nonwrapping part objects in a valid finite linked list. The initial callback table is unchanged and its type index is valid.",
            "The clear loop and guarded gear pass use the same global head and next field, and all edges into both complete regions are checked. Earlier callbacks and another pass may change the flags before this guard is read.",
            "A node is known to have received the earlier clear only if list membership stayed valid between phases or its initialization supplied the same flags. A clear-loop exit dominating this pass does not establish that fact for newly inserted nodes.",
            "The routine enters with the discovered data segment and never explicitly changes DS. The C convention preserves the iterator register, data segment and stack across the indirect call. This describes one dispatch for an eligible visited node in this pass, not one invocation per gear per game step or a guarantee that a runtime driver supplies movement.",
          ];
          result.push({
            routine: code.address,
            gearRun: gear.address,
            gearType: 14,
            flagsField: flags.offset,
            processedMask: 64,
            excludedMask: 0x2040,
            list: { globalHead: entry!.operands[1].displacement, nextField },
            clear: {
              entry: load!.address,
              store: store!.address,
              header: guard!.address,
              latch: loop!.address,
              exit: loop!.address + loop!.size,
              clearedMask: 0x640,
            },
            pass: {
              entry: entry!.address,
              typeGuard: typeGuard!.address,
              flagsGuard: flagsGuard!.address,
              dispatch: dispatched.call.address,
              header: header.address,
              latch: latch.address,
              exit: latch.address + latch.size,
            },
            description:
              "An earlier list pass clears the processed and rope-control bits. This pass calls an eligible gear's run routine when its processed and run-exclusion bits are clear; earlier passes and runtime list membership still affect eligibility.",
            confidence: "inferred",
            evidence: [
              ...new Map(
                [...clear, ...pass]
                  .map(evidenceOf)
                  .concat(gear.evidence, run.evidence, flags.evidence, type.evidence)
                  .map((e) => [e.address, e]),
              ).values(),
            ],
            assumptions: [...new Set(assumptions)],
          });
        }
      }
    }
  }
  return result;
}
