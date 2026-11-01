/** Reuses complete symbolic return relations to bound owner fields and separate outline-buffer effects. */
import type { RoutineAnalysis } from "./behaviour.ts";
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
  const writes = routine.writes.filter((write) => write.object !== "stack");
  if (
    !writes.length ||
    writes.some((write) => write.object !== "part" && write.object !== "data" && !pathOf(write.object))
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
  const nested = (routine.engineCalls ?? []).map((call) => helpers.get(call.summary));
  if (
    nested.some(
      (helper) => !helper || (!helper.footprint.preservesArgumentMemory && !helper.footprint.partMemoryComplete),
    )
  )
    return;
  const unknownGlobals = [...new Set(nested.flatMap((helper) => helper!.footprint.unknownGlobalEffects ?? []))];
  const effects: EngineWrite[] = writes.map((write) => ({
    ...write,
    root: write.object === "data" ? "global" : "argument",
    argumentOffset: base,
    path: write.object === "part" || write.object === "data" ? [] : pathOf(write.object)!,
    ...(pathOf(write.object) ? { separateStorage: "outline" as const } : {}),
  }));
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
