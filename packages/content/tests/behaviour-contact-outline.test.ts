import { describe, expect, it } from "vitest";
import {
  commitSetTwoWhen,
  outlineFormulae,
  outlineSymbols,
  type ContactOutline,
  type OutlineContext,
} from "../src/read/behaviour-contact-outline.ts";
import { candidateOutlinePatterns, subjectOutlinePatterns } from "../src/read/behaviour-contact-outline-patterns.ts";
import { analyseRoutine, type Expression, type Predicate } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const context: OutlineContext = {
  subject: 0x900,
  candidate: 0x902,
  movementAngle: 0x806,
  movementX: 0x800,
  movementY: 0x802,
  subjectCenterX: 0x808,
  sectorX: 0xa00,
  sectorY: 0xa08,
};
const key = (object: string, offset: number) => `${object}:${offset}`;
const signed = (word: number, width = 16) => (word >= 2 ** (width - 1) ? word - 2 ** width : word);
/** Evaluates only the extracted mathematical algebra. No machine instruction or callback is interpreted. */
function value(expression: Expression, inputs: Record<string, number>): number {
  const mask = 2 ** expression.width - 1;
  if (expression.kind === "constant") return expression.value & mask;
  if (expression.kind === "field") {
    const input = inputs[key(expression.object, expression.offset)];
    if (input === undefined) throw Error(`Missing algebra input ${expression.object}:${expression.offset}`);
    return input & mask;
  }
  if (expression.kind !== "binary") throw Error("Expected a closed arithmetic expression");
  const a = value(expression.left, inputs),
    b = value(expression.right, inputs);
  switch (expression.operator) {
    case "+":
      return (a + b) & mask;
    case "-":
      return (a - b) & mask;
    case "*":
      return (a * b) & mask;
    case "|":
      return (a | b) & mask;
    case "&":
      return a & b & mask;
    case "^":
      return (a ^ b) & mask;
    case "==":
      return Number(a === b);
    case "!=":
      return Number(a !== b);
    case "<":
      return Number(a < b);
    case "<=":
      return Number(a <= b);
    case ">":
      return Number(a > b);
    case ">=":
      return Number(a >= b);
    default:
      throw Error(`Unexpected algebra operator ${expression.operator}`);
  }
}
function condition(predicate: Predicate, inputs: Record<string, number>): boolean {
  if (predicate.kind === "true") return true;
  if (predicate.kind === "and") return predicate.terms.every((term) => condition(term, inputs));
  if (predicate.kind !== "compare") throw Error("Expected a closed predicate");
  const a0 = value(predicate.left, inputs),
    b0 = value(predicate.right, inputs);
  const a = predicate.signed ? signed(a0, predicate.left.width) : a0,
    b = predicate.signed ? signed(b0, predicate.right.width) : b0;
  switch (predicate.operator) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    default:
      throw Error("Unknown compare");
  }
}
const baseInputs: Record<string, number> = {
  [key("outer edge start", 0)]: 0,
  [key("outer edge start", 2)]: 0,
  [key("outer edge end", 0)]: 1,
  [key("outer edge end", 2)]: 2,
  [key("outer boundary record", 2)]: 0,
  [key("previous inner boundary record", 2)]: 0,
  [key("current inner boundary record", 2)]: 0,
  [key("current inner boundary record", 0)]: 5,
  [key("current inner boundary record", 1)]: 7,
  [key("subject", 34)]: 100,
  [key("subject", 36)]: 200,
  [key("candidate", 30)]: 300,
  [key("candidate", 32)]: 400,
  [key("data", context.movementX)]: 3,
  [key("data", context.movementY)]: 4,
  [key("data", context.movementAngle)]: 0,
};

