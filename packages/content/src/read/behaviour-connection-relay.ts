/**
 * Summaries of the helpers that move things along ropes, belts and pulleys, each checked against its complete
 * instruction graph. They say which fields of a rope, belt or pulley record and of a connected part a call may change,
 * so a caller can keep every other field instead of losing the whole part.
 */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Evidence, Expression } from "./behaviour.ts";
import {
  beltEndsPatterns,
  hitTestPatterns,
  ropeGeometryPatterns,
  ropeReversePatterns,
  searchPatterns,
} from "./behaviour-relay-patterns.ts";

type Field = { offset: number; width: number };
export interface ConnectionPatterns {
  ropeGeometry: string[];
  ropeReverse: string[];
  hitTest?: string[];
  search?: string[];
  beltEnds?: string[];
}
const PATTERNS: ConnectionPatterns = {
  ropeGeometry: ropeGeometryPatterns,
  ropeReverse: ropeReversePatterns,
  hitTest: hitTestPatterns,
  search: searchPatterns,
  beltEnds: beltEndsPatterns,
};

/** Part fields that point to rope, belt and pulley records: a belt at 0x54, ropes at 0x66 and 0x68. */
const RECORD_LINKS = [0x54, 0x66, 0x68];
const words = (...offsets: number[]): Field[] => offsets.map((offset) => ({ offset, width: 16 }));
const bytes = (...offsets: number[]): Field[] => offsets.map((offset) => ({ offset, width: 8 }));
const proof = (code: RoutineCode): Evidence[] =>
  code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));
const unknown = (reason: string, width: number): Expression => ({ kind: "unknown", reason, width });
const RECORDS =
  "Rope, belt and pulley records are allocations of their own, reached only through a part's link fields at 0x54, 0x66 and 0x68; they never overlap a part.";
const CHAINS =
  "A pulley chain and the parts list each end: a finite chain without cycles. The fields written are the same on every pass, so the count of passes does not change the footprint.";

function match(code: RoutineCode, patterns: string[]): Map<string, number> | undefined {
  if (code.status !== "complete") return undefined;
  for (const pattern of patterns) {
    const bound = matchHeapRoutine(code, pattern, new Map());
    if (bound) return bound;
  }
  return undefined;
}

/** A callee that changes no part and no record: only stack, and globals when `globals` allows. */
function inert(summary: EngineSummary | undefined, globals: boolean): boolean {
  return (
    !!summary &&
    summary.footprint.partMemoryComplete === true &&
    summary.footprint.preservesArgumentMemory === true &&
    summary.footprint.preservesPartState === true &&
    !summary.connected &&
    summary.writes.every((write) => write.root === "global") &&
    (globals || (summary.footprint.complete && !summary.footprint.unknownGlobalEffects?.length))
  );
}

/** A summary whose argument is a rope or belt record: its own fields are written, connected ones are named. */
function connection(
  code: RoutineCode,
  kind: string,
  purpose: string,
  argumentFields: Field[],
  partFields: Field[],
  recordFields: Field[],
  callees: EngineSummary[],
  globals: boolean,
): EngineSummary {
  const evidence = [...proof(code), ...callees.flatMap((callee) => callee.evidence)];
  const assumptions = [...new Set([RECORDS, CHAINS, ...callees.flatMap((callee) => callee.assumptions)])];
  const writes: EngineWrite[] = argumentFields.map((field) => ({
    confidence: "inferred",
    evidence: proof(code),
    assumptions: [RECORDS],
    root: "argument",
    argumentOffset: 6,
    path: [],
    offset: field.offset,
    width: field.width,
    value: unknown(`The ${kind} sets this record field from the connected parts' positions.`, field.width),
    condition: { kind: "unknown", reason: "The field is written on some paths through the routine." },
  }));
  return {
    confidence: "inferred",
    evidence,
    assumptions,
    address: code.address,
    kind,
    purpose,
    argumentOffset: 6,
    argumentKind: "object",
    writes: [...writes, ...unknownWrites(code, [...partFields, ...recordFields])],
    returns: [],
    calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: !globals,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: globals ? ["A called notification may queue screen rectangles in global storage."] : [],
      unknownPartEffects: [],
      unknownGlobalEffects: globals ? ["A called notification may queue screen rectangles in global storage."] : [],
    },
    connected: { confidence: "inferred", evidence, assumptions, partFields, recordFields, recordLinks: RECORD_LINKS },
  };
}

/**
 * Connected fields also as writes to an unknown object, so analyses that read only `writes` stay conservative: such a
 * write never counts as preserving a field.
 */
function unknownWrites(code: RoutineCode, fields: Field[]): EngineWrite[] {
  return fields.map((field) => ({
    confidence: "inferred",
    evidence: proof(code),
    assumptions: [RECORDS],
    root: "unknown",
    path: [],
    offset: field.offset,
    width: field.width,
    value: unknown("A part or record reached through a rope, belt or pulley may get a new value here.", field.width),
    condition: { kind: "unknown", reason: "The field is written on some paths through the routine." },
  }));
}

/** The distinct fields of several lists. */
const union = (...lists: Field[][]): Field[] => [
  ...new Map(lists.flat().map((field) => [`${field.offset}:${field.width}`, field])).values(),
];

