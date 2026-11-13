/** Finds engine state restoration and history writes without treating a callback as a complete reset operation. */
import type { Evidence, Expression, FieldWrite, Finding, Predicate } from "./behaviour.ts";
import type { BehaviourLayout, LayoutField } from "./behaviour-layout.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import { findDataSegment } from "./type-table.ts";
import type { Instruction, Operand } from "./x86.ts";
import { constant, evidenceOf, memoryOperand, writesRegister } from "./behaviour-terms.ts";

export interface ResetLifecycle extends Finding {
  fields: FieldWrite[];
  stateSource: number;
  /** A saved state may be refreshed after the type-specific reset callback. */
  writesAfterCallback?: FieldWrite[];
  context: "level reset";
  routine: number;
  dispatch: number;
  condition: Predicate;
}

export interface HistoryLifecycle extends Finding {
  fields: FieldWrite[];
  context: "history update";
  routine: number;
  condition: Predicate;
  callers: Evidence[];
}

export interface BehaviourLifecycle {
  reset: ResetLifecycle[];
  history: HistoryLifecycle[];
  diagnostics: string[];
}

const unique = (items: Evidence[]) => [...new Map(items.map((item) => [item.address, item])).values()];
const register = (operand: Operand | undefined): string | undefined =>
  operand?.kind === "register" ? operand.name : undefined;
const objectMemory = (operand: Operand | undefined, base: string) => {
  const field = memoryOperand(operand);
  return field?.segment === "ds" && field.base.length === 1 && field.base[0] === base ? field : undefined;
};

/** Standard iterative dominance, with no assumptions about which branches or loop iterations the program takes. */
function dominators(code: RoutineCode): Map<number, Set<number>> {
  const addresses = new Set(code.instructions.map((instruction) => instruction.address));
  const predecessors = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null && addresses.has(edge.to))
      predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  const result = new Map<number, Set<number>>();
  for (const address of addresses)
    result.set(address, address === code.address ? new Set([address]) : new Set(addresses));
  let changed = true;
  while (changed) {
    changed = false;
    for (const address of addresses) {
      if (address === code.address) continue;
      const incoming = predecessors.get(address) ?? [];
      const next = incoming.length ? new Set(result.get(incoming[0]!)!) : new Set<number>();
      for (const previous of incoming.slice(1))
        for (const item of next) if (!result.get(previous)?.has(item)) next.delete(item);
      next.add(address);
      const old = result.get(address)!;
      if (next.size !== old.size || [...next].some((item) => !old.has(item))) {
        result.set(address, next);
        changed = true;
      }
    }
  }
  return result;
}

/** Rejects changes to the object register on every path to the dispatch before this assignment can be refreshed. */
function sameObjectUntil(code: RoutineCode, from: number, to: number, base: string): boolean {
  const instructions = new Map(code.instructions.map((instruction) => [instruction.address, instruction]));
  const outgoing = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const incoming = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  const reaches = new Set([to]),
    reverse = [to];
  while (reverse.length)
    for (const previous of incoming.get(reverse.pop()!) ?? [])
      if (previous !== from && !reaches.has(previous)) {
        reaches.add(previous);
        reverse.push(previous);
      }
  const pending = [...(outgoing.get(from) ?? [])];
  const seen = new Set<number>();
  while (pending.length) {
    const at = pending.pop()!;
    if (at === from || at === to || seen.has(at) || !reaches.has(at)) continue;
    seen.add(at);
    const instruction = instructions.get(at);
    if (!instruction) return false;
    if (writesRegister(instruction, base)) return false;
    pending.push(...(outgoing.get(at) ?? []));
  }
  return true;
}

/** Finds a register's straight-line definition without crossing a branch target, call or another definition. */
function sourceOfStore(
  code: RoutineCode,
  index: number,
  base: string,
): { value: Expression; proof: Instruction[] } | undefined {
  const store = code.instructions[index]!;
  const source = store.operands[1];
  const destination = objectMemory(store.operands[0], base);
  if (!destination || store.mnemonic !== "mov") return undefined;
  if (source?.kind === "immediate") return { value: constant(source.value, destination.width), proof: [store] };
  let name = register(source);
  if (!name) return undefined;
  const proof = [store];
  const incoming = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  for (let previous = index - 1; previous >= Math.max(0, index - 24); previous--) {
    const instruction = code.instructions[previous]!;
    const after = code.instructions[previous + 1]!;
    if (
      instruction.address + instruction.size !== after.address ||
      instruction.flow !== "next" ||
      (incoming.get(after.address)?.length ?? 0) !== 1
    )
      return undefined;
    proof.unshift(instruction);
    if (!writesRegister(instruction, name)) continue;
    // Only a whole word written as the first operand is followed; anything else that changes it gives up.
    if (register(instruction.operands[0]) !== name) return undefined;
    const source = instruction.operands[1];
    if (instruction.mnemonic === "mov") {
      if (source?.kind === "immediate") return { value: constant(source.value, destination.width), proof };
      const field = objectMemory(source, base);
      if (field)
        return { value: { kind: "field", object: "part", offset: field.displacement, width: field.width }, proof };
      const copied = register(source);
      if (copied) {
        name = copied;
        continue;
      }
    }
    if ((instruction.mnemonic === "xor" || instruction.mnemonic === "sub") && register(source) === name)
      return { value: constant(0, destination.width), proof };
    return undefined;
  }
  return undefined;
}

