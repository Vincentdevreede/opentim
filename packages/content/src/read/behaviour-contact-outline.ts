/** Describes both ordered outline searches as guarded relations, without choosing geometry or evaluating game code. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { candidateOutlinePatterns, subjectOutlinePatterns } from "./behaviour-contact-outline-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression, Finding, Predicate } from "./behaviour.ts";

export interface OutlineContext {
  subject: number;
  candidate: number;
  movementAngle: number;
  movementX: number;
  movementY: number;
  subjectCenterX: number;
  subjectX?: number;
  subjectY?: number;
  candidateX?: number;
  candidateY?: number;
  sectorX: number;
  sectorY: number;
}
export interface OutlinePoint {
  x: Expression;
  y: Expression;
}
export interface OutlineFormulae {
  adjustedAngle: Expression;
  movementGate: Predicate;
  previousTurnGate: Predicate;
  nextTurnGate: Predicate;
  nonzeroMovement: Predicate;
  motion: { start: OutlinePoint; end: OutlinePoint };
  extendedBoundary: { start: OutlinePoint; end: OutlinePoint };
  rejectExtendedEndpoint: Predicate;
  verticalLine: {
    numerator: Expression;
    denominator: Expression;
    operation: "signedWordQuotient";
    rounding: "towardsZero";
    zero: "restorePreviousPosition";
    overflow: "excludedByEndpointExtension";
  };
  correctedPosition: { operation: "add" | "subtract"; difference: OutlinePoint };
  reverseSideMark?: Predicate;
}
export interface ContactOutline extends Finding {
  mode: "candidateEdgesAgainstSubjectVertices" | "subjectEdgesAgainstCandidateVertices";
  argumentOffset: 6;
  probeCondition: Predicate;
  zeroMovementCondition: Predicate;
  context: OutlineContext;
  symbols: { object: string; meaning: string; frameOffsets?: number[] }[];
  loops: {
    outerPart: "subject" | "candidate";
    innerPart: "subject" | "candidate";
    countField: number;
    outlineField: number;
    stride: 4;
    firstIndex: 1;
    lastEdgeClosesTo: "rememberedEntryFirstPoint";
    innerVertexOrder: "pointOneThroughLastThenPointZero";
    nonwrappingCountDomain: { minimum: 2; maximum: 32766 };
    order: "outerIndexThenInnerIndexAfterEarlierWrites";
    coordinateSnapshots: string[];
  };
  helpers: {
    classifier: number;
    extend: number;
    segment: number;
    angleGate: number;
    refresh: number;
    bounds: number;
    markSides?: number;
  };
  eligibility: {
    order: [
      "movementAngle",
      "previousTurn",
      "nextTurn",
      "nonzeroDisplacement",
      "firstSegmentAccepted",
      "pointDiffersFromExtendedEnd",
      "probe",
    ];
    firstSegment: {
      routine: number;
      first: { start: OutlinePoint; end: OutlinePoint };
      second: { start: OutlinePoint; end: OutlinePoint };
      output: "first test output";
      requiredReturn: 1;
    };
  };
  formulas: OutlineFormulae;
  sector: {
    classifierInput: Expression;
    value: Expression;
    offset: OutlinePoint;
    adjustment: "useTableWords" | "negateTableWords";
  };
  correction: {
    angleGateInput: Expression;
    angleGateValue: Expression;
    gateZero: "testTranslatedBoundaryAgain";
    secondTestFailure: "restorePreviousPosition";
    gateNonzero: "keepXAndSolveYOnTranslatedBoundary";
    restoreFields: { x: number; y: number };
    afterCorrection: ["refreshDrawingGeometry", "refreshSubjectBounds"];
    reverseCenterSnapshot: "beforeGeometryRefresh" | "afterGeometryRefresh";
    secondTest: {
      routine: number;
      first: { start: OutlinePoint; end: OutlinePoint };
      second: { start: OutlinePoint; end: OutlinePoint };
      output: "correction output";
    };
  };
  sideMarks: {
    cases: { condition: Predicate; fields: number[] }[];
    coordinate: Expression;
    coordinatePhase: "beforeGeometryRefresh" | "afterGeometryRefresh";
  };
  commit: {
    flagsField: number;
    flagsAndMask: number;
    clearedMask: number;
    setTwoWhen: Predicate;
    otherwiseSetMask: number;
    contactPartField: number;
    contactAngleField: number;
    contactEdgeField: number;
    indexSource: "outerIndexMinusOne" | "innerIndexMinusOne";
    sideBytes: number[];
    sideMarksAccumulate: true;
    rollbackStillCountsAsContact: true;
    requiresZeroProbe: true;
  };
  returns: {
    normalValues: [0, 1];
    nonzeroProbe: "oneAtFirstEligiblePairOtherwiseZero";
    zeroResult: "noNonprivateWrites";
    normalCommit: "oneAfterAnyAcceptedPair";
  };
  incomplete: string[];
}
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const field = (object: string, offset: number, width = 16): Expression => ({ kind: "field", object, offset, width });
const binary = (operator: string, left: Expression, right: Expression, width = 16): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width,
});
const compare = (operator: string, left: Expression, right: Expression, signed = false): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed,
});
const all = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const predicateValue = (predicate: Predicate): Expression => {
  if (predicate.kind === "true") return constant(1);
  if (predicate.kind === "and")
    return predicate.terms.map(predicateValue).reduce((a, b) => binary("*", a, b), constant(1));
  if (predicate.kind !== "compare")
    return { kind: "unknown", reason: "The Boolean formula has no closed scalar relation.", width: 16 };
  const ordered = predicate.signed && !["==", "!="].includes(predicate.operator);
  const left = ordered ? binary("^", predicate.left, constant(2 ** (predicate.left.width - 1))) : predicate.left;
  const right = ordered ? binary("^", predicate.right, constant(2 ** (predicate.right.width - 1))) : predicate.right;
  return binary(predicate.operator, left, right);
};
const either = (...terms: Predicate[]): Predicate =>
  compare(
    "!=",
    terms.map(predicateValue).reduce((a, b) => binary("|", a, b), constant(0)),
    constant(0),
  );
const global = (offset: number) => field("data", offset);
const point = (object: string): OutlinePoint => ({ x: field(object, 0), y: field(object, 2) });
const change = (a: OutlinePoint, b: OutlinePoint, operator: string): OutlinePoint => ({
  x: binary(operator, a.x, b.x),
  y: binary(operator, a.y, b.y),
});
const substituteArgument = (value: Expression, input: Expression): Expression => {
  if (value.kind === "field" && value.object === "argument" && value.offset === 6) return input;
  if (value.kind === "binary")
    return { ...value, left: substituteArgument(value.left, input), right: substituteArgument(value.right, input) };
  return value;
};
const mapPredicate = (predicate: Predicate, map: (value: Expression) => Expression): Predicate => {
  if (predicate.kind === "and") return { ...predicate, terms: predicate.terms.map((p) => mapPredicate(p, map)) };
  if (predicate.kind === "compare") return { ...predicate, left: map(predicate.left), right: map(predicate.right) };
  return predicate;
};

/** These equations describe a pair's local calculations. They never enumerate vertices or run an extracted routine. */
export function outlineFormulae(reverse: boolean, context: OutlineContext): OutlineFormulae {
  const start = point("outer edge start"),
    end = point("outer edge end");
  const rawAngle = field("outer boundary record", 2),
    adjustedAngle = reverse ? binary("+", rawAngle, constant(0x8000)) : rawAngle;
  const previousTurn = binary("+", binary("-", field("previous inner boundary record", 2), rawAngle), constant(0x8000));
  const nextTurn = binary("+", binary("-", field("current inner boundary record", 2), rawAngle), constant(0x8000));
  const relative: OutlinePoint = {
    x: binary(
      "-",
      binary(
        "+",
        field(reverse ? "candidate" : "subject", reverse ? 30 : 34),
        field("current inner boundary record", 0, 8),
      ),
      start.x,
    ),
    y: binary(
      "-",
      binary(
        "+",
        field(reverse ? "candidate" : "subject", reverse ? 32 : 36),
        field("current inner boundary record", 1, 8),
      ),
      start.y,
    ),
  };
  const moved = change(relative, { x: global(context.movementX), y: global(context.movementY) }, "+");
  const vector = change(end, start, "-");
  const extend = (delta: Expression) =>
    binary(
      "+",
      delta,
      binary(
        "-",
        binary(">", binary("^", delta, constant(0x8000)), constant(0x8000)),
        binary("<", binary("^", delta, constant(0x8000)), constant(0x8000)),
      ),
    );
  const extended = { x: extend(vector.x), y: extend(vector.y) };
  const translatedStart = point("translated boundary start"),
    translatedEnd = point("translated boundary end");
  const vx = binary("-", translatedEnd.x, translatedStart.x),
    vy = binary("-", translatedEnd.y, translatedStart.y);
  const lineConstant = binary("-", binary("*", vy, translatedStart.x), binary("*", vx, translatedStart.y));
  const motionEnd = reverse ? relative : moved;
  const firstPoint = point("first test output"),
    intersection = point("correction output");
  const reverseDirection = compare(">", start.x, end.x, true),
    reverseCenter = field("centre before refresh", 0);
  return {
    adjustedAngle,
    movementGate: compare(
      ">",
      binary(
        "+",
        binary(
          "-",
          reverse ? binary("+", global(context.movementAngle), constant(0x8000)) : global(context.movementAngle),
          rawAngle,
        ),
        constant(0x4000),
      ),
      constant(0),
      true,
    ),
    previousTurnGate: either(
      compare(">=", previousTurn, constant(0), true),
      compare("==", previousTurn, constant(0x8000)),
    ),
    nextTurnGate: compare("<=", nextTurn, constant(0), true),
    nonzeroMovement: either(
      compare("!=", global(context.movementX), constant(0)),
      compare("!=", global(context.movementY), constant(0)),
    ),
    motion: reverse ? { start: moved, end: relative } : { start: relative, end: moved },
    extendedBoundary: { start: { x: constant(0), y: constant(0) }, end: extended },
    rejectExtendedEndpoint: either(compare("!=", firstPoint.x, extended.x), compare("!=", firstPoint.y, extended.y)),
    verticalLine: {
      numerator: binary("-", lineConstant, binary("*", vy, motionEnd.x)),
      denominator: binary("-", constant(0), vx),
      operation: "signedWordQuotient",
      rounding: "towardsZero",
      zero: "restorePreviousPosition",
      overflow: "excludedByEndpointExtension",
    },
    correctedPosition: { operation: reverse ? "subtract" : "add", difference: change(intersection, motionEnd, "-") },
    ...(reverse
      ? {
          reverseSideMark: either(
            all(reverseDirection, compare("<=", reverseCenter, intersection.x, true)),
            all(compare("<=", start.x, end.x, true), compare(">", reverseCenter, intersection.x, true)),
          ),
        }
      : {}),
  };
}

