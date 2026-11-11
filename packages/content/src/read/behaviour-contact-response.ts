/** Exact small response contracts, without supplying contacts or running the response callbacks. */
import { clampPatterns, soundPatterns } from "./behaviour-response-patterns.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Expression, Finding, Predicate } from "./behaviour.ts";
import { binary, constant, partField, routineEvidence } from "./behaviour-terms.ts";

export type ContactResponse =
  | {
      kind: "velocity-limit";
      ownerArgument: 6;
      typeField: 4;
      fields: [56, 54];
      table: { segment: number; offset: number; stride: 58; limitField: 10; typeCount: number };
      cases: { field: number; condition: Predicate; value: Expression }[];
      order: "verticalThenHorizontal";
      comparisons: "signedWordsUpperBranchFirst";
      tableReads: "runtime";
    }
  | {
      kind: "contact-resource-request";
      ownerArgument: 6;
      typeField: 4;
      requiredType: 0;
      velocityFields: [54, 56];
      condition: Predicate;
      resource: 20;
      service: number;
      arithmetic: "wrappedWordAbsoluteValuesAndSumThenSignedComparison";
      audiblePlaybackEstablished: false;
    };
const compare = (operator: string, left: Expression, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: true,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });

export function discoverContactResponse(
  code: RoutineCode,
  summaries: Map<number, EngineSummary>,
  table: number | undefined,
  dataSegment: number,
  typeCount: number | undefined,
  imageLength: number,
): EngineSummary | undefined {
  const finding: Finding = {
    confidence: "inferred",
    evidence: routineEvidence(code),
    assumptions: [
      "The far C call receives a complete nonwrapping part at BP+6. Its storage is separate from the private stack; DS and the C preserved registers retain their calling-convention meanings.",
    ],
  };
  const base = {
    ...finding,
    address: code.address,
    argumentOffset: 6,
    argumentKind: "object" as const,
    writes: [] as EngineWrite[],
    returns: [],
    calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
    returnConvention: { kind: "far" as const, stackBytes: 0 },
  };
  for (const pattern of clampPatterns) {
    const binding = matchHeapRoutine(code, pattern, new Map());
    if (!binding || table === undefined || typeCount === undefined || !Number.isInteger(typeCount) || typeCount <= 0)
      continue;
    const segment = binding.get("tableSegment") ?? dataSegment;
    const offset = binding.get("tableOffset")!;
    if (
      segment * 16 + offset !== table ||
      offset < 0 ||
      offset + typeCount * 58 > 65536 ||
      table + typeCount * 58 > imageLength
    )
      continue;
    const limit: Expression = {
      kind: "table",
      segment,
      offset: offset + 10,
      index: binary("*", partField(4), constant(58)),
      width: 16,
    };
    const negative = binary("-", constant(0), limit);
    const cases = [56, 54].flatMap((offset) => [
      { field: offset, condition: compare(">", partField(offset), limit), value: limit },
      {
        field: offset,
        condition: and(compare("<=", partField(offset), limit), compare("<", partField(offset), negative)),
        value: negative,
      },
    ]);
    const assumptions = [
      ...finding.assumptions,
      "The runtime type selects a valid record in the discovered 58-byte table. Table storage and the part are separate and stable during this call; the limit is read at runtime, not replaced by an imported constant.",
      "All comparisons are signed words and negation wraps to 16 bits. The upper test has priority, including when the record contains a negative limit. No nonnegative-limit assumption is required.",
      "If neither write condition holds, the velocity field retains its input. This contract leaves volatile return registers unspecified.",
    ];
    return {
      ...base,
      kind: "contact-velocity-limit",
      assumptions,
      purpose:
        "Limits vertical and then horizontal velocity using the signed limit in the part type's record, leaving the state unchanged.",
      writes: cases.map((c) => ({
        ...finding,
        assumptions,
        root: "argument",
        argumentOffset: 6,
        path: [],
        offset: c.field,
        width: 16,
        value: c.value,
        condition: c.condition,
      })),
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: [],
        unknownPartEffects: [],
        unknownGlobalEffects: [],
      },
      contactResponse: {
        kind: "velocity-limit",
        ownerArgument: 6,
        typeField: 4,
        fields: [56, 54],
        table: { segment, offset, stride: 58, limitField: 10, typeCount },
        cases,
        order: "verticalThenHorizontal",
        comparisons: "signedWordsUpperBranchFirst",
        tableReads: "runtime",
      },
    };
  }
  for (const pattern of soundPatterns) {
    const binding = matchHeapRoutine(code, pattern, new Map());
    if (!binding) continue;
    const service = summaries.get(binding.get("sound")!);
    if (
      service?.kind !== "scalar-resource-service" ||
      service.argumentKind !== "scalar" ||
      service.returnConvention?.kind !== "far" ||
      service.returnConvention.stackBytes !== 0 ||
      !service.footprint.partMemoryComplete ||
      !service.footprint.preservesArgumentMemory ||
      !service.footprint.preservesPartState ||
      service.writes.some((w) => w.root !== "global")
    )
      continue;
    // CWD; XOR; SUB computes word absolute value, including 0x8000 remaining 0x8000.
    const absolute = (value: Expression) => {
      const sign = binary(">>", value, constant(15));
      return binary("-", binary("^", value, sign), sign);
    };
    const condition = and(
      compare("==", partField(4), constant(0)),
      compare(">", binary("+", absolute(partField(54)), absolute(partField(56))), constant(4096)),
    );
    const combined = {
      ...finding,
      evidence: [...finding.evidence, ...service.evidence],
      assumptions: [
        ...finding.assumptions,
        ...service.assumptions,
        "The complete wrapper passes scalar resource 20 only under its recorded gate. A request does not prove that the resource is enabled, a driver returns, or audible playback occurs.",
        "The absolute values and their sum wrap to words before the signed comparison with 4096. A large mathematical speed can therefore fail the gate. The backend's unknown global effects remain unresolved.",
      ],
    };
    return {
      ...base,
      ...combined,
      kind: "contact-resource-request",
      purpose:
        "For type zero, requests resource 20 when the wrapped sum of word absolute velocities is signed greater than 4096; playback depends on the resource backend.",
      // Backend global effects are not promoted into unconditional writes with scalar argument substitutions.
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: ["The conditional resource backend's resource, driver and global effects remain unresolved."],
        unknownPartEffects: [],
        unknownGlobalEffects: ["The conditional resource backend may change global and resource storage."],
      },
      contactResponse: {
        kind: "contact-resource-request",
        ownerArgument: 6,
        typeField: 4,
        requiredType: 0,
        velocityFields: [54, 56],
        condition,
        resource: 20,
        service: service.address,
        arithmetic: "wrappedWordAbsoluteValuesAndSumThenSignedComparison",
        audiblePlaybackEstablished: false,
      },
    };
  }
}