describe("outline pair formulae", () => {
  it("proves endpoint extension excludes both unit differences over every word input", () => {
    const formula = outlineFormulae(false, context).extendedBoundary.end.x;
    for (let delta = 0; delta < 65536; delta++) {
      const result = value(formula, { ...baseInputs, [key("outer edge end", 0)]: delta });
      const expected = (delta + Math.sign(signed(delta))) & 65535;
      if (result !== expected || result === 1 || result === 65535 || (result === 0) !== (delta === 0))
        throw Error(`Invalid extension invariant at ${delta}`);
      if (result !== 0 && Math.abs(signed(-result & 65535)) < 2) throw Error("Unsafe correction denominator");
    }
  });
  it.each([false, true])("checks every previous and next turn boundary with reverse %s", (reverse) => {
    const f = outlineFormulae(reverse, context);
    for (let angle = 0; angle < 65536; angle++) {
      const inputs = {
        ...baseInputs,
        [key("previous inner boundary record", 2)]: angle,
        [key("current inner boundary record", 2)]: angle,
      };
      const turn = (angle + 0x8000) & 65535;
      if (condition(f.previousTurnGate, inputs) !== (signed(turn) >= 0 || turn === 0x8000))
        throw Error("Incorrect previous angle gate");
      if (condition(f.nextTurnGate, inputs) !== signed(turn) <= 0) throw Error("Incorrect next angle gate");
    }
  });
  it.each([false, true])(
    "retains the half-turn only in movement and effective-angle calculations, reverse %s",
    (reverse) => {
      const f = outlineFormulae(reverse, context),
        outer = 0x7123;
      for (let movement = 0; movement < 65536; movement++) {
        const inputs = {
          ...baseInputs,
          [key("outer boundary record", 2)]: outer,
          [key("data", context.movementAngle)]: movement,
        };
        const expected = signed((movement + (reverse ? 0x8000 : 0) - outer + 0x4000) & 65535) > 0;
        if (condition(f.movementGate, inputs) !== expected) throw Error("Incorrect movement-angle gate");
      }
      expect(value(f.adjustedAngle, { ...baseInputs, [key("outer boundary record", 2)]: outer })).toBe(
        (outer + (reverse ? 0x8000 : 0)) & 65535,
      );
    },
  );
  it("uses old subject coordinates in the forward pass and current candidate coordinates in the reverse pass", () => {
    const forward = outlineFormulae(false, context),
      reverse = outlineFormulae(true, context);
    expect([
      value(forward.motion.start.x, baseInputs),
      value(forward.motion.start.y, baseInputs),
      value(forward.motion.end.x, baseInputs),
      value(forward.motion.end.y, baseInputs),
    ]).toEqual([105, 207, 108, 211]);
    expect([
      value(reverse.motion.start.x, baseInputs),
      value(reverse.motion.start.y, baseInputs),
      value(reverse.motion.end.x, baseInputs),
      value(reverse.motion.end.y, baseInputs),
    ]).toEqual([308, 411, 305, 407]);
  });
  it("compares the first output with the extended endpoint, independently of later output reuse", () => {
    const f = outlineFormulae(false, context);
    const inputs = {
      ...baseInputs,
      [key("first test output", 0)]: 2,
      [key("first test output", 2)]: 3,
      [key("correction output", 0)]: 999,
      [key("correction output", 2)]: 999,
    };
    expect(condition(f.rejectExtendedEndpoint, inputs)).toBe(false);
    expect(condition(f.rejectExtendedEndpoint, { ...inputs, [key("first test output", 0)]: 1 })).toBe(true);
    expect(value(f.correctedPosition.difference.x, inputs)).toBe(891);
    expect(f.correctedPosition.operation).toBe("add");
    expect(outlineFormulae(true, context).correctedPosition.operation).toBe("subtract");
  });
  it("wraps the line numerator before its signed-word division", () => {
    const f = outlineFormulae(false, context);
    const inputs = {
      ...baseInputs,
      [key("subject", 34)]: 32760,
      [key("current inner boundary record", 0)]: 5,
      [key("data", context.movementX)]: 3,
      [key("translated boundary start", 0)]: 0,
      [key("translated boundary start", 2)]: 0,
      [key("translated boundary end", 0)]: 2,
      [key("translated boundary end", 2)]: 3,
    };
    expect(value(f.verticalLine.numerator, inputs)).toBe(32768);
    expect(value(f.verticalLine.denominator, inputs)).toBe(65534);
    expect(f.verticalLine).toMatchObject({
      operation: "signedWordQuotient",
      rounding: "towardsZero",
      overflow: "excludedByEndpointExtension",
      zero: "restorePreviousPosition",
    });
  });
  it.each([
    [10, 0, 4, 5, true],
    [10, 0, 6, 5, false],
    [0, 10, 6, 5, true],
    [0, 10, 5, 5, false],
  ])("retains reverse side-mark direction for %i to %i", (start, end, centre, x, expected) => {
    const f = outlineFormulae(true, context),
      inputs = {
        ...baseInputs,
        [key("outer edge start", 0)]: start as number,
        [key("outer edge end", 0)]: end as number,
        [key("centre before refresh", 0)]: centre as number,
        [key("correction output", 0)]: x as number,
      };
    expect(condition(f.reverseSideMark!, inputs)).toBe(expected);
  });
});