/**
 * A routine whose own writes go only to records reached through a part's links, and whose calls are summarised:
 * it may write whatever those callees write. A callee that is passed a record writes that record's fields.
 */
function composite(
  code: RoutineCode,
  kind: string,
  purpose: string,
  argumentOffset: number,
  ownRecordFields: Field[],
  connected: EngineSummary[],
  recordArguments: EngineSummary[],
): EngineSummary {
  const callees = [...connected, ...recordArguments];
  const evidence = [...proof(code), ...callees.flatMap((callee) => callee.evidence)];
  const assumptions = [...new Set([RECORDS, CHAINS, ...callees.flatMap((callee) => callee.assumptions)])];
  const globals = callees.some((callee) => callee.footprint.unknownGlobalEffects?.length);
  const note = "A called notification may queue screen rectangles in global storage.";
  const partFields = union(...callees.map((callee) => callee.connected?.partFields ?? []));
  const recordFields = union(
    ownRecordFields,
    ...callees.map((callee) => callee.connected?.recordFields ?? []),
    ...recordArguments.map((callee) => callee.writes.filter((write) => write.root === "argument")),
  ).map(({ offset, width }) => ({ offset, width }));
  return {
    confidence: "inferred",
    evidence,
    assumptions,
    address: code.address,
    kind,
    purpose,
    argumentOffset,
    argumentKind: "object",
    writes: unknownWrites(code, [...partFields, ...recordFields]),
    returns: [],
    calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: !globals,
      partMemoryComplete: true,
      // A reached pulley can be the argument part itself.
      preservesArgumentMemory: partFields.length === 0,
      preservesPartState: true,
      unknownEffects: globals ? [note] : [],
      unknownPartEffects: [],
      unknownGlobalEffects: globals ? [note] : [],
    },
    connected: {
      confidence: "inferred",
      evidence,
      assumptions,
      partFields,
      recordFields,
      recordLinks: RECORD_LINKS,
    },
  };
}

/** Adds the rope helpers' summaries when their complete instruction graphs and callees are proved. */
export function addConnectionSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  patterns: ConnectionPatterns = PATTERNS,
): void {
  for (const code of codes.values()) {
    const geometry = match(code, patterns.ropeGeometry);
    if (geometry) {
      const point = summaries.get(geometry.get("ropePoint")!);
      if (inert(point, false))
        summaries.set(
          code.address,
          connection(
            code,
            "rope-geometry",
            "Places a rope's ends from its parts and pulleys, updates each pulley's rope record and the end words of the rope's first part.",
            words(0x14, 0x16, 0x18, 0x1a),
            words(0x96, 0x9c),
            words(0x14, 0x16),
            [point!],
            false,
          ),
        );
    }
    const reverse = match(code, patterns.ropeReverse);
    if (reverse) {
      const notify = summaries.get(reverse.get("notify")!);
      if (inert(notify, true))
        summaries.set(
          code.address,
          connection(
            code,
            "rope-reversal",
            "Turns a rope around: swaps the links and rope records of every pulley on it, then the rope's own ends, and notifies its first part.",
            [...words(0x02, 0x04, 0x06, 0x08), ...bytes(0x0a, 0x0b, 0x0c, 0x0d)],
            words(0x5a, 0x5c, 0x5e, 0x60, 0x6a, 0x6c),
            words(0x14, 0x16, 0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a),
            [notify!],
            true,
          ),
        );
    }
  }
  const of = (bound: Map<string, number>, name: string, kind?: string) => {
    const summary = summaries.get(bound.get(name)!);
    return kind === undefined || summary?.kind === kind ? summary : undefined;
  };
  for (const code of codes.values()) {
    const bound = patterns.hitTest && match(code, patterns.hitTest);
    const reverse = bound && of(bound, "ropeReverse", "rope-reversal");
    if (reverse)
      summaries.set(
        code.address,
        composite(
          code,
          "part-hit-test",
          "Tests whether a point hits a part, its belt end or a rope end; it can swap the belt's ends or turn a rope around.",
          8,
          words(0x04, 0x06),
          [],
          [reverse],
        ),
      );
  }
  for (const code of codes.values()) {
    const bound = patterns.search && match(code, patterns.search);
    const hit = bound && of(bound, "hitTest", "part-hit-test");
    if (bound && hit && inert(of(bound, "listHead"), false) && inert(of(bound, "listNext"), false))
      summaries.set(
        code.address,
        composite(
          code,
          "part-hit-search",
          "Walks the parts lists and hit-tests each part until one is hit.",
          6,
          [],
          [hit],
          [],
        ),
      );
  }
  for (const code of codes.values()) {
    const bound = patterns.beltEnds && match(code, patterns.beltEnds);
    const search = bound && of(bound, "search", "part-hit-search");
    if (bound && search && inert(of(bound, "pointCheck"), false))
      summaries.set(
        code.address,
        composite(
          code,
          "belt-end-check",
          "Checks a belt's two ends, searching the parts lists for an end that is missing.",
          6,
          [],
          [search],
          [],
        ),
      );
  }
}
