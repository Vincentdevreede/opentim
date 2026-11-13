/**
 * The rope cut the scissors make: it walks the parts list for ropes, tests each against the cutting edge, and splits a
 * rope it crosses into two, with new rope pieces from the part factory. Checked against its complete instruction graph,
 * its summary says which fields of existing parts and rope records a cut can change, so the scissors keep their state.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import { inert } from "./behaviour-connection-relay.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import { discoverConstructorCleanup } from "./behaviour-owned-constructors.ts";
import { PART_SIZE, RELEASED_FIELDS } from "./behaviour-part-copy.ts";
import { ropeCutPatterns } from "./behaviour-rope-cut-patterns.ts";
import { matchFirst, outsideStores, routineEvidence, wordFields } from "./behaviour-terms.ts";

type Field = { offset: number; width: number };

/** Part fields that point to rope, belt and pulley records: a belt at 0x54, ropes at 0x66 and 0x68. */
const RECORD_LINKS = [0x54, 0x66, 0x68];
export const ROPE_CUT_ASSUMPTIONS = [
  "A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or other storage, and releasing a piece that was never linked changes nothing else.",
  "A rope end's slot number, in bytes 0x0a and 0x0b of its rope record, is 0 or 1: one of the part's two rope links.",
  "Rope, belt and pulley records are allocations of their own, reached only through a part's link fields at 0x54, 0x66 and 0x68; they never overlap a part.",
  "The parts list and a pulley chain each end: a finite chain without cycles. The fields written are the same on every pass.",
];
/** The links of an existing part the cut rewrites: its rope records and the neighbours on the rope. */
const PART_LINKS = wordFields(0x5a, 0x5c, 0x66, 0x68);
/** The fields of the cut rope's own record: its far end, its slot byte and its two end points. */
const RECORD_FIELDS: Field[] = [
  ...wordFields(0x04, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a),
  { offset: 0x0b, width: 8 },
];

const union = (...lists: Field[][]): Field[] => [
  ...new Map(lists.flat().map(({ offset, width }) => [`${offset}:${width}`, { offset, width }])).values(),
];

/** Adds the rope cut's summary where its graph matches and its callees have the summaries the proof needs. */
export function addRopeCutSummary(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  patterns: string[] = ropeCutPatterns,
): void {
  for (const code of codes.values()) {
    const bound = matchFirst(code, patterns);
    if (!bound) continue;
    const of = (name: string, kind: string) => {
      const summary = summaries.get(bound.get(name)!);
      return summary?.kind === kind ? summary : undefined;
    };
    const segments = of("segments", "argument-buffer-update");
    const factory = of("factory", "part-factory");
    const insert = of("insert", "ordered-part-insertion");
    const shift = of("shift", "wide-integer-shift");
    const position = of("position", "frame-position");
    const geometry = of("ropeGeometry", "rope-geometry");
    if (!segments || !factory?.factory || !insert || !shift || !position || !geometry?.connected) continue;
    // The wrapper is given the part that holds the rope record, so it may write no part or record at all.
    const wrapper = summaries.get(bound.get("wrapper")!);
    if (!inert(wrapper, true)) continue;
    // The position helper is given a new rope piece and may write only that piece.
    if (!position.footprint.complete || !position.footprint.preservesPartState) continue;
    if (!position.writes.every((write) => write.root === "argument" && write.path.length === 0)) continue;
    // The rope end pieces (type 49) are made by a constructor that is proved, or by none.
    const { noConstructorTypes, alwaysSuccessfulConstructors = [], ownedConstructors = [] } = factory.factory;
    const ends = [...alwaysSuccessfulConstructors, ...ownedConstructors].find((ctor) => ctor.type === 49);
    if (!noConstructorTypes.includes(49) && !ends) continue;
    // No check proves the rope's own constructor (type 10) yet, so that its new record at 0x66 is fresh rests on the
    // first assumption.
    // The release frees a new piece's outline, belt and rope records, each only when set, and then the piece.
    const releaseCode = codes.get(bound.get("release")!);
    const cleanup = releaseCode && discoverConstructorCleanup(releaseCode, PART_SIZE);
    if (!cleanup || cleanup.releaseFields.some((field, n) => field !== RELEASED_FIELDS[n])) continue;
    // The insertion links a new piece between two existing neighbours, whose list links it rewrites.
    const neighbours = insert.writes.filter((write) => write.path.length > 0);
    const partFields = union(PART_LINKS, neighbours, geometry.connected.partFields);
    const recordFields = union(
      RECORD_FIELDS,
      geometry.connected.recordFields,
      geometry.writes.filter((write) => write.root === "argument"),
    );
    const callees = [segments, factory, insert, shift, position, geometry, wrapper!];
    const evidence = [
      ...routineEvidence(code),
      ...callees.flatMap((callee) => callee.evidence),
      ...(ends?.evidence ?? []),
      ...cleanup.evidence,
    ];
    const assumptions = [
      ...new Set([
        ...ROPE_CUT_ASSUMPTIONS,
        ...geometry.assumptions,
        ...insert.assumptions,
        ...(ends?.assumptions ?? []),
      ]),
    ];
    const note = "The cut saves and restores a global word, and the list insertion can change a global list head.";
    const unknownWrites: EngineWrite[] = [...partFields, ...recordFields].map((field) => ({
      confidence: "inferred",
      evidence: outsideStores(code),
      assumptions: ROPE_CUT_ASSUMPTIONS,
      root: "unknown",
      path: [],
      offset: field.offset,
      width: field.width,
      value: {
        kind: "unknown",
        reason: "Cutting a rope may relink a part or rope record here.",
        width: field.width,
      },
      condition: { kind: "unknown", reason: "The field is written when a rope crosses the cutting edge." },
    }));
    summaries.set(code.address, {
      confidence: "inferred",
      evidence,
      assumptions,
      address: code.address,
      kind: "rope-cut",
      // Most forms stop after the first cut; three go on along the parts list and cut every rope that crosses.
      purpose:
        "Cuts a rope that crosses the given edge in two (in some builds every rope that crosses it), with new rope pieces, and relinks the parts and pulleys on it.",
      argumentOffset: 6,
      argumentKind: "object",
      writes: unknownWrites,
      returns: [],
      calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: false,
        partMemoryComplete: true,
        // The scissors can themselves be a part on a cut rope or a list neighbour.
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: [note],
        unknownPartEffects: [],
        unknownGlobalEffects: [note],
      },
      connected: {
        confidence: "inferred",
        evidence: outsideStores(code),
        assumptions,
        partFields,
        recordFields,
        recordLinks: RECORD_LINKS,
      },
    });
  }
}