function synthetic(body: number[], origin = 0x80) {
  const image = new Uint8Array(origin + body.length);
  image.set(body, origin);
  const entry = { address: origin, segment: 0, offset: origin };
  return { image, code: readRoutineCode(image, entry, 0) };
}
const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
/** Supplies a declared summary to test its application to small synthetic caller images, not a game object. */
function declaredOutline(): EngineSummary {
  const zero: Expression = { kind: "constant", value: 0, width: 16 },
    point = { x: zero, y: zero };
  const outline: ContactOutline = {
    ...fact,
    mode: "candidateEdgesAgainstSubjectVertices",
    argumentOffset: 6,
    probeCondition: {
      kind: "compare",
      operator: "!=",
      left: { kind: "field", object: "argument", offset: 6, width: 16 },
      right: zero,
      signed: false,
    },
    zeroMovementCondition: {
      kind: "and",
      terms: [context.movementX, context.movementY].map((offset) => ({
        kind: "compare",
        operator: "==",
        left: { kind: "field", object: "data", offset, width: 16 },
        right: zero,
        signed: false,
      })),
    },
    context,
    symbols: [],
    loops: {
      outerPart: "candidate",
      innerPart: "subject",
      countField: 128,
      outlineField: 130,
      stride: 4,
      firstIndex: 1,
      lastEdgeClosesTo: "rememberedEntryFirstPoint",
      innerVertexOrder: "pointOneThroughLastThenPointZero",
      nonwrappingCountDomain: { minimum: 2, maximum: 32766 },
      order: "outerIndexThenInnerIndexAfterEarlierWrites",
      coordinateSnapshots: [],
    },
    helpers: { classifier: 0x500, extend: 0x510, segment: 0x520, angleGate: 0x530, refresh: 0x540, bounds: 0x550 },
    formulas: outlineFormulae(false, context),
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
        routine: 0x520,
        first: { start: point, end: point },
        second: { start: point, end: point },
        output: "first test output",
        requiredReturn: 1,
      },
    },
    sector: { classifierInput: zero, value: zero, offset: point, adjustment: "useTableWords" },
    correction: {
      angleGateInput: zero,
      angleGateValue: zero,
      gateZero: "testTranslatedBoundaryAgain",
      secondTestFailure: "restorePreviousPosition",
      gateNonzero: "keepXAndSolveYOnTranslatedBoundary",
      restoreFields: { x: 34, y: 36 },
      afterCorrection: ["refreshDrawingGeometry", "refreshSubjectBounds"],
      reverseCenterSnapshot: "afterGeometryRefresh",
      secondTest: {
        routine: 0x520,
        first: { start: point, end: point },
        second: { start: point, end: point },
        output: "correction output",
      },
    },
    sideMarks: { cases: [], coordinate: zero, coordinatePhase: "afterGeometryRefresh" },
    commit: {
      flagsField: 6,
      flagsAndMask: 65529,
      clearedMask: 6,
      setTwoWhen: { kind: "true" },
      otherwiseSetMask: 4,
      contactPartField: 132,
      contactAngleField: 136,
      contactEdgeField: 138,
      indexSource: "outerIndexMinusOne",
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
    incomplete: [],
  };
  return {
    ...fact,
    address: 0x300,
    kind: "contact-search",
    purpose: "Unresolved geometric selection",
    argumentOffset: 6,
    argumentKind: "scalar",
    contactOutline: outline,
    globalObjectWrites: [{ ...fact, objectGlobal: context.subject, offset: 32, width: 16 }],
    writes: [],
    returns: [],
    calls: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}
