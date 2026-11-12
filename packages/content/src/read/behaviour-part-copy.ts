/**
 * The part copy: it allocates a new part, copies the source part's fields into it, gives the copy belt, rope and
 * outline records of its own, and returns the copy, or zero after releasing it when an allocation fails. The explosion
 * uses it to split a brick or wood wall. Checked against its complete instruction graph, its summary says it changes
 * no existing part or record, so a caller keeps every field it knew.
 */
import { discoverConstructorCleanup } from "./behaviour-owned-constructors.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { partCopyPatterns } from "./behaviour-part-copy-patterns.ts";
import { routineEvidence } from "./behaviour-terms.ts";

export const PART_COPY_ASSUMPTIONS = [
  "A part copy gets fresh memory, and so do the belt, rope and outline records it makes for the copy: none of it overlaps an existing part, a rope, belt or pulley record or other storage.",
  "Releasing a copy that was never linked, after one of its allocations failed, frees only the copy and the records it made for it, and changes nothing else.",
];
/** The size of a part, the block the copy allocates for itself. */
export const PART_SIZE = 0xa2;
/** The fields of the copy its release frees: the outline buffer, the belt record and the rope record. */
export const RELEASED_FIELDS = [0x82, 0x54, 0x66];

/** Adds the part copy's summary where its graph matches and its allocator and release are the ones the proof needs. */
export function addPartCopySummary(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  patterns: string[] = partCopyPatterns,
): void {
  for (const code of codes.values()) {
    if (code.status !== "complete") continue;
    const bound = patterns.map((pattern) => matchHeapRoutine(code, pattern, new Map())).find((b) => b);
    if (!bound) continue;
    const allocate = summaries.get(bound.get("allocate")!);
    if (allocate?.kind !== "nullable-allocation" || allocate.returnPointerClass !== "nullable-fresh") continue;
    if (!allocate.clearsAllocation) continue;
    // The release frees the copy's outline, belt and rope records, each only when set, and then the copy. The copy
    // sets them only from its own allocations, and the zero filled block holds zero in the others. That the release
    // changes nothing else is the second assumption.
    const releaseCode = codes.get(bound.get("release")!);
    const cleanup = releaseCode && discoverConstructorCleanup(releaseCode, PART_SIZE);
    if (!cleanup || cleanup.releaseFields.some((field, n) => field !== RELEASED_FIELDS[n])) continue;
    const evidence = [...routineEvidence(code), ...allocate.evidence, ...cleanup.evidence];
    const assumptions = [...new Set([...PART_COPY_ASSUMPTIONS, ...allocate.assumptions])];
    const note = "Allocating and releasing change the heap's own records and globals.";
    summaries.set(code.address, {
      confidence: "inferred",
      evidence,
      assumptions,
      address: code.address,
      kind: "part-copy",
      purpose:
        "Copies a part into fresh memory, with belt, rope and outline records of its own, and returns the copy or zero.",
      argumentOffset: 6,
      argumentKind: "object",
      writes: [],
      returns: [
        {
          confidence: "inferred",
          evidence: routineEvidence(code).filter((i) => i.text.startsWith("mov ax, si")),
          assumptions: PART_COPY_ASSUMPTIONS,
          register: "ax",
          value: { kind: "unknown", reason: "The copy's address is determined by the heap.", width: 16 },
          condition: { kind: "unknown", reason: "Every allocation of the copy succeeded." },
          pointer: { kind: "fresh", name: "copy of a part" },
        },
        {
          confidence: "inferred",
          evidence: routineEvidence(code).filter((i) => i.text.startsWith("xor ax, ax")),
          assumptions: [],
          register: "ax",
          value: { kind: "constant", value: 0, width: 16 },
          condition: { kind: "unknown", reason: "An allocation failed and the copy was released." },
          pointer: { kind: "constant", value: 0 },
        },
      ],
      returnPointerClass: "nullable-fresh",
      calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: false,
        partMemoryComplete: true,
        // The source part is only read.
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [note],
        unknownPartEffects: [],
        unknownGlobalEffects: [note],
      },
    });
  }
}
