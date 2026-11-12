/**
 * Summaries of the helpers that move things along ropes, belts and pulleys, each checked against its complete
 * instruction graph. They say which fields of a rope, belt or pulley record and of a connected part a call may change,
 * so a caller can keep every other field instead of losing the whole part.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Expression } from "./behaviour.ts";
import {
  beltEndsPatterns,
  hitTestPatterns,
  relayPatterns,
  ropeGeometryPatterns,
  ropeReversePatterns,
  searchPatterns,
} from "./behaviour-relay-patterns.ts";
import { matchFirst, routineEvidence, wordFields } from "./behaviour-terms.ts";

type Field = { offset: number; width: number };
export interface ConnectionPatterns {
  ropeGeometry: string[];
  ropeReverse: string[];
  hitTest?: string[];
  search?: string[];
  beltEnds?: string[];
  relay?: string[];
}
const PATTERNS: ConnectionPatterns = {
  ropeGeometry: ropeGeometryPatterns,
  ropeReverse: ropeReversePatterns,
  hitTest: hitTestPatterns,
  search: searchPatterns,
  beltEnds: beltEndsPatterns,
  relay: relayPatterns,
};

/**
 * Decided assumption 19. A rope record's slot 0 is the part that holds it; only the level loader, the rope's and the
 * pulley's constructors and the part copy store it, and the copy only for those two types. The loader takes it from
 * the file for any type, but every shipped level gives a rope record only to ropes and pulleys.
 */
export const ROPE_HOLDER_ASSUMPTION =
  "Only a rope piece or a pulley ever holds a rope record (slot 0 of a record at 0x66 or 0x68), so the rope geometry update never writes the rope ends 0x96 and 0x9c of a part of another type. Every rope the game makes and every shipped level says so; only a level file made outside the game could break it.";
/**
 * Decided assumption 20. The byte relay checks its owner's belt with the belt end check while `[0x4a6d]` is `0x1000`,
 * and that check searches for a part, and may turn a rope round, only when one end of the belt is loose. The relay is
 * called only from flip callbacks, which the editor calls when the player flips a part.
 */
export const FLIP_BELT_ASSUMPTION =
  "In the editor a part is never flipped while one end of its belt is still loose (as while the player drags the belt's end), so the byte relay a flip callback makes never changes the rope and belt links 0x5a to 0x60, 0x6a and 0x6c through its belt end check. This is about flipping in the editor only, not about the machine running.";

/** Part fields that point to rope, belt and pulley records: a belt at 0x54, ropes at 0x66 and 0x68. */
const RECORD_LINKS = [0x54, 0x66, 0x68];
const bytes = (...offsets: number[]): Field[] => offsets.map((offset) => ({ offset, width: 8 }));
const unknown = (reason: string, width: number): Expression => ({ kind: "unknown", reason, width });
const RECORDS =
  "Rope, belt and pulley records are allocations of their own, reached only through a part's link fields at 0x54, 0x66 and 0x68; they never overlap a part.";
const CHAINS =
  "A pulley chain and the parts list each end: a finite chain without cycles. The fields written are the same on every pass, so the count of passes does not change the footprint.";

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
  const evidence = [...routineEvidence(code), ...callees.flatMap((callee) => callee.evidence)];
  const assumptions = [...new Set([RECORDS, CHAINS, ...callees.flatMap((callee) => callee.assumptions)])];
  const writes: EngineWrite[] = argumentFields.map((field) => ({
    confidence: "inferred",
    evidence: routineEvidence(code),
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
    evidence: routineEvidence(code),
    assumptions: [RECORDS],
    root: "unknown",
    path: [],
    offset: field.offset,
    width: field.width,
    value: unknown("A part or record reached through a rope, belt or pulley may get a new value here.", field.width),
    condition: { kind: "unknown", reason: "The field is written on some paths through the routine." },
  }));
}