function caller(
  probe: number | undefined,
  dx: number,
  dy: number,
  options: {
    unknownCall?: boolean;
    nearWithoutBridge?: boolean;
    nearWithBypass?: boolean;
    velocityZero?: boolean;
  } = {},
) {
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    0xc7,
    0x44,
    32,
    7,
    0,
    0xc7,
    6,
    0,
    8,
    dx & 255,
    dx >> 8,
    0xc7,
    6,
    2,
    8,
    dy & 255,
    dy >> 8,
  ];
  if (options.velocityZero) bytes.push(0xc7, 0x44, 54, 0, 0, 0xc7, 0x44, 56, 0, 0);
  if (options.unknownCall) bytes.push(0x9a, 0, 4, 0, 0);
  if (probe === undefined) bytes.push(0xff, 0xb4, 0x96, 0);
  else bytes.push(0xb8, probe & 255, probe >> 8, 0x50);
  if (options.nearWithBypass) bytes.push(0xe3, 1, 0x0e);
  if (options.nearWithoutBridge || options.nearWithBypass) {
    const delta = 0x300 - (0x80 + bytes.length + 3);
    bytes.push(0xe8, delta & 255, delta >> 8);
  } else bytes.push(0x9a, 0, 3, 0, 0);
  bytes.push(0x59, 0x89, 0x44, 12, 0x8b, 0x44, 32, 0x89, 0x84, 0x96, 0, 0x5e, 0x5d, 0xcb);
  const { image, code } = synthetic(bytes);
  return analyseRoutine(image, code, { stateOffset: 12, engineSummaries: new Map([[0x300, declaredOutline()]]) });
}

describe("outline caller specialisations", () => {
  it.each([0, 1, 65535])("retains exact zero return and memory with zero displacement and probe %i", (probe) => {
    const result = caller(probe, 0, 0);
    expect(result.engineCalls?.[0]?.purpose).toContain("both recorded movement words are zero");
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)?.value).toMatchObject({
      kind: "constant",
      value: 0,
    });
    expect(result.writes.find((w) => w.object === "part" && w.offset === 0x96)?.value).toMatchObject({
      kind: "constant",
      value: 7,
    });
  });
  it.each([1, 65535])("preserves memory in probe mode %i without inventing a hit", (probe) => {
    const result = caller(probe, 1, 2);
    expect(result.engineCalls?.[0]?.purpose).toContain("probe mode");
    expect(result.writes.find((w) => w.object === "part" && w.offset === 0x96)?.value).toMatchObject({
      kind: "constant",
      value: 7,
    });
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)?.confidence).toBe("unresolved");
  });
  it.each([
    [0, 1, 0],
    [0, 0, 1],
    [undefined, 1, 1],
  ])("retains possible changes with probe %s and movement %i/%i", (probe, dx, dy) => {
    const result = caller(probe, dx!, dy!);
    expect(result.engineCalls?.[0]?.purpose).toBe("Unresolved geometric selection");
    expect(result.writes.find((w) => w.object === "part" && w.offset === 0x96)?.confidence).toBe("unresolved");
  });
  it("does not substitute zero velocity for zero displacement", () => {
    expect(caller(0, 1, 0, { velocityZero: true }).engineCalls?.[0]?.purpose).toBe("Unresolved geometric selection");
  });
  it("does not reuse zero scratch values across an unresolved call", () => {
    const result = caller(0, 0, 0, { unknownCall: true });
    expect(result.engineCalls?.some((c) => c.purpose.includes("both recorded movement words are zero"))).toBe(false);
  });
  it("rejects a preceding segment push that another branch can bypass", () => {
    const result = caller(0, 0, 0, { nearWithBypass: true });
    expect(result.engineCalls?.some((c) => c.purpose.includes("both recorded movement words are zero"))).toBe(false);
  });
  it("does not apply a far-return specialisation to an unbridged near call", () => {
    const result = caller(0, 0, 0, { nearWithoutBridge: true });
    expect(result.engineCalls?.some((c) => c.purpose.includes("both recorded movement words are zero"))).toBe(false);
  });
});

