/**
 * The rope connection query asks the part at the other end of each rope what to do, through that part type's rope
 * callback. This bounds what those callbacks may write. A question can come back to the part that asked (ropes can
 * form a ring), and then that part's own rope callback runs on it, so the part that asks keeps every field but those.
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
  "A rope end's slot number is one of the part's two rope links, so indexing the links at 0x66 by it reaches a rope record.",
];

export type RopeCallbackWrites = { partFields: Field[]; ownFields: Field[]; recordFields: Field[]; globals: boolean };

/**
 * What the rope callbacks may write, from their analyses: fields of their own part, which is the part at the other end
 * of the rope, fields of parts a nested query reached, and fields of their rope, belt and pulley records. `ownFields`
 * are only those written on their own part. Undefined when a callback writes anything else, or has effects the
 * analysis could not finish.
 */
export function ropeCallbackWrites(analyses: RoutineAnalysis[]): RopeCallbackWrites | undefined {
  const partFields = new Map<string, Field>();
  const ownFields = new Map<string, Field>();
  const recordFields = new Map<string, Field>();
  let globals = false;
  for (const analysis of analyses) {
    if (analysis.uncertainEffects || analysis.outcomes?.some((outcome) => outcome.effectsComplete !== true)) return;
    const writes = [...analysis.writes, ...(analysis.outcomes ?? []).flatMap((outcome) => outcome.fields)];
    for (const write of writes) {
      const field = { offset: write.offset, width: write.width };
      const key = `${field.offset}:${field.width}`;
      if (write.object === "part") ownFields.set(key, field);
      if (write.object === "part" || reached.test(write.object)) partFields.set(key, field);
      else if (record.test(write.object) || indexedRope.test(write.object)) recordFields.set(key, field);
      else if (write.object === "data") globals = true;
      else if (write.object !== "stack") return;
    }
  }
  return {
    partFields: [...partFields.values()],
    ownFields: [...ownFields.values()],
    recordFields: [...recordFields.values()],
    globals,
  };
}

/**
 * The query's summary with a bounded dispatch: callbacks may change the asked parts, and the part that asks only in
 * `askingFields`, what its own type's rope callback writes on it when a question comes back.
 */
export function ropeDispatchSummary(
  query: EngineSummary,
  writes: { partFields: Field[]; recordFields: Field[]; globals: boolean },
  callbacks: RoutineAnalysis[],
  askingArgument: number,
  askingFields: Field[] = writes.partFields,
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
      "Asks the part at the other end of each rope through its type's rope callback; those callbacks change only that part and its records, and a question that comes back changes the part that asks through its own callback.",
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
      askingFields,
    },
  };
}

/**
 * Bounds the rope connection query by what its rope callbacks at `targets` write, repeating the bound until it is
 * stable, since a callback that itself asks along a rope makes it recursive. Every round must classify every callback,
 * or the query keeps its unbounded summary. `asking` are the targets whose callbacks run on the part that asks, when
 * those are known. An analysis can record engine summaries worked out under the round's bound, so each round starts
 * from the engine summaries as they were before the first: only the accepted round's are kept, and none when no round
 * is accepted.
 */
export function settleRopeDispatch(
  query: EngineSummary,
  targets: number[],
  asking: number[] | undefined,
  summarise: (address: number) => RoutineAnalysis,
  engineSummaries: Map<number, EngineSummary>,
  helpers: EngineSummary[],
  /** Forgets the routine analyses of the round before. */
  clear: () => void,
): void {
  const engineBefore = [...engineSummaries],
    helpersBefore = [...helpers];
  const restore = (summary: EngineSummary) => {
    engineSummaries.clear();
    for (const [address, before] of engineBefore) engineSummaries.set(address, before);
    engineSummaries.set(query.address, summary);
    helpers.splice(0, helpers.length, ...helpersBefore);
  };
  const fieldsOf = (lists: RopeCallbackWrites[], pick: (fields: RopeCallbackWrites) => Field[]) => [
    ...new Map(lists.flatMap(pick).map((f) => [`${f.offset}:${f.width}`, f])).values(),
  ];
  const merge = (lists: RopeCallbackWrites[]): RopeCallbackWrites => ({
    partFields: fieldsOf(lists, (l) => l.partFields),
    ownFields: fieldsOf(lists, (l) => l.ownFields),
    recordFields: fieldsOf(lists, (l) => l.recordFields),
    globals: lists.some((l) => l.globals),
  });
  const key = (fields: RopeCallbackWrites) =>
    JSON.stringify(
      [fields.partFields, fields.ownFields, fields.recordFields].map((items) =>
        items.map((f) => `${f.offset}:${f.width}`).sort(),
      ),
    );
  // `ownFields` here holds what a question that comes back can change on the part that asks.
  let fields: RopeCallbackWrites = { partFields: [], ownFields: [], recordFields: [], globals: false };
  let bound = query,
    accepted = false;
  for (let round = 0; round < 5; round++) {
    restore(bound);
    clear();
    const analyses = targets.map((target) => summarise(target));
    const each = analyses.map((analysis) => ropeCallbackWrites([analysis]));
    const union = merge([fields, ...each.filter((item): item is RopeCallbackWrites => !!item)]);
    union.ownFields = asking
      ? fieldsOf([fields, ...asking.flatMap((at) => each[at] ?? [])], (l) => l.ownFields)
      : union.partFields;
    if (round > 0 && each.every(Boolean) && key(union) === key(fields)) {
      accepted = true;
      break;
    }
    fields = union;
    bound = ropeDispatchSummary(query, fields, analyses, 8, fields.ownFields);
  }
  if (!accepted) restore(query);
  const at = helpers.findIndex((helper) => helper.address === query.address);
  if (at >= 0) helpers[at] = engineSummaries.get(query.address)!;
}
