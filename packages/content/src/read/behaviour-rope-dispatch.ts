/**
 * The rope connection query asks the part at the other end of each rope what to do, through that part type's rope
 * callback. This bounds what those callbacks may write, so a part that asks keeps its own fields.
 */
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { RoutineAnalysis } from "./behaviour.ts";

type Field = { offset: number; width: number };

/** Part fields that point to rope, belt and pulley records: a belt at 0x54, ropes at 0x66 and 0x68. */
const RECORD_LINKS = [0x54, 0x66, 0x68];
const record = /^referenced-by\(part(?: after [^()]*)?\+0x(54|66|68)\)$/;
/** A rope record chosen by a rope end's slot number: the word at the part's rope links plus twice that number. */
const indexedRope = /^pointer loaded from table 0x[0-9a-f]+\+0x(66|68) indexed by .*"address of part"/;
/** Parts that a nested rope query reached, named by the caller-side invalidation. */
const reached = /^a part reached through a rope, belt or pulley at 0x[0-9a-f]+$/;
export const ROPE_ASSUMPTIONS = [
  "A rope ties two different parts, so the part at the other end of a rope is never the part that asks.",
  "Ropes between parts never form a loop, so a chain of questions along ropes never comes back to the part that asked.",
  "A rope end's slot number is one of the part's two rope links, so indexing the links at 0x66 by it reaches a rope record.",
];

/**
 * What the rope callbacks may write, from their analyses: fields of their own part, which is the part at the other end
 * of the rope, and fields of its rope, belt and pulley records. Undefined when a callback writes anything else, or has
 * effects the analysis could not finish.
 */
export function ropeCallbackWrites(
  analyses: RoutineAnalysis[],
): { partFields: Field[]; recordFields: Field[]; globals: boolean } | undefined {
  const partFields = new Map<string, Field>();
  const recordFields = new Map<string, Field>();
  let globals = false;
  for (const analysis of analyses) {
    if (analysis.uncertainEffects || analysis.outcomes?.some((outcome) => outcome.effectsComplete !== true)) return;
    const writes = [...analysis.writes, ...(analysis.outcomes ?? []).flatMap((outcome) => outcome.fields)];
    for (const write of writes) {
      const field = { offset: write.offset, width: write.width };
      if (write.object === "part" || reached.test(write.object))
        partFields.set(`${field.offset}:${field.width}`, field);
      else if (record.test(write.object) || indexedRope.test(write.object))
        recordFields.set(`${field.offset}:${field.width}`, field);
      else if (write.object === "data") globals = true;
      else if (write.object !== "stack") return;
    }
  }
  return { partFields: [...partFields.values()], recordFields: [...recordFields.values()], globals };
}

/** The query's summary with a bounded dispatch: callbacks may change the asked parts, never the part that asks. */
export function ropeDispatchSummary(
  query: EngineSummary,
  writes: { partFields: Field[]; recordFields: Field[]; globals: boolean },
  callbacks: RoutineAnalysis[],
  askingArgument: number,
): EngineSummary {
  const evidence = [
    ...query.evidence,
    ...callbacks.flatMap((callback) =>
      callback.instructions.slice(0, 1).map(({ address, bytes, text }) => ({ address, bytes, text })),
    ),
  ];
  const assumptions = [...new Set([...query.assumptions, ...ROPE_ASSUMPTIONS])];
  const note = "A rope callback may change global storage.";
  const unknownWrites: EngineWrite[] = [...writes.partFields, ...writes.recordFields].map((field) => ({
    confidence: "inferred",
    evidence: query.evidence,
    assumptions: ROPE_ASSUMPTIONS,
    root: "unknown",
    path: [],
    offset: field.offset,
    width: field.width,
    value: {
      kind: "unknown",
      reason: "A rope callback of the part at the other end may set this field.",
      width: field.width,
    },
    condition: { kind: "unknown", reason: "The callback runs only when the query reaches that part." },
  }));
  return {
    ...query,
    evidence,
    assumptions,
    purpose:
      "Asks the part at the other end of each rope through its type's rope callback; those callbacks change only that part and its records.",
    writes: [...query.writes, ...unknownWrites],
    footprint: {
      complete: !writes.globals,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: writes.globals ? [note] : [],
      unknownPartEffects: [],
      unknownGlobalEffects: writes.globals ? [note] : [],
    },
    connected: {
      confidence: "inferred",
      evidence,
      assumptions,
      partFields: writes.partFields,
      recordFields: writes.recordFields,
      recordLinks: RECORD_LINKS,
      exceptArgument: askingArgument,
    },
  };
}