/** Determines the pushed object whose type selects this reset callback in the already checked type table. */
function dispatchObject(code: RoutineCode, site: number, typeOffset: number): string | undefined {
  const index = code.instructions.findIndex((instruction) => instruction.address === site);
  for (let k = index - 1; k >= Math.max(0, index - 12); k--) {
    const instruction = code.instructions[k]!;
    if (instruction.mnemonic !== "push" || !register(instruction.operands[0])) continue;
    const base = register(instruction.operands[0])!;
    const load = code.instructions[k + 1];
    if (
      load?.mnemonic !== "mov" ||
      register(load.operands[0]) !== "ax" ||
      objectMemory(load.operands[1], base)?.displacement !== typeOffset
    )
      continue;
    const sequence = code.instructions.slice(k, index + 1);
    if (!sequence.every((item, n) => n === 0 || sequence[n - 1]!.address + sequence[n - 1]!.size === item.address))
      continue;
    return base;
  }
  return undefined;
}

/**
 * Reads only dominating same-object assignments. The conditions selecting a level-reset path remain unknown;
 * this does not turn an engine reset routine into a fabricated initial part or execute its callback.
 */
export function discoverBehaviourLifecycle(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  layout: BehaviourLayout,
): BehaviourLifecycle {
  const result: BehaviourLifecycle = { reset: [], history: [], diagnostics: [] };
  const stateOffset = layout.fields.find((field) => field.name === "state")?.offset;
  const typeOffset = layout.fields.find((field) => field.name === "type")?.offset;
  const snapshotOffset = layout.fields.find((field) => field.name === "previousState")?.offset;
  if (stateOffset === undefined || typeOffset === undefined) {
    result.diagnostics.push("Engine lifecycle discovery needs the checked state and type fields.");
    return result;
  }
  const routines = new Map(codes);
  const references = new Map<number, Set<number>>();
  for (const code of codes.values())
    for (const call of code.calls)
      if (call.target)
        references.set(
          call.target.address,
          new Set([...(references.get(call.target.address) ?? []), call.target.segment]),
        );
  // Far call bytes supply candidate segment coordinates, then an actual decoded CFG must contain the checked site.
  for (let at = 0; at + 5 <= image.length; at++)
    if (image[at] === 0x9a) {
      const offset = image[at + 1]! | (image[at + 2]! << 8),
        segment = image[at + 3]! | (image[at + 4]! << 8),
        address = segment * 16 + offset;
      if (address < image.length) references.set(address, new Set([...(references.get(address) ?? []), segment]));
    }
  const ds = findDataSegment(image);
  const containing = (site: number): RoutineCode | undefined => {
    const existing = [...routines.values()]
      .filter((code) => code.instructions.some((instruction) => instruction.address === site))
      .sort((a, b) => b.address - a.address)[0];
    if (existing) return existing;
    let candidates = 0;
    for (let start = site; start >= Math.max(0, site - 4096) && candidates < 16; start--) {
      if (image[start] !== 0x55 || image[start + 1] !== 0x8b || image[start + 2] !== 0xec) continue;
      candidates++;
      const segments = references.get(start);
      if (!segments || segments.size !== 1) continue;
      const segment = [...segments][0]!,
        offset = start - segment * 16;
      if (offset < 0 || offset > 0xffff) continue;
      const code = readRoutineCode(image, { address: start, segment, offset }, ds);
      routines.set(start, code);
      if (code.status === "complete" && code.instructions.some((instruction) => instruction.address === site))
        return code;
    }
    return undefined;
  };
  const writeFinding = (
    code: RoutineCode,
    instruction: Instruction,
    base: string,
    source: { value: Expression; proof: Instruction[] },
    condition: Predicate,
  ): FieldWrite => ({
    object: "part",
    offset: objectMemory(instruction.operands[0], base)!.displacement,
    width: objectMemory(instruction.operands[0], base)!.width,
    value: source.value,
    condition,
    routine: code.address,
    confidence: "inferred",
    assumptions: [
      "The assignment dominates the selected engine site and the object register is preserved on paths to that site.",
      "These are instruction facts before the dispatch; intervening helpers may overwrite fields and are not assumed to be an executable initialization summary.",
    ],
    evidence: evidenceList(source.proof),
  });
  for (const site of layout.callbacks.find((callback) => callback.role === "reset")?.sites ?? []) {
    const code = containing(site);
    if (!code || code.status !== "complete") {
      result.diagnostics.push(`No complete engine reset context found for dispatch 0x${site.toString(16)}.`);
      continue;
    }
    const base = dispatchObject(code, site, typeOffset);
    if (!base) continue;
    const dominance = dominators(code),
      condition: Predicate = {
        kind: "unknown",
        reason: `Engine level-reset context reaching dispatch 0x${site.toString(16)}; mode and list membership are not established by these writes.`,
      };
    const fields: FieldWrite[] = [];
    for (let k = 0; k < code.instructions.length; k++) {
      const instruction = code.instructions[k]!;
      if (
        instruction.address === site ||
        !dominance.get(site)?.has(instruction.address) ||
        !objectMemory(instruction.operands[0], base) ||
        !sameObjectUntil(code, instruction.address, site, base)
      )
        continue;
      const source = sourceOfStore(code, k, base);
      if (
        source &&
        (source.proof[0]!.address === instruction.address ||
          sameObjectUntil(code, source.proof[0]!.address, instruction.address, base))
      )
        fields.push(writeFinding(code, instruction, base, source, condition));
    }
    const restore = fields.find(
      (field) =>
        field.offset === stateOffset &&
        field.value.kind === "field" &&
        field.value.object === "part" &&
        field.value.offset !== stateOffset,
    );
    const counters = layout.fields.filter((field) => field.name === "contextCounter").map((field) => field.offset);
    if (
      !restore ||
      restore.value.kind !== "field" ||
      !fields.some(
        (field) => counters.includes(field.offset) && field.value.kind === "constant" && field.value.value === 0,
      )
    )
      continue;
    const writesAfterCallback: FieldWrite[] = [];
    const dispatchIndex = code.instructions.findIndex((instruction) => instruction.address === site);
    // Only a straight-line post-dispatch copy is accepted; a later list iteration belongs to another object.
    for (let k = dispatchIndex + 1; k < Math.min(code.instructions.length, dispatchIndex + 5); k++) {
      const instruction = code.instructions[k]!;
      if (instruction.flow !== "next" || !sameObjectUntil(code, site, instruction.address, base)) break;
      const destination = objectMemory(instruction.operands[0], base);
      if (destination?.displacement !== restore.value.offset) continue;
      const source = sourceOfStore(code, k, base);
      if (source?.value.kind === "field" && source.value.object === "part" && source.value.offset === stateOffset)
        writesAfterCallback.push(writeFinding(code, instruction, base, source, condition));
    }
    result.reset.push({
      fields,
      stateSource: restore.value.offset,
      writesAfterCallback,
      context: "level reset",
      routine: code.address,
      dispatch: site,
      condition,
      confidence: "inferred",
      assumptions: [
        "A stored state is restored and a discovered context counter is cleared before the type reset callback.",
        "The stored state is a level-reset input, not an assumed zero state; this context does not cover every reset callback call.",
        "Mode gates and list membership remain unresolved, and these dominating writes are not automatically applied to a part.",
      ],
      evidence: unique([
        ...fields.flatMap((field) => field.evidence),
        ...layout.callbacks
          .find((callback) => callback.role === "reset")!
          .evidence.filter((item) => item.address <= site && item.address >= site - 24),
      ]),
    });
  }
  if (snapshotOffset !== undefined) {
    const sites = layout.fields.find((field) => field.name === "previousState")!.evidence.map((item) => item.address);
    for (const site of sites) containing(site);
    for (const code of routines.values()) {
      if (
        !code.instructions.some(
          (instruction) =>
            instruction.mnemonic === "mov" && memoryOperand(instruction.operands[1])?.displacement === snapshotOffset,
        )
      )
        continue;
      const dominance = dominators(code),
        returns = code.instructions.filter((instruction) => instruction.flow === "return");
      if (!returns.length) continue;
      for (let k = 0; k + 3 < code.instructions.length; k++) {
        const sequence = code.instructions.slice(k, k + 4),
          [previous, older, current, snapshot] = sequence as [Instruction, Instruction, Instruction, Instruction];
        const base = memoryOperand(previous.operands[1])?.base[0];
        if (
          !base ||
          !sequence.every(
            (instruction, n) => n === 0 || sequence[n - 1]!.address + sequence[n - 1]!.size === instruction.address,
          ) ||
          previous.mnemonic !== "mov" ||
          register(previous.operands[0]) !== "ax" ||
          objectMemory(previous.operands[1], base)?.displacement !== snapshotOffset ||
          older.mnemonic !== "mov" ||
          register(older.operands[1]) !== "ax" ||
          !objectMemory(older.operands[0], base) ||
          current.mnemonic !== "mov" ||
          register(current.operands[0]) !== "ax" ||
          objectMemory(current.operands[1], base)?.displacement !== stateOffset ||
          snapshot.mnemonic !== "mov" ||
          register(snapshot.operands[1]) !== "ax" ||
          objectMemory(snapshot.operands[0], base)?.displacement !== snapshotOffset
        )
          continue;
        if (
          !sequence.every((assignment) =>
            returns.every((instruction) => dominance.get(instruction.address)?.has(assignment.address)),
          )
        )
          continue;
        const argument = code.instructions.find(
          (instruction) =>
            instruction.mnemonic === "mov" &&
            register(instruction.operands[0]) === base &&
            memoryOperand(instruction.operands[1])?.segment === "ss" &&
            memoryOperand(instruction.operands[1])?.base.join() === "bp" &&
            memoryOperand(instruction.operands[1])?.displacement === 6 &&
            dominance.get(previous.address)?.has(instruction.address),
        );
        if (!argument || !sameObjectUntil(code, argument.address, previous.address, base)) continue;
        const condition: Predicate = { kind: "true" };
        const writes: FieldWrite[] = [older, snapshot].map((instruction) =>
          writeFinding(
            code,
            instruction,
            base,
            sourceOfStore(code, code.instructions.indexOf(instruction), base)!,
            condition,
          ),
        );
        const callers = [...routines.values()].flatMap((caller) =>
          caller.calls.filter((call) => call.target?.address === code.address).flatMap((call) => call.evidence),
        );
        result.history.push({
          fields: writes,
          context: "history update",
          routine: code.address,
          condition,
          callers,
          confidence: "inferred",
          assumptions: [
            "Both history assignments dominate every return of this helper, whose first far-call argument supplies the object.",
            "The helper's call frequency and placement relative to simulation cycles require separate caller evidence.",
          ],
          evidence: unique([evidenceOf(argument), ...evidenceList(sequence), ...callers]),
        });
        break;
      }
    }
  }
  return result;
}

