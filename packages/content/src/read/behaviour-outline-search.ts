/**
 * The outline search: it clears the owner's found list, walks the parts lists the caller's mask allows, tests each
 * edge of every part's outline against a shape the caller gives, and puts each part with a crossing edge at the front
 * of the found list. Checked against its complete instruction graph. Unlike the other overlap queries it does not
 * skip the owner, so its list may hold the owner itself.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import { outlineSearchPatterns } from "./behaviour-outline-search-patterns.ts";
import { matchFirst, outsideStores, routineEvidence } from "./behaviour-terms.ts";

/** The found list's head on the owner and its link on each listed part. */
const FOUND = 0x78;
export const OUTLINE_SEARCH_ASSUMPTIONS = [
  "The parts lists are finite and without cycles, and each part is on them once, so each part is put on the found list at most once.",
  "The search may list the owner itself: it does not skip it.",
];

/** A callee that only reads: no part, record or global write. */
const reads = (summary: EngineSummary | undefined) =>
  !!summary &&
  summary.footprint.complete &&
  summary.footprint.partMemoryComplete === true &&
  summary.footprint.preservesArgumentMemory === true &&
  summary.writes.length === 0 &&
  !summary.connected;

/** Adds the outline search's summary where its graph matches and its callees are proved. */
export function addOutlineSearchSummary(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  patterns: string[] = outlineSearchPatterns,
): void {
  for (const code of codes.values()) {
    const bound = matchFirst(code, patterns);
    if (!bound) continue;
    const head = summaries.get(bound.get("listHead")!);
    const next = summaries.get(bound.get("listNext")!);
    const segments = summaries.get(bound.get("segments")!);
    if (head?.kind !== "list-head" || next?.kind !== "list-next" || !reads(head) || !reads(next)) continue;
    if (segments?.kind !== "argument-buffer-update" || !segments.footprint.partMemoryComplete) continue;
    const evidence = [...routineEvidence(code), ...head.evidence, ...next.evidence, ...segments.evidence];
    const assumptions = [...new Set([...OUTLINE_SEARCH_ASSUMPTIONS, ...head.assumptions, ...next.assumptions])];
    const link = (root: "argument" | "unknown"): EngineWrite => ({
      confidence: "inferred",
      evidence: outsideStores(code),
      assumptions: OUTLINE_SEARCH_ASSUMPTIONS,
      root,
      ...(root === "unknown" ? { selection: "overlap-candidate" as const } : {}),
      argumentOffset: 6,
      path: [],
      offset: FOUND,
      width: 16,
      value: { kind: "unknown", reason: "The search links a part whose outline crosses the shape.", width: 16 },
      condition: {
        kind: "unknown",
        reason: "The part must pass the mask and have an outline edge crossing the shape.",
      },
    });
    summaries.set(code.address, {
      confidence: "inferred",
      evidence,
      assumptions,
      address: code.address,
      kind: "overlap-list",
      purpose: "Builds a linked list of the parts, the owner included, with an outline edge crossing the given shape.",
      argumentOffset: 6,
      argumentKind: "object",
      writes: [link("argument"), link("unknown")],
      returns: [],
      calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: [],
        unknownPartEffects: [],
        unknownGlobalEffects: [],
      },
      list: {
        headField: FOUND,
        nextField: FOUND,
        excludesArgument: false,
        confidence: "checked",
        evidence: outsideStores(code),
        // It tests no flag of the parts it walks, only their outline.
        memberTests: [],
        assumptions: [
          "The list describes the parts accepted during this search; later writes can change it. A finite acyclic traversal requires a separate list invariant.",
        ],
      },
    });
  }
}
