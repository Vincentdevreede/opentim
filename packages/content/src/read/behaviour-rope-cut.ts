/**
 * The rope cut the scissors make: it walks the parts list for ropes, tests each against the cutting edge, and splits a
 * rope it crosses into two, with new rope pieces from the part factory. Checked against its complete instruction graph,
 * its summary says which fields of existing parts and rope records a cut can change, so the scissors keep their state.
 */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Evidence } from "./behaviour.ts";
import { ropeCutPatterns } from "./behaviour-rope-cut-patterns.ts";

type Field = { offset: number; width: number };
const words = (...offsets: number[]): Field[] => offsets.map((offset) => ({ offset, width: 16 }));

/** Part fields that point to rope, belt and pulley records: a belt at 0x54, ropes at 0x66 and 0x68. */
const RECORD_LINKS = [0x54, 0x66, 0x68];
export const ROPE_CUT_ASSUMPTIONS = [
  "A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or other storage, and releasing a piece that was never linked changes nothing else.",
  "A rope end's slot number, in bytes 0x0a and 0x0b of its rope record, is 0 or 1: one of the part's two rope links.",
  "Rope, belt and pulley records are allocations of their own, reached only through a part's link fields at 0x54, 0x66 and 0x68; they never overlap a part.",
  "The parts list and a pulley chain each end: a finite chain without cycles. The fields written are the same on every pass.",
];
/** The links of an existing part the cut rewrites: its rope records and the neighbours on the rope. */
const PART_LINKS = words(0x5a, 0x5c, 0x66, 0x68);
/** The fields of the cut rope's own record: its far end, its slot byte and its two end points. */
const RECORD_FIELDS: Field[] = [
  ...words(0x04, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a),
  { offset: 0x0b, width: 8 },
];

const proof = (code: RoutineCode): Evidence[] =>
  code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));
const union = (...lists: Field[][]): Field[] => [
  ...new Map(lists.flat().map(({ offset, width }) => [`${offset}:${width}`, { offset, width }])).values(),
];

/**
 * The instructions that store to memory outside the stack frame: the compact evidence a caller's findings carry. The
 * summary itself keeps the whole routine.
 */
const stores = (code: RoutineCode): Evidence[] =>
  code.instructions
    .filter(
      (i) =>
        i.flow === "next" &&
        !["cmp", "test", "push"].includes(i.mnemonic) &&
        i.operands[0]?.kind === "memory" &&
        !(i.operands[0].segment === "ss" && i.operands[0].base.join() === "bp"),
    )
    .map(({ address, bytes, text }) => ({ address, bytes, text }));

function match(code: RoutineCode, patterns: string[]): Map<string, number> | undefined {
  if (code.status !== "complete") return undefined;
  for (const pattern of patterns) {
    const bound = matchHeapRoutine(code, pattern, new Map());
    if (bound) return bound;
  }
  return undefined;
}

/** Adds the rope cut's summary where its graph matches and its callees have the summaries the proof needs. */
export function addRopeCutSummary(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  patterns: string[] = ropeCutPatterns,
): void {
  for (const code of codes.values()) {
    const bound = match(code, patterns);
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
    const wrapper = summaries.get(bound.get("wrapper")!);
    if (!segments || !factory || !insert || !shift || !position || !geometry?.connected || !wrapper) continue;
    if (!wrapper.footprint.partMemoryComplete || !wrapper.footprint.preservesPartState || wrapper.connected) continue;
    // The insertion links a new piece between two existing neighbours, whose list links it rewrites.
    const neighbours = insert.writes.filter((write) => write.path.length > 0);
    const partFields = union(PART_LINKS, neighbours, geometry.connected.partFields);
    const recordFields = union(
      RECORD_FIELDS,
      geometry.connected.recordFields,
      geometry.writes.filter((write) => write.root === "argument"),
    );
    const callees = [segments, factory, insert, shift, position, geometry, wrapper];
    const evidence = [...proof(code), ...callees.flatMap((callee) => callee.evidence)];
    const assumptions = [...new Set([...ROPE_CUT_ASSUMPTIONS, ...geometry.assumptions, ...insert.assumptions])];
    const note = "The cut saves and restores a global word, and the list insertion can change a global list head.";
    const unknownWrites: EngineWrite[] = [...partFields, ...recordFields].map((field) => ({
      confidence: "inferred",
      evidence: stores(code),
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
      purpose:
        "Cuts every rope that crosses the given edge in two, with new rope pieces, and relinks the parts and pulleys on it.",
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
        evidence: stores(code),
        assumptions,
        partFields,
        recordFields,
        recordLinks: RECORD_LINKS,
      },
    });
  }
}
