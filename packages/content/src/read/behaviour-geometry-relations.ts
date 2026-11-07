/** Reuses complete symbolic return relations to bound owner fields and separate outline-buffer effects. */
import { chooseByTests, type Predicate, type RoutineAnalysis } from "./behaviour.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";

export function engineFromObjectRelation(
  routine: RoutineAnalysis,
  layout: BehaviourLayout,
  helpers: Map<number, EngineSummary>,
): EngineSummary | undefined {
  if (
    routine.uncertainEffects ||
    routine.returnPathsComplete !== true ||
    !routine.outcomes?.length ||
    routine.outcomes.some((outcome) => outcome.effectsComplete !== true)
  )
    return;
  const base = routine.objectPointer.argumentBase ?? routine.objectPointer.argumentOffset;
  if (base !== routine.objectPointer.argumentOffset) return;
  const buffers = layout.fields.filter((field) => field.name === "outlinePoints");
  const pathOf = (object: string) => {
    const field = buffers.find((field) => object === `referenced-by(part+0x${field.offset.toString(16)})`);
    return field ? [field.offset] : undefined;
  };
  const fresh = freshObjects(routine, helpers);
  const isFresh = (object: string) => fresh.objects.has(object.replace(/^referenced-by\((.*)\+0x[0-9a-f]+\)$/, "$1"));
  const freshWrites = routine.writes.filter((write) => isFresh(write.object));
  const writes = routine.writes.filter((write) => write.object !== "stack" && !isFresh(write.object));
  if (
    !writes.length ||
    writes.some((write) => write.object !== "part" && write.object !== "data" && !pathOf(write.object)) ||
    // A fresh part never reaches the caller: no kept write stores its address, and the summary returns nothing.
    [...fresh.addresses].some((address) => writes.some((write) => JSON.stringify(write.value).includes(address)))
  )
    return;
  const used = buffers.filter((field) => writes.some((write) => pathOf(write.object)?.[0] === field.offset));
  if (
    writes.some(
      (write) =>
        write.object === "part" &&
        used.some((field) => write.offset < field.offset + 2 && field.offset < write.offset + write.width / 8),
    )
  )
    return;
  const state = layout.fields.find((field) => field.name === "state");
  if (!state) return;
  // A factory call the analysis specialised to a type without a constructor has that case's footprint.
  const nested = (routine.engineCalls ?? []).map((call) => {
    const helper = helpers.get(call.summary);
    const specialised = helper?.factory?.noConstructor;
    return specialised && call.purpose !== helper.purpose ? { ...helper, ...specialised } : helper;
  });
  if (
    nested.some(
      (helper) => !helper || (!helper.footprint.preservesArgumentMemory && !helper.footprint.partMemoryComplete),
    )
  )
    return;
  const unknownGlobals = [...new Set(nested.flatMap((helper) => helper!.footprint.unknownGlobalEffects ?? []))];
  // Putting a fresh part on a parts list rewrites the list links of its new neighbours, which may be any part.
  const neighbours = freshWrites.length ? freshNeighbourWrites(routine, helpers, base) : [];
  const final = finalOwnerFields(routine, writes);
  const effects: EngineWrite[] = writes
    .filter((write) => !(write.object === "part" && final?.has(`${write.offset}:${write.width}`)))
    .map((write) => ({
      ...write,
      root: write.object === "data" ? "global" : "argument",
      argumentOffset: base,
      path: write.object === "part" || write.object === "data" ? [] : pathOf(write.object)!,
      ...(pathOf(write.object) ? { separateStorage: "outline" as const } : {}),
    }));
  for (const write of final?.values() ?? [])
    effects.push({ ...write, root: "argument", argumentOffset: base, path: [] });
  effects.push(...neighbours);
  const returns = routine.instructions.filter((i) => i.flow === "return");
  if (!returns.length || returns.some((i) => !["ret", "retf"].includes(i.mnemonic))) return;
  const convention = (i: (typeof returns)[number]) => ({
    kind: i.mnemonic === "retf" ? ("far" as const) : ("near" as const),
    stackBytes: i.operands[0]?.kind === "immediate" ? i.operands[0].value : 0,
  });
  const returned = convention(returns[0]!);
  if (returns.some((i) => JSON.stringify(convention(i)) !== JSON.stringify(returned))) return;
  const assumptions = [
    ...new Set([
      ...routine.objectPointer.assumptions,
      ...used.flatMap((field) => field.assumptions),
      ...writes.flatMap((write) => write.assumptions),
      ...nested.flatMap((helper) => helper!.assumptions),
      "All owner writes have complete symbolic return coverage; unrelated object destinations are rejected.",
      ...(freshWrites.length
        ? [
            "Writes to a part the routine makes or copies, and to its records, stay in that fresh memory and are left out; the part's address is not stored in a kept field.",
          ]
        : []),
      ...(used.length
        ? ["The discovered outline pointer is unchanged by this relation and denotes separate valid outline storage."]
        : []),
    ]),
  ];
  return {
    address: routine.address,
    kind: used.length ? "owner-and-outline-relation" : "owner-field-relation",
    purpose: used.length
      ? "Updates the owner's recorded fields and its separate outline coordinates under the extracted return conditions."
      : "Updates only the argument part's recorded fields under the extracted return conditions.",
    argumentOffset: base,
    argumentKind: "object",
    writes: effects,
    returns: [],
    calls: routine.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
    returnConvention: returned,
    confidence: "inferred",
    assumptions,
    evidence: [
      ...routine.instructions.map((i) => ({ address: i.address, bytes: i.bytes, text: i.text })),
      ...used.flatMap((field) => field.evidence),
    ],
    footprint: {
      complete: unknownGlobals.length === 0,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: !writes.some(
        (write) =>
          write.object === "part" && write.offset < state.offset + 2 && state.offset < write.offset + write.width / 8,
      ),
      unknownEffects: unknownGlobals,
      unknownPartEffects: [],
      unknownGlobalEffects: unknownGlobals,
    },
  };
}