const overlaps = (a: Field, b: Field) => a.offset < b.offset + b.width / 8 && b.offset < a.offset + a.width / 8;

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
  ownPartFields: Field[] = [],
  argumentWrites: EngineWrite[] = [],
): EngineSummary {
  const callees = [...connected, ...recordArguments];
  const evidence = [...routineEvidence(code), ...callees.flatMap((callee) => callee.evidence)];
  const assumptions = [...new Set([RECORDS, CHAINS, ...callees.flatMap((callee) => callee.assumptions)])];
  const globals = callees.some((callee) => callee.footprint.unknownGlobalEffects?.length);
  const note = "A called notification may queue screen rectangles in global storage.";
  const partFields = union(ownPartFields, ...callees.map((callee) => callee.connected?.partFields ?? []));
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
    writes: [...argumentWrites, ...unknownWrites(code, [...partFields, ...recordFields])],
    returns: [],
    calls: code.calls.flatMap((call) => (call.target ? [call.target.address] : [])),
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: !globals,
      partMemoryComplete: true,
      // A reached pulley can be the argument part itself.
      preservesArgumentMemory: partFields.length === 0 && argumentWrites.length === 0,
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
    const geometry = matchFirst(code, patterns.ropeGeometry);
    if (geometry) {
      const point = summaries.get(geometry.get("ropePoint")!);
      if (inert(point, false))
        summaries.set(
          code.address,
          connection(
            code,
            "rope-geometry",
            "Places a rope's ends from its parts and pulleys, updates each pulley's rope record and the end words of the rope's first part.",
            wordFields(0x14, 0x16, 0x18, 0x1a),
            wordFields(0x96, 0x9c),
            // Each pulley's loop runs twice, writing words 0x14 and 0x16 of its rope record, then 0x18 and 0x1a.
            wordFields(0x14, 0x16, 0x18, 0x1a),
            [point!],
            false,
          ),
        );
    }
    const reverse = matchFirst(code, patterns.ropeReverse);
    if (reverse) {
      const notify = summaries.get(reverse.get("notify")!);
      if (inert(notify, true))
        summaries.set(
          code.address,
          connection(
            code,
            "rope-reversal",
            "Turns a rope around: swaps the links and rope records of every pulley on it, then the rope's own ends, and notifies its first part.",
            [...wordFields(0x02, 0x04, 0x06, 0x08), ...bytes(0x0a, 0x0b, 0x0c, 0x0d)],
            wordFields(0x5a, 0x5c, 0x5e, 0x60, 0x6a, 0x6c),
            wordFields(0x14, 0x16, 0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a),
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
    const bound = patterns.hitTest && matchFirst(code, patterns.hitTest);
    const reverse = bound && of(bound, "ropeReverse", "rope-reversal");
    if (reverse)
      summaries.set(
        code.address,
        composite(
          code,
          "part-hit-test",
          "Tests whether a point hits a part, its belt end or a rope end; it can swap the belt's ends or turn a rope around.",
          8,
          wordFields(0x04, 0x06),
          [],
          [reverse],
        ),
      );
  }
  for (const code of codes.values()) {
    const bound = patterns.search && matchFirst(code, patterns.search);
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
    const bound = patterns.beltEnds && matchFirst(code, patterns.beltEnds);
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
  for (const code of codes.values()) {
    const bound = patterns.relay && matchFirst(code, patterns.relay);
    if (!bound) continue;
    const geometry = of(bound, "ropeGeometry", "rope-geometry");
    const ends = of(bound, "beltEnds", "belt-end-check");
    // The belt geometry update only writes its argument, the belt record.
    const belt = of(bound, "beltGeometry");
    const beltRecord =
      !!belt &&
      belt.footprint.partMemoryComplete === true &&
      !belt.connected &&
      belt.writes.length > 0 &&
      belt.writes.every((write) => write.root === "argument" && !write.path.length);
    if (!geometry || !ends || !belt || !beltRecord) continue;
    const byte: Expression = { kind: "field", object: "argument", offset: 8, width: 8 };
    // The owner gets the byte first, unless its type (field 0x04) is 49, the number the pattern matches.
    const owner: EngineWrite = {
      confidence: "inferred",
      evidence: routineEvidence(code),
      assumptions: [],
      root: "argument",
      argumentOffset: 6,
      path: [],
      offset: 0x14,
      width: 8,
      value: byte,
      condition: {
        kind: "compare",
        operator: "!=",
        left: { kind: "field", object: "part", offset: 4, width: 16 },
        right: { kind: "constant", value: 49, width: 16 },
        signed: false,
      },
      exact: true,
    };
    const summary = composite(
      code,
      "related-byte-propagation",
      "Copies the caller's byte to the owner and to the parts at the other end of its belt and ropes, updating the belt and rope geometry on the way.",
      6,
      [],
      [ends],
      [belt, geometry],
      [{ offset: 0x14, width: 8 }],
      [owner],
    );
    // Every store to 0x14 in the relay copies the byte, and no callee writes 0x14 of any part: a part the relay reaches
    // keeps its 0x14 or gets the byte. That part may be the owner, which already holds the byte unless it is of type
    // 49, so the owner's field ends as the byte too.
    // The records the callees write are separate allocations; the part fields they may write are listed.
    const touches = (fields: Field[] = []) =>
      fields.some((field) => field.offset <= 0x14 && 0x14 < field.offset + field.width / 8);
    if (![ends, belt, geometry].some((callee) => touches(callee.connected?.partFields)))
      summary.connected!.values = [{ offset: 0x14, width: 8, value: byte }];
    // Which callee alone writes a part field: the rope geometry update writes only the part that holds a rope record,
    // and the belt end check only acts on a belt with a loose end. The callers' decided assumptions use these.
    const only = (fields: Field[] = [], others: Field[]) =>
      fields.filter((field) => !others.some((other) => overlaps(field, other)));
    summary.connected!.ropeHolderFields = only(geometry.connected?.partFields, [
      { offset: 0x14, width: 8 },
      ...(ends.connected?.partFields ?? []),
    ]);
    summary.connected!.beltEndFields = only(ends.connected?.partFields, [
      { offset: 0x14, width: 8 },
      ...(geometry.connected?.partFields ?? []),
    ]);
    summaries.set(code.address, summary);
  }
}
