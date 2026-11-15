/** Reads creation-time literal defaults without choosing inputs or executing a constructor. */
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout, LayoutField } from "./behaviour-layout.ts";
import type { CodeAddress, Instruction, Operand } from "./x86.ts";
import type { Evidence, Finding } from "./behaviour.ts";
import { evidenceOf, isRegister, overlapsWord } from "./behaviour-terms.ts";

export interface CreationField extends Finding {
  offset: number;
  name: string;
  value: number;
  width: 16;
}

export interface CreationDefault extends Finding {
  partType: number;
  routine: number;
  source: "constructor" | "zeroed-allocation";
  constructorCode?: CodeAddress;
  fields: CreationField[];
  uncertainties: string[];
}

type Value = number | "input";
interface State {
  roots: Map<string, "owner" | "buffer">;
  constants: Map<string, number>;
  fields: Map<number, Value>;
  argumentIntact: boolean;
}
const memory = (o: Operand | undefined, base?: string): o is Extract<Operand, { kind: "memory" }> =>
  o?.kind === "memory" && (base === undefined || (o.base.length === 1 && o.base[0] === base));
const writesMemory = (i: Instruction) =>
  memory(i.operands[0]) && !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const clone = (s: State): State => ({
  ...s,
  roots: new Map(s.roots),
  constants: new Map(s.constants),
  fields: new Map(s.fields),
});
function intersect<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
  return new Map([...a].filter(([k, v]) => b.has(k) && b.get(k) === v));
}
function same(a: State, b: State): boolean {
  return (
    a.argumentIntact === b.argumentIntact &&
    ["roots", "constants", "fields"].every((key) => {
      const left = a[key as "roots"] as Map<unknown, unknown>,
        right = b[key as "roots"] as Map<unknown, unknown>;
      return left.size === right.size && [...left].every(([k, v]) => right.get(k) === v);
    })
  );
}

/**
 * Factory metadata bounds the initialization table; each constructor is inspected as a separate far routine. `graphs`
 * holds the routines already read, so a factory is read in its own segment; without it the segment is guessed.
 */