function membershipCaller(type: number, head: number) {
  const { image, code } = synthetic([
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    0xc7,
    0x44,
    4,
    type & 255,
    type >> 8,
    0xc7,
    0x44,
    0x78,
    head & 255,
    head >> 8,
    0x33,
    0xc0,
    0x50,
    0x56,
    0x9a,
    0,
    3,
    0,
    0,
    0x59,
    0x59,
    0x89,
    0x44,
    12,
    0x5e,
    0x5d,
    0xcb,
  ]);
  const helper: EngineSummary = {
    ...fact,
    address: 0x300,
    kind: "contact-typed-list-membership",
    purpose: "Checks membership",
    argumentOffset: 6,
    argumentKind: "object",
    writes: [],
    returns: [],
    calls: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
    contactSmall: {
      kind: "typed-list-membership",
      ownerArgument: 6,
      valueArgument: 8,
      typeField: 4,
      requiredType: 17,
      headField: 0x78,
      nextField: 0x78,
      normalReturnValues: [0, 1],
      relation: "oneIfValueOccursInNonNullChainOtherwiseZero",
    },
  };
  return analyseRoutine(image, code, { stateOffset: 12, engineSummaries: new Map([[0x300, helper]]) });
}
describe("typed contact membership caller", () => {
  it.each([
    [16, 0x400],
    [17, 0],
    [65535, 0x400],
  ])("proves zero for type %i and head %i", (type, head) => {
    const result = membershipCaller(type!, head!);
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)?.value).toMatchObject({
      kind: "constant",
      value: 0,
    });
    expect(result.engineCalls?.[0]?.purpose).toContain("another type or its selected contact list is empty");
  });
  it("does not invent a membership result for a nonempty selected list", () => {
    const result = membershipCaller(17, 0x400);
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)?.confidence).toBe("unresolved");
    expect(result.engineCalls?.[0]?.purpose).toBe("Checks membership");
  });
});

describe("outline commit flags", () => {
  const typeTest = (pattern: string) => JSON.stringify(commitSetTwoWhen(pattern)).includes('"value":63');

  it("states the candidate type 63 test only for the forms of the code that have it", () => {
    for (const { code } of [...candidateOutlinePatterns, ...subjectOutlinePatterns])
      expect(typeTest(code)).toBe(code.includes("cmp 16:ds[bx+4],#63"));
    expect(typeTest(candidateOutlinePatterns[0]!.code)).toBe(true);
    expect(typeTest(candidateOutlinePatterns[2]!.code)).toBe(false);
    expect(typeTest(subjectOutlinePatterns[2]!.code)).toBe(false);
  });
});

describe("outline symbol notes", () => {
  const at = (offset: number) => `16:ss[bp+${offset}]`;

  it("takes registers and frame offsets from each form of the code", () => {
    for (const [n, pattern] of [...candidateOutlinePatterns, ...subjectOutlinePatterns].entries()) {
      const { code, frame } = pattern;
      expect(/mov ([sd]i),16:ds\[bx\+130\]/.exec(code)?.[1]?.toUpperCase()).toBe(pattern.outerRecord);
      const leas = [...code.matchAll(/lea ax,16:ss\[bp\+(-\d+)\]/g)].map((m) => Number(m[1]));
      expect(leas.slice(0, 2)).toEqual([frame.translatedStart[0], frame.testOutput[0]]);
      expect(code).toContain(`mov ax,${at(frame.testOutput[1])}`);
      for (const offset of frame.translatedStart) expect(code).toContain(`mov ${at(offset)},#0`);
      for (const offset of frame.translatedEnd) expect(code).toContain(`mov ${at(offset)},ax`);
      expect(code).toContain(`mov ${at(frame.previousInner)},ax`);
      for (const offset of [...frame.outerStart, ...frame.outerEnd]) expect(code).toContain(`mov ${at(offset)},ax`);
      expect(frame.centreBeforeRefresh !== undefined).toBe(n >= candidateOutlinePatterns.length);
      if (frame.centreBeforeRefresh !== undefined)
        expect(code).toContain(
          `mov ax,16:ds[{subjectCenterX}]\nsub ax,${at(frame.outerStart[0])}\nmov ${at(frame.centreBeforeRefresh)},ax`,
        );
    }
  });

  it("gives the third subject form its own registers and offsets", () => {
    const symbols = outlineSymbols(subjectOutlinePatterns[2]!);
    const offsets = (object: string) => symbols.find((s) => s.object === object)?.frameOffsets;
    expect(symbols[0]!.meaning).toContain("DI");
    expect(symbols[2]!.meaning).toContain("SI");
    expect(offsets("first test output")).toEqual([-68, -66]);
    expect(offsets("translated boundary start")).toEqual([-56, -54]);
    expect(offsets("translated boundary end")).toEqual([-52, -50]);
    expect(offsets("centre before refresh")).toEqual([-36]);
    expect(
      outlineSymbols(subjectOutlinePatterns[0]!).find((s) => s.object === "centre before refresh")?.frameOffsets,
    ).toEqual([-32]);
  });
});