const validWord = (n: number | undefined): n is number => n !== undefined && n >= 0 && n <= 65534;
/** Complete graph, dependencies and context identities are checked before any semantic relation is exposed. */
export function addContactOutlineSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  dataSegment: number,
) {
  for (const code of codes.values()) {
    const prior = summaries.get(code.address);
    if (!prior?.contactSearch || !prior.globalObjectWrites?.length) continue;
    let bound: Map<string, number> | undefined,
      reverse = false;
    for (const [mode, patterns] of [candidateOutlinePatterns, subjectOutlinePatterns].entries()) {
      for (const pattern of patterns) {
        bound = matchHeapRoutine(code, pattern, new Map());
        if (bound) break;
      }
      if (bound) {
        reverse = mode === 1;
        break;
      }
    }
    if (
      !bound ||
      bound.get("subject") !== prior.contactSearch.subjectGlobal ||
      bound.get("candidate") !== prior.contactSearch.candidateGlobal
    )
      continue;
    const helper = (name: string) => summaries.get(bound!.get(name)!);
    const classifier = helper("classifier"),
      extend = helper("extend"),
      segment = helper("segment"),
      gate = helper("angleGate"),
      refresh = helper("refresh"),
      bounds = helper("bounds"),
      markSides = reverse ? undefined : helper("markSides");
    if (
      classifier?.kind !== "angle-sector" ||
      !classifier.returns[0] ||
      gate?.kind !== "saved-angle-gate" ||
      !gate.returns[0] ||
      !segment?.contactSegment ||
      extend?.contactSmall?.kind !== "endpoint-extension" ||
      (!reverse && markSides?.contactSmall?.kind !== "direction-side-flags") ||
      !bounds?.contactBounds ||
      bounds.contactBounds.kind !== "swept-subject" ||
      refresh?.kind !== "frame-position" ||
      !refresh.footprint.complete ||
      refresh.writes.some((w) => w.root !== "argument" || w.path.length || ![42, 44, 68, 70].includes(w.offset))
    )
      continue;
    const context = Object.fromEntries(
      [
        "subject",
        "candidate",
        "movementAngle",
        "movementX",
        "movementY",
        "subjectCenterX",
        "subjectX",
        "subjectY",
        "candidateX",
        "candidateY",
        "sectorX",
        "sectorY",
      ]
        .filter((k) => bound!.has(k))
        .map((k) => [k, bound!.get(k)!]),
    ) as unknown as OutlineContext;
    const words = Object.values(context);
    if (
      words.some((word) => !validWord(word)) ||
      words.some((a, n) => words.some((b, m) => n !== m && Math.abs(a - b) < 2)) ||
      context.sectorX > 65528 ||
      context.sectorY > 65528
    )
      continue;
    if (
      prior.writes.some(
        (w) =>
          w.root === "global" &&
          [context.sectorX, context.sectorY].some((at) => w.offset < at + 8 && at < w.offset + w.width / 8),
      )
    )
      continue;
    const prepared = bounds.contactBounds;
    const source = (at: number, name: string, fieldOffset: number) =>
      prepared.values.some(
        (v) =>
          v.global === at &&
          v.operation === name &&
          v.inputs.some((i) => i.kind === "objectField" && i.offset === fieldOffset),
      );
    const candidatePrepared = [...summaries.values()].some(
      (summary) =>
        summary.contactBounds?.kind === "candidate" &&
        summary.contactBounds.objectGlobal === context.candidate &&
        [context.candidateX, context.candidateY].every((at, n) =>
          summary.contactBounds!.values.some(
            (v) =>
              v.global === at &&
              v.operation === "copy" &&
              v.inputs.some((i) => i.kind === "objectField" && i.offset === (n === 0 ? 30 : 32)),
          ),
        ),
    );
    if (reverse ? !source(context.subjectX!, "copy", 30) || !source(context.subjectY!, "copy", 32) : !candidatePrepared)
      continue;
    if (
      prepared.objectGlobal !== context.subject ||
      !source(context.movementX, "subtract", 34) ||
      !source(context.movementY, "subtract", 36) ||
      !source(context.subjectCenterX, "addSignedHalf", 30)
    )
      continue;
    const formulas = outlineFormulae(reverse, context);
    const sector = substituteArgument(classifier.returns[0].value, formulas.adjustedAngle);
    const table = (offset: number): Expression => ({
      kind: "table",
      segment: dataSegment,
      offset,
      index: binary("<<", sector, constant(1)),
      width: 16,
    });
    const tableOffset = (offset: number) => (reverse ? binary("-", constant(0), table(offset)) : table(offset));
    const candidateFlags = field("candidate", 8),
      subjectFlags = field("subject", 8);
    const translated = { start: point("translated boundary start"), end: point("translated boundary end") };
    const centre = binary("-", global(context.subjectCenterX), field("outer edge start", 0));
    const mapSideInput = (expression: Expression): Expression => {
      if (expression.kind === "field" && expression.object === "part")
        return expression.offset === 0 ? translated.start.x : expression.offset === 4 ? translated.end.x : expression;
      if (expression.kind === "field" && expression.object === "argument" && expression.offset === 8) return centre;
      if (expression.kind === "binary")
        return { ...expression, left: mapSideInput(expression.left), right: mapSideInput(expression.right) };
      return expression;
    };
    const sideCases = reverse
      ? [
          { condition: formulas.reverseSideMark!, fields: [135] },
          { condition: compare("==", predicateValue(formulas.reverseSideMark!), constant(0)), fields: [134] },
        ]
      : markSides!.contactSmall!.kind === "direction-side-flags"
        ? markSides!.contactSmall!.cases.map((c) => ({
            condition: mapPredicate(c.condition, mapSideInput),
            fields: c.flags.map((offset) => 132 + offset),
          }))
        : [];
    const dependencies = [classifier, extend, segment, gate, refresh, bounds, ...(markSides ? [markSides] : [])];
    const finding: Finding = {
      confidence: "inferred",
      evidence: [
        ...new Map(
          [
            ...code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
            ...dependencies.flatMap((h) => h.evidence),
          ].map((e) => [e.address, e]),
        ).values(),
      ],
      assumptions: [
        ...new Set([
          ...prior.assumptions,
          ...dependencies.flatMap((h) => h.assumptions),
          "This is an ordered symbolic relation, not an executed polygon test. Each pair uses the current context and part fields after earlier accepted writes; cached outer coordinates retain their recorded snapshots.",
          "Outlines use unsigned byte X/Y and a word orientation in four-byte records, in valid separate nonwrapping storage. Counts, outline pointers and point records are not changed by the complete callee footprints. The finite closed-polygon interpretation requires counts from two through 32766; arbitrary signed counts are not assigned that interpretation.",
          "Every arithmetic expression wraps at its recorded width. The line solve sign-extends a wrapped word numerator with CWD. Endpoint extension excludes horizontal differences 1 and 65535, and equal table translation preserves that difference. Its nonzero negation therefore has magnitude at least two, excluding signed quotient overflow. A zero divisor takes the explicit restore branch.",
          "The two four-word sector tables are read as data through their discovered addresses and the verified sector index. Their words are not replaced with guessed physical directions. Separate valid storage and the checked global footprint prevent writes to these tables during this relation.",
          "The symbolic objects naming boundary records, cached coordinates and helper output are explicitly declared loop-local or input symbols, not additional part fields or supplied game events.",
        ]),
      ],
    };
    const relation: ContactOutline = {
      ...finding,
      mode: reverse ? "subjectEdgesAgainstCandidateVertices" : "candidateEdgesAgainstSubjectVertices",
      argumentOffset: 6,
      probeCondition: compare("!=", field("argument", 6), constant(0)),
      zeroMovementCondition: all(
        compare("==", global(context.movementX), constant(0)),
        compare("==", global(context.movementY), constant(0)),
      ),
      context,
      symbols: [
        { object: "outer boundary record", meaning: "The record addressed by SI for the current outer edge." },
        {
          object: "previous inner boundary record",
          meaning: "The preceding inner record's orientation, cached in the private frame.",
          frameOffsets: [-12],
        },
        {
          object: "current inner boundary record",
          meaning: "The record addressed by DI for the current vertex and its outgoing edge.",
        },
        {
          object: "outer edge start",
          meaning: "Cached world coordinates at this iteration; these can predate earlier position corrections.",
          frameOffsets: [-16, -22],
        },
        {
          object: "outer edge end",
          meaning: "Cached endpoint coordinates, including the remembered entry point when closing.",
          frameOffsets: [-18, -24],
        },
        {
          object: "first test output",
          meaning: "The first segment-test output before the probe gate or any second test.",
          frameOffsets: [-64, -62],
        },
        {
          object: "correction output",
          meaning:
            "The same local pair at a later phase: a second test overwrites both words even on failure, while the line solve overwrites only Y and retains the first test X. A zero-divisor fallback retains the first test output.",
          frameOffsets: [-64, -62],
        },
        {
          object: "translated boundary start",
          meaning: "The sector table words, negated in the reverse pass.",
          frameOffsets: [-52, -50],
        },
        {
          object: "translated boundary end",
          meaning: "The extended endpoint plus the same sector table words.",
          frameOffsets: [-48, -46],
        },
        {
          object: "centre before refresh",
          meaning:
            "Subject centre X minus cached outer start X, captured before the geometry and bounds refresh in the reverse pass.",
          frameOffsets: reverse ? [-32] : undefined,
        },
      ],
      loops: {
        outerPart: reverse ? "subject" : "candidate",
        innerPart: reverse ? "candidate" : "subject",
        countField: 128,
        outlineField: 130,
        stride: 4,
        firstIndex: 1,
        lastEdgeClosesTo: "rememberedEntryFirstPoint",
        innerVertexOrder: "pointOneThroughLastThenPointZero",
        nonwrappingCountDomain: { minimum: 2, maximum: 32766 },
        order: "outerIndexThenInnerIndexAfterEarlierWrites",
        coordinateSnapshots: [
          "The initial edge uses entry scratch origins and the first two records; its first world point is remembered.",
          "Advancing an outer edge copies its previous endpoint to the new start; a nonclosing end uses the then-current scratch origin, and the closing end uses the remembered entry point.",
          reverse
            ? "Subject scratch origins can change after a committed correction, so a cached edge need not be a polygon translated by one current position."
            : "Candidate scratch origins remain the candidate preparation values; subject bounds are refreshed separately.",
          "Inner vertex coordinates are read on each reached pair. Previous-edge orientation is carried in a local and the final inner iteration uses record zero.",
        ],
      },
      helpers: {
        classifier: classifier.address,
        extend: extend.address,
        segment: segment.address,
        angleGate: gate.address,
        refresh: refresh.address,
        bounds: bounds.address,
        ...(markSides ? { markSides: markSides.address } : {}),
      },
      formulas,
      eligibility: {
        order: [
          "movementAngle",
          "previousTurn",
          "nextTurn",
          "nonzeroDisplacement",
          "firstSegmentAccepted",
          "pointDiffersFromExtendedEnd",
          "probe",
        ],
        firstSegment: {
          routine: segment.address,
          first: formulas.motion,
          second: formulas.extendedBoundary,
          output: "first test output",
          requiredReturn: 1,
        },
      },
      sector: {
        classifierInput: formulas.adjustedAngle,
        value: sector,
        offset: { x: tableOffset(context.sectorX), y: tableOffset(context.sectorY) },
        adjustment: reverse ? "negateTableWords" : "useTableWords",
      },
      correction: {
        angleGateInput: formulas.adjustedAngle,
        angleGateValue: substituteArgument(gate.returns[0].value, formulas.adjustedAngle),
        gateZero: "testTranslatedBoundaryAgain",
        secondTestFailure: "restorePreviousPosition",
        gateNonzero: "keepXAndSolveYOnTranslatedBoundary",
        restoreFields: { x: 34, y: 36 },
        afterCorrection: ["refreshDrawingGeometry", "refreshSubjectBounds"],
        reverseCenterSnapshot: reverse ? "beforeGeometryRefresh" : "afterGeometryRefresh",
        secondTest: {
          routine: segment.address,
          first: formulas.motion,
          second: translated,
          output: "correction output",
        },
      },
      sideMarks: {
        cases: sideCases,
        coordinate: centre,
        coordinatePhase: reverse ? "beforeGeometryRefresh" : "afterGeometryRefresh",
      },
      commit: {
        flagsField: 6,
        flagsAndMask: 65529,
        clearedMask: 6,
        setTwoWhen: all(
          compare("!=", field("candidate", 4), constant(63)),
          either(
            compare("!=", binary("&", binary("|", subjectFlags, candidateFlags), constant(32768)), constant(0)),
            compare("!=", binary("&", field("candidate", 6), constant(16384)), constant(0)),
          ),
        ),
        otherwiseSetMask: 4,
        contactPartField: 132,
        contactAngleField: 136,
        contactEdgeField: 138,
        indexSource: reverse ? "innerIndexMinusOne" : "outerIndexMinusOne",
        sideBytes: [134, 135],
        sideMarksAccumulate: true,
        rollbackStillCountsAsContact: true,
        requiresZeroProbe: true,
      },
      returns: {
        normalValues: [0, 1],
        nonzeroProbe: "oneAtFirstEligiblePairOtherwiseZero",
        zeroResult: "noNonprivateWrites",
        normalCommit: "oneAfterAnyAcceptedPair",
      },
      incomplete: [
        "The movement-angle context value is an input to this relation. A scanner with a separately certified movement-angle source can link it to the wrapped position differences and code-segment lookup.",
        "No runtime contact graph, outline points, sector-table values or earlier successful corrections are invented. Callers with unknown geometry keep unresolved outcomes.",
      ],
    };
    summaries.set(code.address, {
      ...prior,
      contactOutline: relation,
      purpose: reverse
        ? "Tests subject edges against candidate vertices in recorded order; a probe only reads, while a committed contact can correct position and accumulate side marks."
        : "Tests candidate edges against moving subject vertices in recorded order; a probe only reads, while a committed contact can correct position and accumulate side marks.",
    });
  }
}