/**
 * The value each owner field the routine writes ends with, one per field: every way through the routine leaves it with
 * a value and the ways split like a tree on their tests, so the value is exact. A field for which that doesn't hold is
 * left out; undefined when two of the fields overlap.
 */
function finalOwnerFields(routine: RoutineAnalysis, writes: RoutineAnalysis["writes"]) {
  const keys = [...new Set(writes.filter((w) => w.object === "part").map((w) => `${w.offset}:${w.width}`))];
  const spans = keys.map((key) => key.split(":").map(Number) as [number, number]);
  if (spans.some(([a, aw], n) => spans.some(([b, bw], m) => n !== m && a < b + bw / 8 && b < a + aw / 8))) return;
  const outcomes = routine.outcomes ?? [];
  const terms = (p: Predicate): Predicate[] => (p.kind === "and" ? p.terms : p.kind === "true" ? [] : [p]);
  const out = new Map<string, RoutineAnalysis["writes"][number]>();
  for (const [key, [offset, width]] of keys.map((key, n) => [key, spans[n]!] as const)) {
    const ways = outcomes.map((outcome) => ({
      tests: terms(outcome.condition),
      value: outcome.fields.find((f) => f.object === "part" && f.offset === offset && f.width === width)?.value,
    }));
    if (ways.some((way) => !way.value)) continue;
    const value = chooseByTests(
      ways as { tests: Predicate[]; value: NonNullable<(typeof ways)[number]["value"]> }[],
      width,
    );
    if (!value || value.kind === "unknown") continue;
    const example = writes.find((w) => w.object === "part" && w.offset === offset && w.width === width)!;
    out.set(key, {
      ...example,
      value,
      condition: { kind: "true" },
      assumptions: [
        ...example.assumptions,
        "Every way through the routine was followed and leaves this field with a value; the ways split on their tests, so the field ends with the value of the way whose tests hold.",
      ],
      evidence: [
        ...new Map(
          writes
            .filter((w) => w.object === "part" && w.offset === offset)
            .flatMap((w) => w.evidence)
            .map((e) => [e.address, e]),
        ).values(),
      ],
    });
  }
  return out;
}

/** The kinds of helper whose nonzero return is a part in fresh memory. */
const FRESH_PART_KINDS = ["part-copy", "part-factory"];

/**
 * The names the routine analysis gives the parts its calls to a part copy or the part factory return, and the names
 * of their addresses.
 */
function freshObjects(routine: RoutineAnalysis, helpers: Map<number, EngineSummary>) {
  const objects = new Set<string>(),
    addresses = new Set<string>();
  for (const call of routine.engineCalls ?? []) {
    const helper = helpers.get(call.summary);
    if (!helper || !FRESH_PART_KINDS.includes(helper.kind) || helper.returnPointerClass !== "nullable-fresh") continue;
    const at = `0x${call.instruction.toString(16)}`;
    objects.add(`nullable allocation returned at ${at}`).add(`fresh object returned at ${at}`);
    addresses.add(`nullable allocation result at ${at}`);
  }
  return { objects, addresses };
}

/** The list link writes of the routine's list insertions, on neighbours that may be any existing part. */
function freshNeighbourWrites(
  routine: RoutineAnalysis,
  helpers: Map<number, EngineSummary>,
  argumentOffset: number,
): EngineWrite[] {
  return (routine.engineCalls ?? []).flatMap((call) =>
    (helpers.get(call.summary)?.writes ?? [])
      .filter((write) => write.root === "argument" && write.path.some((offset) => offset < 0))
      .map((write) => ({ ...write, argumentOffset, path: [-1] })),
  );
}
