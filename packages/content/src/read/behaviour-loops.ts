/** Proves bounded counting loops whose bodies preserve the owner's state field. */
import type { Evidence, Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Instruction, Operand } from "./x86.ts";
import { discoverBoundedSearchLoops } from "./behaviour-search-loops.ts";

export interface LoopField {
  object: "part" | "related" | "stack" | "data" | "buffer" | "other";
  root: "part" | "related" | "stack" | "global" | "buffer" | "other";
  offset: number;
  width: number;
  register?: string;
  operand?: Extract<Operand, { kind: "memory" }>;
  /** Every possibly aliasing store copies the same owner's word back to that word. */
  preservesOwnerValue?: boolean;
  preservesNonzeroOwner?: boolean;
  partGraph?: boolean;
  /** A complete word store is zero or a pointer to a complete overlap-list member. */
  nullableMember?: boolean;
}

export interface LoopSummary extends Finding {
  /** The comparison at which the invariant can replace the complete remaining loop. */
  header: number;
  bodyEntry: number;
  body: number[];
  latch: number;
  exit: number;
  counter: Operand;
  limit: number;
  step: 1 | -1;
  relation: "<" | "<=" | ">" | ">=";
  signed: boolean;
  /** An indexed footprint may require a nonnegative entry counter. */
  minimumCounter?: number;
  proof: {
    update: number;
    variant: string;
    updateDominatesLatch: true;
    singleEntry: true;
    acyclicBody: true;
  };
  writtenRegisters: string[];
  possibleFields: LoopField[];
}

const evidence = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
const register = (operand: Operand | undefined, name?: string): operand is Extract<Operand, { kind: "register" }> =>
  operand?.kind === "register" && (name === undefined || operand.name === name);
const memory = (operand: Operand | undefined): operand is Extract<Operand, { kind: "memory" }> =>
  operand?.kind === "memory";
const immediate = (operand: Operand | undefined, value?: number): operand is Extract<Operand, { kind: "immediate" }> =>
  operand?.kind === "immediate" && (value === undefined || operand.value === value);
const same = (a: Operand | undefined, b: Operand | undefined) => JSON.stringify(a) === JSON.stringify(b);
const writesFirst = (i: Instruction) =>
  !["cmp", "test", "push", "call", "jmp", "mul", "div", "idiv"].includes(i.mnemonic) &&
  i.flow === "next" &&
  !/^(j|loop)/.test(i.mnemonic);
const implicitMemory = (i: Instruction) => /^(movs|stos|ins|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic);
const volatile = new Set(["ax", "bx", "cx", "dx", "es"]);
const overlaps = (at: number, width: number, state: number) => at < state + 2 && state < at + width / 8;
const byteParents: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};
const whole = (name: string) => byteParents[name] ?? name;

/** Tracks storage classes through the CFG. An outline-buffer offset may vary without becoming an owner pointer. */
function storageOrigins(code: RoutineCode, bufferFields: Set<number>, argumentOffset: number) {
  const unknown = 4,
    owner = 1,
    buffer = 2;
  const outgoing = new Map<number, number[]>();
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  for (const edge of code.edges)
    if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const inputs = new Map<number, Map<string, number>>([[code.address, new Map()]]);
  const pending = [code.address];
  const local = (op: Operand | undefined) =>
    memory(op) && op.segment === "ss" && op.base.join() === "bp" && op.displacement < 0
      ? `stack:${op.displacement}`
      : undefined;
  let visits = 0;
  while (pending.length && visits++ < code.instructions.length * 32) {
    const at = pending.pop()!,
      i = instructions.get(at);
    if (!i) continue;
    const state = new Map(inputs.get(at)!);
    const sourceRoot = (op: Operand | undefined): number => {
      if (register(op)) return state.get(whole(op.name)) ?? unknown;
      if (!memory(op)) return unknown;
      const saved = local(op);
      if (saved && op.width === 16) return state.get(saved) ?? unknown;
      if (op.width === 16 && op.segment === "ss" && op.base.join() === "bp" && op.displacement === argumentOffset)
        return owner;
      if (
        op.width === 16 &&
        op.segment === "ds" &&
        op.base.length === 1 &&
        state.get(op.base[0]!) === owner &&
        bufferFields.has(op.displacement)
      )
        return buffer;
      return unknown;
    };
    const [dest, source] = i.operands;
    if (i.flow === "call") for (const name of volatile) state.set(name, unknown);
    if (writesFirst(i) && (register(dest) || local(dest))) {
      const name = register(dest) ? whole(dest.name) : local(dest)!;
      let root = unknown;
      if (i.mnemonic === "mov" && (register(dest) || memory(dest)) && dest.width === 16) root = sourceRoot(source);
      else if (["add", "sub"].includes(i.mnemonic) && immediate(source) && state.get(name) === buffer) root = buffer;
      state.set(name, root);
    }
    for (const next of outgoing.get(at) ?? []) {
      const old = inputs.get(next);
      if (!old) {
        inputs.set(next, new Map(state));
        pending.push(next);
        continue;
      }
      let changed = false;
      const joined = new Map<string, number>();
      for (const name of new Set([...old.keys(), ...state.keys()])) {
        const value = (old.get(name) ?? unknown) | (state.get(name) ?? unknown);
        joined.set(name, value);
        if (value !== old.get(name)) changed = true;
      }
      if (changed) {
        inputs.set(next, joined);
        pending.push(next);
      }
    }
  }
  return pending.length ? new Map<number, Map<string, number>>() : inputs;
}