const evidenceList = (instructions: Instruction[]) => instructions.map(evidenceOf);

/** Names saved level inputs by the named live fields restored from them, rather than assigning initial values. */
export function discoverLifecycleFieldRoles(lifecycle: BehaviourLifecycle, layout: BehaviourLayout): LayoutField[] {
  const targets = ["state", "stateDelta", "drawingFlags", "positionX", "positionY"];
  const results = new Map<number, LayoutField>();
  for (const reset of lifecycle.reset)
    for (const name of targets) {
      const destination = layout.fields.find((field) => field.name === name && field.confidence !== "unresolved");
      if (!destination) continue;
      const copies = reset.fields.filter(
        (write) =>
          write.offset === destination.offset &&
          write.value.kind === "field" &&
          write.value.object === "part" &&
          write.value.offset !== destination.offset,
      );
      for (const copy of copies) {
        if (copy.value.kind !== "field") continue;
        const savedOffset = copy.value.offset;
        const field: LayoutField = {
          offset: savedOffset,
          name: `saved${name[0]!.toUpperCase()}${name.slice(1)}`,
          description: `The stored ${name} restored during the engine's level-reset path; its value is an input from the level.`,
          confidence: "inferred",
          assumptions: [
            ...copy.assumptions,
            "A restoration identifies the stored role, not a numeric default or every initialization path.",
          ],
          evidence: unique([
            ...copy.evidence,
            ...(reset.writesAfterCallback ?? [])
              .filter((write) => write.offset === savedOffset)
              .flatMap((write) => write.evidence),
          ]),
        };
        const existing = results.get(field.offset);
        if (!existing) results.set(field.offset, field);
        else if (existing.name === field.name) existing.evidence = unique([...existing.evidence, ...field.evidence]);
        else {
          existing.confidence = "unresolved";
          existing.assumptions.push(`The same stored slot is also restored as ${name}.`);
        }
      }
    }
  return [...results.values()].sort((a, b) => a.offset - b.offset);
}