export function discoverCreationDefaults(
  image: Uint8Array,
  helpers: EngineSummary[],
  layout: BehaviourLayout,
  dataSegment: number,
  graphs: ReadonlyMap<number, RoutineCode> = new Map(),
): CreationDefault[] {
  const roles = new Set([
    "state",
    "previousState",
    "savedState",
    "stateDelta",
    "savedStateDelta",
    "control",
    "trigger",
  ]);
  const fields = layout.fields.filter((f) => roles.has(f.name));
  const helperMap = new Map(helpers.map((h) => [h.address, h]));
  const codes = new Map<number, RoutineCode>();
  const results: CreationDefault[] = [];
  const allowedBuffers = new Set(
    helpers
      .filter((h) => h.kind === "geometry-edge-data" && h.footprint.preservesPartState)
      .flatMap((h) => h.writes.filter((w) => w.path.length === 1 && w.repeated).map((w) => w.path[0]!)),
  );
  const read = (address: CodeAddress): RoutineCode => {
    let code = codes.get(address.address);
    if (!code) {
      code = readRoutineCode(image, address, dataSegment);
      codes.set(address.address, code);
    }
    return code;
  };
  const named = new Map(layout.fields.map((f) => [f.offset, f]));
  for (const engine of helpers) {
    const factory = engine.factory;
    if (!factory) continue;
    // The words the cleared allocation leaves zero are followed as fields too, named by the layout when it can.
    const zeroWords = new Set(factory.noConstructor.zeroWords ?? []);
    const tracked: LayoutField[] = [
      ...fields,
      ...[...zeroWords]
        .filter((offset) => !fields.some((f) => f.offset === offset))
        .map((offset): LayoutField => ({
          ...(named.get(offset) ?? { confidence: "inferred", evidence: [], assumptions: [] }),
          offset,
          name: named.get(offset)?.name ?? `+0x${offset.toString(16).padStart(2, "0")}`,
        })),
    ];
    const factoryCode =
      graphs.get(engine.address) ??
      read({
        address: engine.address,
        segment: Math.floor(engine.address / 0x10000) * 0x1000,
        offset: engine.address & 0xffff,
      });
    const indirect = factoryCode.calls.find(
      (c) =>
        c.far &&
        memory(c.operand) &&
        c.operand.segment === "ds" &&
        c.operand.displacement === factory.constructorTable.offset,
    );
    if (!indirect) continue;
    const before = factoryCode.instructions.filter((i) => i.address < indirect.instruction);
    const pushIndex = before.findLastIndex((i) => i.mnemonic === "push");
    const push = before[pushIndex];
    if (
      !push ||
      !isRegister(push.operands[0]) ||
      before.slice(pushIndex + 1).some((i) => i.flow === "call" || isRegister(i.operands[0], "sp"))
    )
      continue;
    const ownerRegister = push.operands[0].name;
    const allocation = factoryCode.calls.find(
      (c) => c.target && helperMap.get(c.target.address)?.kind === "nullable-allocation",
    );
    if (
      !allocation?.target ||
      !before.some(
        (i) =>
          i.address > allocation.instruction &&
          i.address < allocation.instruction + 16 &&
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], ownerRegister) &&
          isRegister(i.operands[1], "ax"),
      )
    )
      continue;
    const allocationEntry = allocation.target.address;
    const preservation = new Map<string, { safe: boolean; evidence: Evidence[] }>();
    const proof = new Map<number, Evidence>();
    const assumptions = new Set<string>([
      "Creation defaults apply to fresh parts before level data or reset routines replace their fields.",
      "The factory passes its new part pointer as the first argument of a far constructor; decoded C callee-saved registers retain that pointer across calls.",
      ...factory.noConstructor.assumptions,
    ]);
    const uncertainties = new Set<string>();
    const analyse = (
      code: RoutineCode,
      selected: LayoutField[],
      initial: Map<number, Value>,
      depth: number,
    ): Map<number, Value> => {
      if (
        code.status !== "complete" ||
        depth > 8 ||
        !code.instructions.length ||
        !code.instructions.every((i) => i.flow !== "stop")
      )
        return new Map();
      const returns = code.instructions.filter((i) => i.flow === "return");
      if (!returns.length || returns.some((i) => i.mnemonic !== "retf")) return new Map();
      const first = code.instructions[0],
        second = code.instructions[1];
      if (
        !first ||
        first.mnemonic !== "push" ||
        !isRegister(first.operands[0], "bp") ||
        second?.mnemonic !== "mov" ||
        !isRegister(second.operands[0], "bp") ||
        !isRegister(second.operands[1], "sp")
      )
        return new Map();
      if (
        code.instructions.some(
          (i) =>
            (isRegister(i.operands[0], "bp") &&
              !["push", "pop", "cmp", "test"].includes(i.mnemonic) &&
              i.address !== second.address) ||
            isRegister(i.operands[0], "ss") ||
            (isRegister(i.operands[0], "ds") && !["push", "cmp", "test"].includes(i.mnemonic)) ||
            i.mnemonic === "lds",
        )
      )
        return new Map();
      const instructions = new Map(code.instructions.map((i) => [i.address, i]));
      const outgoing = new Map<number, number[]>();
      for (const e of code.edges) if (e.to !== null) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
      const states = new Map<number, State>([
        [code.address, { roots: new Map(), constants: new Map(), fields: initial, argumentIntact: true }],
      ]);
      const pending = [code.address];
      const final: State[] = [];
      let budget = Math.max(1024, code.instructions.length * 40);
      while (pending.length && budget-- > 0) {
        const at = pending.pop()!,
          s = clone(states.get(at)!),
          i = instructions.get(at)!;
        proof.set(i.address, evidenceOf(i));
        const [dest, source] = i.operands;
        if (/^(movs|stos|ins|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic)) {
          s.fields.clear();
          s.roots.clear();
          s.constants.clear();
        }
        if (writesMemory(i) && memory(dest)) {
          const root = dest.base.length === 1 ? s.roots.get(dest.base[0]!) : undefined;
          if (dest.segment === "ss" && dest.base.length === 1 && dest.base[0] === "bp" && dest.displacement < 0) {
            /* Private frame storage cannot alias a part. */
          } else if (dest.segment === "ds" && root === "buffer")
            assumptions.add(
              "Geometry buffers identified by the shared edge-data helper are separate allocations from their owning part and contain the fixed records addressed by the constructor.",
            );
          else if (dest.segment === "ds" && root === "owner") {
            for (const f of selected)
              if (overlapsWord(dest.displacement, dest.width, f.offset)) {
                const value =
                  source?.kind === "immediate"
                    ? source.value
                    : isRegister(source)
                      ? s.constants.get(source.name)
                      : undefined;
                if (i.mnemonic === "mov" && dest.width === 16 && dest.displacement === f.offset && value !== undefined)
                  s.fields.set(f.offset, value & 0xffff);
                else if (
                  dest.width === 16 &&
                  dest.displacement === f.offset &&
                  typeof s.fields.get(f.offset) === "number"
                ) {
                  const before = s.fields.get(f.offset) as number;
                  const result =
                    i.mnemonic === "and" && value !== undefined
                      ? before & value
                      : i.mnemonic === "or" && value !== undefined
                        ? before | value
                        : i.mnemonic === "xor" && value !== undefined
                          ? before ^ value
                          : i.mnemonic === "add" && value !== undefined
                            ? before + value
                            : i.mnemonic === "sub" && value !== undefined
                              ? before - value
                              : i.mnemonic === "inc"
                                ? before + 1
                                : i.mnemonic === "dec"
                                  ? before - 1
                                  : undefined;
                  if (result === undefined) s.fields.delete(f.offset);
                  else s.fields.set(f.offset, result & 0xffff);
                } else s.fields.delete(f.offset);
              }
          } else {
            s.fields.clear();
            if (dest.segment === "ss") {
              s.argumentIntact = false;
              s.roots.clear();
            }
          }
        }
        if (i.flow === "call") {
          const call = code.calls.find((c) => c.instruction === i.address),
            summary = call?.target && helperMap.get(call.target.address);
          const previous = code.instructions.filter((p) => p.address < i.address);
          let pushAt = previous.length - 1;
          if (previous[pushAt]?.mnemonic === "push" && isRegister(previous[pushAt]?.operands[0], "cs")) pushAt--;
          while (previous[pushAt]?.mnemonic === "nop") pushAt--;
          const argPush = previous[pushAt];
          const argumentRegister = isRegister(argPush?.operands[0]) ? argPush.operands[0].name : undefined;
          const ownerPassed =
            argPush?.mnemonic === "push" &&
            argumentRegister !== undefined &&
            s.roots.get(argumentRegister) === "owner" &&
            previous
              .slice(pushAt + 1)
              .every(
                (instruction) => !isRegister(instruction.operands[0], argumentRegister) && instruction.flow !== "call",
              );
          for (const f of selected) {
            let safe = false;
            if (call?.target?.address === allocationEntry) {
              safe = true;
              for (const e of factory.noConstructor.evidence) proof.set(e.address, e);
            } else if (summary?.footprint.preservesArgumentMemory) safe = true;
            else if (summary?.footprint.partMemoryComplete)
              // Only a write through the first argument, which is the part, can be placed on the part.
              safe = summary.writes.every(
                (w) =>
                  w.root === "global" ||
                  (ownerPassed &&
                    w.root === "argument" &&
                    (w.argumentOffset ?? summary.argumentOffset) === summary.argumentOffset &&
                    ((w.path.length === 1 && allowedBuffers.has(w.path[0]!)) ||
                      (w.path.length === 0 && !overlapsWord(w.offset, w.width, f.offset)))),
              );
            else if (ownerPassed && f.name === "state" && summary?.footprint.preservesPartState) safe = true;
            else if (call?.target && ownerPassed) {
              const key = `${call.target.address}:${f.offset}`;
              if (!preservation.has(key)) {
                preservation.set(key, { safe: false, evidence: [] });
                const safe =
                  analyse(read(call.target), [f], new Map([[f.offset, "input"]]), depth + 1).get(f.offset) === "input";
                preservation.set(key, { safe, evidence: [...proof.values()] });
              }
              safe = preservation.get(key)!.safe;
              for (const item of preservation.get(key)!.evidence) proof.set(item.address, item);
            }
            if (!safe && call?.target && ownerPassed && typeof s.fields.get(f.offset) === "number") {
              const value = analyse(
                read(call.target),
                [f],
                new Map([[f.offset, s.fields.get(f.offset)!]]),
                depth + 1,
              ).get(f.offset);
              if (typeof value === "number") {
                s.fields.set(f.offset, value);
                safe = true;
              }
            }
            if (!safe) {
              s.fields.delete(f.offset);
              uncertainties.add(`A call at 0x${i.address.toString(16)} may replace ${f.name}.`);
            }
          }
          if (summary) {
            for (const e of summary.evidence) proof.set(e.address, e);
            for (const a of summary.assumptions) assumptions.add(a);
          }
          for (const r of ["ax", "bx", "cx", "dx"]) {
            s.roots.delete(r);
            s.constants.delete(r);
          }
        } else if (
          isRegister(dest) &&
          !["push", "cmp", "test"].includes(i.mnemonic) &&
          i.flow !== "branch" &&
          i.flow !== "jump"
        ) {
          const oldRoot = s.roots.get(dest.name),
            value =
              source?.kind === "immediate"
                ? source.value
                : isRegister(source)
                  ? s.constants.get(source.name)
                  : undefined;
          let root: "owner" | "buffer" | undefined;
          if (i.mnemonic === "mov") {
            if (isRegister(source)) root = s.roots.get(source.name);
            else if (
              memory(source, "bp") &&
              source.segment === "ss" &&
              source.displacement === 6 &&
              source.width === 16 &&
              s.argumentIntact
            )
              root = "owner";
            else if (
              memory(source) &&
              source.segment === "ds" &&
              source.base.length === 1 &&
              s.roots.get(source.base[0]!) === "owner" &&
              allowedBuffers.has(source.displacement)
            )
              root = "buffer";
          } else if (
            i.mnemonic === "add" &&
            source?.kind === "immediate" &&
            source.value >= 0 &&
            source.value <= 256 &&
            oldRoot === "buffer"
          )
            root = "buffer";
          s.roots.delete(dest.name);
          s.constants.delete(dest.name);
          if (root) s.roots.set(dest.name, root);
          if (i.mnemonic === "mov" && value !== undefined && dest.width === 16)
            s.constants.set(dest.name, value & 0xffff);
          if (i.mnemonic === "xor" && isRegister(source, dest.name) && dest.width === 16) s.constants.set(dest.name, 0);
          if (dest.width === 8) {
            s.constants.delete(dest.name[0] + "x");
            s.roots.delete(dest.name[0] + "x");
          }
        }
        // These instructions replace implicit result registers even when their
        // first printed operand is a source or there is no printed operand.
        if (["mul", "imul", "div", "idiv", "cwd"].includes(i.mnemonic)) {
          for (const r of ["ax", "dx"]) {
            s.constants.delete(r);
            s.roots.delete(r);
          }
        }
        if (["cbw", "lahf", "lodsb", "lodsw", "aaa", "aas", "daa", "das", "aam", "aad", "xlat"].includes(i.mnemonic)) {
          s.constants.delete("ax");
          s.roots.delete("ax");
        }
        if (i.mnemonic === "leave" || (i.mnemonic === "pop" && isRegister(dest, "bp"))) s.argumentIntact = false;
        if (i.mnemonic.startsWith("loop")) {
          s.constants.delete("cx");
          s.roots.delete("cx");
        }
        if (i.mnemonic === "xchg" && isRegister(source)) {
          s.constants.delete(source.name);
          s.roots.delete(source.name);
        }
        if (i.flow === "return") {
          final.push(s);
          continue;
        }
        for (const next of outgoing.get(at) ?? []) {
          const old = states.get(next),
            merged = old
              ? {
                  roots: intersect(old.roots, s.roots),
                  constants: intersect(old.constants, s.constants),
                  fields: intersect(old.fields, s.fields),
                  argumentIntact: old.argumentIntact && s.argumentIntact,
                }
              : clone(s);
          if (!old || !same(old, merged)) {
            states.set(next, merged);
            pending.push(next);
          }
        }
      }
      if (pending.length || !final.length) return new Map();
      return final.map((s) => s.fields).reduce(intersect);
    };
    const { segment, offset, stride, typeCount } = factory.constructorTable;
    for (let partType = 0; partType < typeCount; partType++) {
      const entry = segment * 16 + offset + stride * partType;
      if (entry < 0 || entry + 4 > image.length) continue;
      const targetOffset = image[entry]! | (image[entry + 1]! << 8),
        targetSegment = image[entry + 2]! | (image[entry + 3]! << 8);
      const tableEvidence: Evidence = {
        address: entry,
        bytes: Array.from(image.subarray(entry, entry + 4)),
        text: `Creation constructor pointer for type ${partType}: ${targetSegment.toString(16)}:${targetOffset.toString(16)}`,
      };
      if (!targetOffset && !targetSegment) {
        const initial = factory.noConstructor.initialState;
        const f = initial && fields.find((f) => f.name === "state" && f.offset === initial.offset);
        if (f && initial && factory.noConstructorTypes.includes(partType))
          results.push({
            partType,
            routine: engine.address,
            source: "zeroed-allocation",
            constructorCode: undefined,
            fields: tracked
              .filter((field) => field.offset === initial.offset || zeroWords.has(field.offset))
              .map((field) => ({
                confidence: factory.noConstructor.confidence,
                evidence: factory.noConstructor.evidence,
                assumptions: factory.noConstructor.assumptions,
                offset: field.offset,
                name: field.name,
                value: 0,
                width: 16 as const,
              })),
            confidence: "inferred",
            evidence: [tableEvidence, ...factory.noConstructor.evidence],
            assumptions: [...assumptions],
            uncertainties: [],
          });
        continue;
      }
      const constructor = { segment: targetSegment, offset: targetOffset, address: targetSegment * 16 + targetOffset };
      if (constructor.address >= image.length) continue;
      proof.clear();
      uncertainties.clear();
      const initial = factory.noConstructor.initialState;
      const selected = initial && fields.find((field) => field.name === "state" && field.offset === initial.offset);
      const defaults = new Map<number, Value>();
      if (selected && initial) {
        defaults.set(selected.offset, initial.value);
        for (const item of factory.noConstructor.evidence) proof.set(item.address, item);
        if (zeroWords.size) {
          for (const offset of zeroWords) defaults.set(offset, 0);
          assumptions.add(
            "Every word the factory's cleared allocation leaves unwritten is supplied to the constructor relation as zero; words the factory or its callees may write remain unknown.",
          );
        } else
          assumptions.add(
            "Only the state word proved zero by the factory's cleared-allocation contract is supplied to the constructor relation; other unassigned fields remain unknown.",
          );
      }
      const values = analyse(read(constructor), tracked, defaults, 0);
      const found = tracked
        .filter((f) => typeof values.get(f.offset) === "number")
        .map((f): CreationField => ({
          offset: f.offset,
          name: f.name,
          value: values.get(f.offset) as number,
          width: 16,
          confidence: "inferred",
          evidence: [...proof.values()],
          assumptions: [...assumptions],
        }));
      results.push({
        partType,
        routine: constructor.address,
        constructorCode: constructor,
        source: "constructor",
        fields: found,
        confidence: found.length ? "inferred" : "unresolved",
        evidence: [tableEvidence, evidenceOf(push), ...proof.values()],
        assumptions: [...assumptions],
        uncertainties: [
          ...uncertainties,
          ...(found.length ? [] : ["No literal field default survives every decoded constructor return."]),
        ],
      });
    }
  }
  return results;
}