/**
 * A natural counting loop is established from CFG edges, not from the physical order of the instruction bytes.
 * Removing its update must disconnect the body entry from the latch, which proves an update on every iteration.
 */
export function discoverCountedLoops(
  code: RoutineCode,
  helpers: Map<number, EngineSummary>,
  stateOffset: number,
): LoopSummary[] {
  if (code.status !== "complete") return [];
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  for (const edge of code.edges) {
    if (edge.to === null) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const boundedSearches = discoverBoundedSearchLoops(code);
  const searchBackEdges = new Set(boundedSearches.map((s) => `${s.latch}:${s.header}`));
  const before = new Map<number, Instruction>();
  for (const i of code.instructions) before.set(i.segment * 16 + ((i.offset + i.size) & 0xffff), i);
  const argumentOffset = code.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4;
  const bufferFields = new Set(
    [...helpers.values()]
      .filter((helper) => helper.kind === "geometry-edge-data")
      .flatMap((helper) =>
        helper.writes
          .filter((write) => write.root === "argument" && write.path.length === 1 && write.repeated?.stride === 4)
          .map((write) => write.path[0]!),
      ),
  );
  const origins = storageOrigins(code, bufferFields, argumentOffset);
  const ownerDefinitions = code.instructions.filter(
    (i) =>
      i.mnemonic === "mov" &&
      register(i.operands[0]) &&
      memory(i.operands[1]) &&
      i.operands[1].segment === "ss" &&
      i.operands[1].base.length === 1 &&
      i.operands[1].base[0] === "bp" &&
      i.operands[1].displacement === argumentOffset,
  );
  const ownerRegisters = new Set(
    ownerDefinitions.flatMap((i) => (register(i.operands[0]) ? [i.operands[0].name] : [])),
  );
  const domination = new Map<string, boolean>();
  const dominates = (definition: number, target: number, start: number): boolean => {
    const key = `${definition}:${target}:${start}`;
    const cached = domination.get(key);
    if (cached !== undefined) return cached;
    const pending = [start];
    const visited = new Set<number>();
    while (pending.length) {
      const at = pending.pop()!;
      if (at === definition || visited.has(at)) continue;
      if (at === target) {
        domination.set(key, false);
        return false;
      }
      visited.add(at);
      pending.push(...(outgoing.get(at) ?? []));
    }
    domination.set(key, true);
    return true;
  };
  const result: LoopSummary[] = [];
  const operators: Record<string, LoopSummary["relation"]> = {
    jl: "<",
    jb: "<",
    jle: "<=",
    jbe: "<=",
    jg: ">",
    ja: ">",
    jge: ">=",
    jae: ">=",
  };
  for (const latch of code.instructions) {
    const relation = operators[latch.mnemonic];
    const compare = before.get(latch.address);
    if (!relation || !compare || compare.mnemonic !== "cmp" || !latch.target || latch.target.address >= compare.address)
      continue;
    const [counter, bound] = compare.operands;
    if ((!register(counter) && !memory(counter)) || !immediate(bound) || counter.width !== 16) continue;
    if (
      memory(counter) &&
      !(counter.segment === "ss" && counter.base.length === 1 && counter.base[0] === "bp" && counter.displacement < 0)
    )
      continue;
    const signed = ["jl", "jle", "jg", "jge"].includes(latch.mnemonic);
    const limit = bound.value;
    if (limit < 0 || limit > (signed ? 0x7ffe : 0xfffe)) continue;
    const step: 1 | -1 = relation.startsWith("<") ? 1 : -1;
    const bodyEntry = latch.target.address;
    const exitEdges = code.edges.filter((e) => e.from === latch.address && e.kind === "not-taken" && e.to !== null);
    if (exitEdges.length !== 1) continue;
    const exit = exitEdges[0]!.to!;
    const body = new Set<number>();
    const queue = [bodyEntry];
    let invalid = false;
    while (queue.length && !invalid) {
      const address = queue.pop()!;
      if (address === compare.address || body.has(address)) continue;
      const i = byAddress.get(address);
      if (!i || address < bodyEntry || address >= compare.address || ["return", "stop"].includes(i.flow)) {
        invalid = true;
        break;
      }
      body.add(address);
      const next = outgoing.get(address) ?? [];
      if (!next.length) {
        invalid = true;
        break;
      }
      queue.push(...next);
    }
    if (invalid || !body.size) continue;
    // Every externally supplied path enters through the comparison; internal labels cannot have a second entry.
    if (
      [...body].some((address) =>
        (incoming.get(address) ?? []).some((from) => !body.has(from) && from !== latch.address),
      )
    )
      continue;
    if ((incoming.get(latch.address) ?? []).some((from) => from !== compare.address)) continue;
    const active = new Set<number>();
    const finished = new Set<number>();
    const acyclic = (address: number): boolean => {
      if (address === compare.address || finished.has(address)) return true;
      if (active.has(address)) return false;
      active.add(address);
      for (const next of outgoing.get(address) ?? [])
        if (!searchBackEdges.has(`${address}:${next}`) && !acyclic(next)) return false;
      active.delete(address);
      finished.add(address);
      return true;
    };
    if (!acyclic(bodyEntry)) continue;
    const instructions = [...body].map((address) => byAddress.get(address)!).sort((a, b) => a.address - b.address);
    const updates = instructions.filter(
      (i) =>
        same(i.operands[0], counter) &&
        ((step === 1 && i.mnemonic === "inc") ||
          (step === -1 && i.mnemonic === "dec") ||
          (i.mnemonic === (step === 1 ? "add" : "sub") && immediate(i.operands[1], 1))),
    );
    if (updates.length !== 1) continue;
    const update = updates[0]!;
    // The update is the sole definition of the counter, including overlapping byte aliases.
    const counterWrites = instructions.filter((i) => {
      if (!writesFirst(i)) return false;
      const dest = i.operands[0];
      if (register(counter) && register(dest)) return whole(dest.name) === whole(counter.name);
      return (
        memory(counter) &&
        memory(dest) &&
        dest.segment === "ss" &&
        dest.base.length === 1 &&
        dest.base[0] === "bp" &&
        dest.displacement < counter.displacement + 2 &&
        counter.displacement < dest.displacement + dest.width / 8
      );
    });
    if (counterWrites.length !== 1 || counterWrites[0]!.address !== update.address) continue;
    if (
      register(counter) &&
      instructions.some(
        (i) =>
          (["mul", "imul", "div", "idiv", "cwd", "cbw", "lahf", "loop", "loope", "loopne"].includes(i.mnemonic) &&
            ["ax", "dx", "cx"].includes(counter.name)) ||
          /^(lods|scas|cmps|movs|stos|ins|outs)/.test(i.mnemonic),
      )
    )
      continue;
    const withoutUpdate = [bodyEntry];
    const visited = new Set<number>();
    let avoidsUpdate = false;
    while (withoutUpdate.length) {
      const address = withoutUpdate.pop()!;
      if (address === update.address || visited.has(address)) continue;
      if (address === compare.address) {
        avoidsUpdate = true;
        break;
      }
      visited.add(address);
      withoutUpdate.push(...(outgoing.get(address) ?? []));
    }
    if (avoidsUpdate) continue;
    const writtenRegisters = new Set<string>();
    const fields: LoopField[] = [];
    const helperEvidence: Evidence[] = [];
    let minimumCounter: number | undefined;
    const assumptions = new Set([
      "The caller checks the current counter against the limit before using this invariant; the monotone counter does not wrap.",
      "The first object argument and references loaded from it denote complete part objects, not pointers into another object's fields.",
      "The C calling convention preserves SI, DI, BP and DS across the matched helper calls.",
    ]);
    const modified = new Set(
      instructions.flatMap((i) =>
        writesFirst(i) && register(i.operands[0]) && !["push", "pop"].includes(i.mnemonic)
          ? [whole(i.operands[0].name)]
          : [],
      ),
    );
    const stableOwners = new Set(
      [...ownerRegisters].filter(
        (name) =>
          !modified.has(name) &&
          !volatile.has(name) &&
          ownerDefinitions.some(
            (i) => register(i.operands[0], name) && dominates(i.address, compare.address, code.address),
          ),
      ),
    );
    // A related object base must come from a word reference load, with no pointer arithmetic afterwards.
    const pointerBase = (
      name: string,
      at: number,
      seen = new Set<string>(),
    ): "part" | "related" | "buffer" | undefined => {
      if (origins.get(at)?.get(name) === 2) return "buffer";
      if (stableOwners.has(name)) return "part";
      const key = `${name}:${at}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
      const previous = instructions
        .filter((i) => i.address < at && writesFirst(i) && register(i.operands[0], name))
        .at(-1);
      if (!previous || previous.mnemonic !== "mov" || !dominates(previous.address, at, bodyEntry)) return undefined;
      if (
        volatile.has(name) &&
        instructions.some((i) => i.flow === "call" && i.address > previous.address && i.address < at)
      )
        return undefined;
      const source = previous.operands[1];
      if (register(source)) return pointerBase(source.name, previous.address, seen);
      if (!memory(source) || source.width !== 16 || source.segment !== "ds") return undefined;
      if (!source.base.some((base) => pointerBase(base, previous.address, new Set(seen)))) return undefined;
      return "related";
    };
    for (const i of instructions) {
      if (
        implicitMemory(i) ||
        /^(lods|scas|cmps|movs|stos|ins|outs)/.test(i.mnemonic) ||
        (writesFirst(i) && register(i.operands[0]) && ["ss", "ds", "bp"].includes(i.operands[0].name))
      ) {
        invalid = true;
        break;
      }
      if (
        writesFirst(i) &&
        register(i.operands[0], "sp") &&
        !(["add", "sub"].includes(i.mnemonic) && immediate(i.operands[1]))
      ) {
        invalid = true;
        break;
      }
      if (writesFirst(i) && register(i.operands[0])) writtenRegisters.add(whole(i.operands[0].name));
      if (
        i.mnemonic === "mul" ||
        i.mnemonic === "imul" ||
        i.mnemonic === "div" ||
        i.mnemonic === "idiv" ||
        i.mnemonic === "cwd"
      ) {
        writtenRegisters.add("ax");
        writtenRegisters.add("dx");
      }
      if (i.mnemonic === "push" || i.mnemonic === "pop") writtenRegisters.add("sp");
      if (i.flow === "call") {
        const call = code.calls.find((c) => c.instruction === i.address);
        const helper = call?.target && helpers.get(call.target.address);
        if (
          !helper ||
          (!helper.footprint.preservesArgumentMemory && !helper.footprint.preservesPartState) ||
          (!helper.footprint.preservesArgumentMemory &&
            !helper.footprint.complete &&
            !helper.footprint.partMemoryComplete)
        ) {
          invalid = true;
          break;
        }
        if (register(counter) && volatile.has(counter.name)) {
          invalid = true;
          break;
        }
        if (
          memory(counter) &&
          !helper.footprint.preservesArgumentMemory &&
          instructions.some((p) => p.mnemonic === "lea" && same(p.operands[1], counter))
        ) {
          invalid = true;
          break;
        }
        if (!helper.footprint.preservesArgumentMemory && helper.argumentKind === "object") {
          let previous = before.get(i.address);
          if (previous?.mnemonic === "push" && register(previous.operands[0], "cs"))
            previous = before.get(previous.address);
          while (previous?.mnemonic === "nop") previous = before.get(previous.address);
          if (
            !previous ||
            previous.mnemonic !== "push" ||
            !register(previous.operands[0]) ||
            pointerBase(previous.operands[0].name, previous.address) !== "part"
          ) {
            invalid = true;
            break;
          }
        }
        if (helper.partGraph && helper.partGraph.objectArguments.length > 1) {
          // The second object comes from a bounded connection slot, copied intact through a private word.
          let firstPush = before.get(i.address);
          if (firstPush?.mnemonic === "push" && register(firstPush.operands[0], "cs"))
            firstPush = before.get(firstPush.address);
          while (firstPush?.mnemonic === "nop") firstPush = before.get(firstPush.address);
          const secondPush = firstPush && before.get(firstPush.address),
            slot = secondPush?.operands[0];
          const stores = memory(slot)
            ? instructions.filter(
                (p) =>
                  writesFirst(p) &&
                  memory(p.operands[0]) &&
                  p.operands[0].segment === "ss" &&
                  p.operands[0].base.join() === "bp" &&
                  p.operands[0].displacement < slot.displacement + 2 &&
                  slot.displacement < p.operands[0].displacement + p.operands[0].width / 8,
              )
            : [];
          const store = stores[0],
            load = store && before.get(store.address),
            shift = load && before.get(load.address),
            index = shift && before.get(shift.address),
            source = load?.operands[1];
          if (
            helper.partGraph.objectArguments.join() !== "6,8" ||
            relation !== "<" ||
            limit > helper.partGraph.links.length ||
            secondPush?.mnemonic !== "push" ||
            !memory(slot) ||
            slot.width !== 16 ||
            slot.segment !== "ss" ||
            slot.base.join() !== "bp" ||
            slot.displacement >= 0 ||
            stores.length !== 1 ||
            store?.mnemonic !== "mov" ||
            !same(store.operands[0], slot) ||
            !register(store.operands[1], "ax") ||
            !dominates(store.address, secondPush.address, bodyEntry) ||
            load?.mnemonic !== "mov" ||
            !register(load.operands[0], "ax") ||
            !memory(source) ||
            source.width !== 16 ||
            source.segment !== "ds" ||
            source.base.length !== 2 ||
            !source.base.includes("bx") ||
            !source.base.some((r) => stableOwners.has(r)) ||
            source.displacement !== helper.partGraph.links[0] ||
            shift?.mnemonic !== "shl" ||
            !register(shift.operands[0], "bx") ||
            !immediate(shift.operands[1], 1) ||
            index?.mnemonic !== "mov" ||
            !register(index.operands[0], "bx") ||
            !same(index.operands[1], counter)
          ) {
            invalid = true;
            break;
          }
          const setup = [index, shift, load, store];
          const bridge = code.instructions.filter((p) => p.address >= secondPush.address && p.address <= i.address);
          if (
            [setup, bridge].some((chain) =>
              chain.some(
                (p, n) =>
                  n > 0 &&
                  (incoming.get(p!.address)?.length !== 1 || incoming.get(p!.address)?.[0] !== chain[n - 1]!.address),
              ),
            )
          ) {
            invalid = true;
            break;
          }
          minimumCounter = 0;
        }
        for (const name of volatile) writtenRegisters.add(name);
        if (helper.partGraph) {
          if (helper.partGraph.fields.some((f) => overlaps(f.offset, f.width, stateOffset))) {
            invalid = true;
            break;
          }
          fields.push(
            ...helper.partGraph.fields.map((f) => ({
              ...f,
              root: "related" as const,
              object: "related" as const,
              partGraph: true,
              preservesNonzeroOwner: f.offset === helper.partGraph!.preservesNonzeroOwnerField,
            })),
          );
        }
        for (const write of helper.partGraph ? [] : helper.writes) {
          if (write.root !== "global" && !write.separateStorage && overlaps(write.offset, write.width, stateOffset)) {
            invalid = true;
            break;
          }
          fields.push({
            root:
              write.separateStorage === "outline"
                ? "buffer"
                : write.root === "global"
                  ? "global"
                  : write.path.length
                    ? "related"
                    : "part",
            object:
              write.separateStorage === "outline"
                ? "buffer"
                : write.root === "global"
                  ? "data"
                  : write.path.length
                    ? "related"
                    : "part",
            offset: write.offset,
            width: write.width,
          });
        }
        if (invalid) break;
        helperEvidence.push(...helper.evidence);
        for (const assumption of helper.assumptions) assumptions.add(assumption);
      }
      if (!writesFirst(i) || !memory(i.operands[0])) continue;
      const dest = i.operands[0];
      if (dest.segment === "ss" && dest.base.length === 1 && dest.base[0] === "bp" && dest.displacement < 0) {
        fields.push({ root: "stack", object: "stack", offset: dest.displacement, width: dest.width, operand: dest });
        continue;
      }
      if (dest.segment === "ds" && dest.base.length === 2 && step === 1 && limit <= 64) {
        const owner = dest.base.find((name) => stableOwners.has(name));
        const index = dest.base.find((name) => name !== owner);
        const affine = (name: string, at: number, depth = 0): { scale: number; bias: number } | undefined => {
          if (depth > 8) return undefined;
          const definition = instructions
            .filter(
              (previous) => previous.address < at && writesFirst(previous) && register(previous.operands[0], name),
            )
            .at(-1);
          if (!definition || !dominates(definition.address, at, bodyEntry)) return undefined;
          const source = definition.operands[1];
          if (definition.mnemonic === "mov" && same(source, counter)) return { scale: 1, bias: 0 };
          if (definition.mnemonic === "mov" && register(source))
            return affine(source.name, definition.address, depth + 1);
          if (!["shl", "add", "sub"].includes(definition.mnemonic) || !immediate(source)) return undefined;
          const before = affine(name, definition.address, depth + 1);
          if (!before) return undefined;
          if (definition.mnemonic === "shl")
            return source.value <= 4
              ? { scale: before.scale * 2 ** source.value, bias: before.bias * 2 ** source.value }
              : undefined;
          return { scale: before.scale, bias: before.bias + source.value * (definition.mnemonic === "add" ? 1 : -1) };
        };
        const expression = index && affine(index, i.address);
        const maxIndex = limit - (relation === "<" ? 1 : 0);
        if (owner && expression && expression.scale > 0 && expression.scale <= 16 && maxIndex >= 0) {
          const first = dest.displacement + expression.bias;
          const last = first + maxIndex * expression.scale;
          if (
            first >= 0 &&
            last + dest.width / 8 <= 0x10000 &&
            !Array.from({ length: maxIndex + 1 }, (_, index) => first + index * expression.scale).some((offset) =>
              overlaps(offset, dest.width, stateOffset),
            )
          ) {
            minimumCounter = 0;
            // This is the union of possible write addresses, not a traversal of the instruction body.
            for (let index = 0; index <= maxIndex; index++)
              fields.push({
                root: "part",
                object: "part",
                offset: first + index * expression.scale,
                width: dest.width,
              });
            assumptions.add(
              "The entry counter is nonnegative; affine indices stay within the statically bounded owner-field footprint without wrapping.",
            );
            continue;
          }
        }
      }
      if (dest.segment !== "ds" || dest.base.length !== 1) {
        invalid = true;
        break;
      }
      const root = pointerBase(dest.base[0]!, i.address);
      if (!root || (root !== "buffer" && overlaps(dest.displacement, dest.width, stateOffset))) {
        invalid = true;
        break;
      }
      if (root === "buffer")
        assumptions.add(
          "The outline buffer identified by the shared edge-data helper is separate from part-object storage and covers the bounded strided writes without address wrap.",
        );
      fields.push({
        root,
        object: root,
        register: dest.base[0]!,
        offset: dest.displacement,
        width: dest.width,
        operand: dest,
        ...(root === "related" &&
        i.mnemonic === "mov" &&
        register(i.operands[1]) &&
        (() => {
          const load = before.get(i.address);
          return (
            load?.mnemonic === "mov" &&
            register(load.operands[0], i.operands[1].name) &&
            memory(load.operands[1]) &&
            load.operands[1].segment === "ds" &&
            load.operands[1].base.length === 1 &&
            stableOwners.has(load.operands[1].base[0]!) &&
            load.operands[1].displacement === dest.displacement &&
            load.operands[1].width === dest.width &&
            (incoming.get(i.address) ?? []).every((address) => address === load.address)
          );
        })()
          ? { preservesOwnerValue: true }
          : {}),
      });
    }
    if (invalid) continue;
    for (const field of fields)
      if (
        field.preservesOwnerValue &&
        fields.some(
          (other) =>
            other !== field &&
            !["stack", "buffer", "global"].includes(other.root) &&
            other.offset < field.offset + field.width / 8 &&
            field.offset < other.offset + other.width / 8 &&
            !other.preservesOwnerValue,
        )
      )
        delete field.preservesOwnerValue;
    if (fields.some((field) => field.preservesOwnerValue))
      assumptions.add(
        "Related references denote complete part bases. Every store overlapping the preserved owner word copies that same owner's word, so a possible owner alias is an identity store; other members can still change.",
      );
    // The transfer skips stack operations as well, so every path must restore the same entry SP.
    const stackDeltas = new Map<number, number>([[bodyEntry, 0]]);
    const stackQueue = [bodyEntry];
    while (stackQueue.length && !invalid) {
      const address = stackQueue.pop()!;
      const delta = stackDeltas.get(address)!;
      if (address === compare.address) {
        if (delta !== 0) invalid = true;
        continue;
      }
      const i = byAddress.get(address)!;
      let change = i.mnemonic === "push" ? -2 : i.mnemonic === "pop" ? 2 : 0;
      if (["add", "sub"].includes(i.mnemonic) && register(i.operands[0], "sp") && immediate(i.operands[1]))
        change = i.operands[1].value * (i.mnemonic === "add" ? 1 : -1);
      if (i.flow === "call") {
        const call = code.calls.find((c) => c.instruction === i.address)!;
        const helper = call.target && helpers.get(call.target.address);
        if (
          !helper?.returnConvention &&
          helper?.evidence.some((e) => (e.bytes[0] === 0xca || e.bytes[0] === 0xc2) && e.bytes.length === 3)
        ) {
          invalid = true;
          break;
        }
        const previous = before.get(i.address);
        const pushedSegment = previous?.mnemonic === "push" && register(previous.operands[0], "cs");
        if (helper?.returnConvention) {
          if (
            (call.far && helper.returnConvention.kind !== "far") ||
            (!call.far && helper.returnConvention.kind === "far" && !pushedSegment)
          ) {
            invalid = true;
            break;
          }
          change += helper.returnConvention.stackBytes;
        }
        if (
          !call.far &&
          previous?.mnemonic === "push" &&
          register(previous.operands[0], "cs") &&
          helper?.argumentOffset === 6
        )
          change += 2;
      }
      for (const next of outgoing.get(address) ?? []) {
        const existing = stackDeltas.get(next);
        if (existing !== undefined && existing !== delta + change) {
          invalid = true;
          break;
        }
        if (existing === undefined) {
          stackDeltas.set(next, delta + change);
          stackQueue.push(next);
        }
      }
    }
    if (invalid) continue;
    writtenRegisters.delete("sp");
    assumptions.add(
      "Every acyclic body path restores SP, including caller argument cleanup and the compiler's PUSH CS before a near call to a far-return helper.",
    );
    result.push({
      header: compare.address,
      bodyEntry,
      body: [...body].sort((a, b) => a - b),
      latch: latch.address,
      exit,
      counter,
      limit,
      step,
      relation,
      signed,
      ...(minimumCounter !== undefined ? { minimumCounter } : {}),
      proof: {
        update: update.address,
        variant:
          step === 1
            ? `limit - counter${relation === "<=" ? " + 1" : ""}`
            : `counter - limit${relation === ">=" ? " + 1" : ""}`,
        updateDominatesLatch: true,
        singleEntry: true,
        acyclicBody: true,
      },
      writtenRegisters: [...writtenRegisters].sort(),
      possibleFields: [...new Map(fields.map((f) => [JSON.stringify(f), f])).values()],
      confidence: "inferred",
      assumptions: [...assumptions],
      evidence: [
        ...new Map(
          [...instructions, compare, latch]
            .map(evidence)
            .concat(helperEvidence)
            .map((e) => [e.address, e]),
        ).values(),
      ],
    });
  }
  return result;
}
