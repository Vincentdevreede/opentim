import { describe, expect, it } from "vitest";
import { analyseRoutine, binary, type Expression, type Predicate } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { measuredClips, validateMeasuredPart } from "../src/read/behaviour-validation.ts";
import { compileScalarStep, pureScalarFrame } from "../src/read/behaviour-scalars.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const input: Expression = { kind: "field", object: "part", offset: 0x96, width: 16 };
const compare = (operator: string, n: number, signed = true): Predicate => ({
  kind: "compare",
  operator,
  left: input,
  right: constant(n),
  signed,
});
function intervals() {
  return [
    { condition: compare("<", 2), value: constant(700) },
    { condition: { kind: "and" as const, terms: [compare(">=", 2), compare("<", 6)] }, value: constant(200) },
    { condition: compare(">=", 6), value: constant(900) },
  ];
}
function substitute(e: Expression, n: number): Expression {
  if (e === input || (e.kind === "field" && e.offset === 0x96)) return constant(n, e.width);
  if (e.kind === "binary") return binary(e.operator, substitute(e.left, n), substitute(e.right, n), e.width);
  return e;
}
describe("scalar interval return algebra", () => {
  it.each([
    [-32768, 700],
    [-1, 700],
    [0, 700],
    [1, 700],
    [2, 200],
    [5, 200],
    [6, 900],
    [32767, 900],
    [65535, 700],
  ])("preserves the signed result at %i", (n, value) => {
    const step = compileScalarStep(intervals(), binary)!;
    expect(substitute(step.expression, n)).toMatchObject({ kind: "constant", value });
  });
  it("covers the entire signed byte domain, including negative cuts", () => {
    const byte: Expression = { kind: "field", object: "part", offset: 0x96, width: 8 };
    const cmp = (operator: string, n: number): Predicate => ({
      kind: "compare",
      operator,
      left: byte,
      right: constant(n, 8),
      signed: true,
    });
    const step = compileScalarStep(
      [
        { condition: cmp("<", -1), value: constant(9) },
        { condition: { kind: "and", terms: [cmp(">=", -1), cmp("<", 1)] }, value: constant(3) },
        { condition: cmp(">=", 1), value: constant(7) },
      ],
      binary,
    )!;
    for (let n = -128; n <= 127; n++)
      expect(substitute(step.expression, n)).toMatchObject({ kind: "constant", value: n < -1 ? 9 : n < 1 ? 3 : 7 });
  });
  it("uses the same arithmetic in descriptions and measured-edge validation", () => {
    const step = compileScalarStep(intervals(), binary)!;
    const fields = [{ object: "part", offset: 0x96, width: 16, value: 6, knownMask: 0xffff }];
    expect(
      evaluateBehaviourCondition(
        { kind: "compare", operator: "==", left: step.expression, right: constant(900), signed: false },
        fields,
      ),
    ).toBe(true);
    const state: Expression = { kind: "field", object: "part", offset: 12, width: 16 };
    const expression: Expression = { kind: "binary", operator: ">=", left: state, right: constant(1), width: 16 };
    const coverage = validateMeasuredPart(
      [
        {
          from: null,
          to: expression,
          condition: { kind: "true" },
          routine: 1,
          confidence: "inferred",
          evidence: [],
          assumptions: [],
        },
      ],
      measuredClips({ frames: [{ state: 0 }, { state: 0 }] }),
    );
    expect(coverage.unchanged.inferred).toBe(1);
    expect(coverage.missed).toBe(0);
  });
  it("sorts and merges equal overlaps without requiring monotone return values", () => {
    const cases = intervals();
    cases.reverse();
    cases.push({ condition: compare("==", 1), value: constant(700) });
    expect(compileScalarStep(cases, binary)!.intervals).toEqual([
      { low: -32768, high: 1, value: 700 },
      { low: 2, high: 5, value: 200 },
      { low: 6, high: 32767, value: 900 },
    ]);
  });
  it("rejects uncovered values and conflicting overlaps instead of supplying a default", () => {
    expect(compileScalarStep(intervals().slice(1), binary)).toBeUndefined();
    expect(
      compileScalarStep([...intervals(), { condition: compare("==", 1), value: constant(900) }], binary),
    ).toBeUndefined();
  });
  it("rejects other variables, mixed signedness, global reads and opaque guards", () => {
    for (const change of ["variable", "signed", "data", "unknown"]) {
      const cases = intervals();
      const p = cases[0]!.condition;
      if (p.kind !== "compare") throw Error("Fixture guard missing.");
      if (change === "variable") p.left = { kind: "field", object: "part", offset: 0x98, width: 16 };
      if (change === "signed") p.signed = false;
      if (change === "data") p.left = { kind: "field", object: "data", offset: 0x96, width: 16 };
      if (change === "unknown") cases[0]!.condition = { kind: "unknown", reason: "A dependency is unresolved." };
      expect(compileScalarStep(cases, binary)).toBeUndefined();
    }
  });
  it("keeps the existing expression-size bound", () => {
    const cases = Array.from({ length: 24 }, (_, n) => ({
      condition: {
        kind: "and" as const,
        terms: [...(n ? [compare(">=", n, false)] : []), ...(n < 23 ? [compare("<", n + 1, false)] : [])],
      },
      value: constant(n * 11),
    }));
    expect(compileScalarStep(cases, binary)).toBeUndefined();
  });
  it("defines comparison expressions as zero or one at the left operand's width", () => {
    expect(binary(">=", constant(-1, 8), constant(256, 16))).toMatchObject({ kind: "constant", value: 1 });
    expect(binary("<", constant(255, 8), constant(-1, 16))).toMatchObject({ kind: "constant", value: 0 });
    expect(binary("==", constant(0, 8), constant(256, 16))).toMatchObject({ kind: "constant", value: 1 });
  });
});

function fixture() {
  const image = new Uint8Array(0x200);
  const leaf = [
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x83, 0xbc, 0x96, 0, 4, 0x72, 5, 0xb8, 0, 0x80, 0xeb, 3, 0xb8, 1, 0, 0x5e,
    0x5d, 0xcb,
  ];
  image.set(leaf, 0x100);
  const code = readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0);
  const summary = analyseRoutine(image, code, { code });
  const fact = {
    confidence: "inferred" as const,
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    assumptions: [],
  };
  const engine: EngineSummary = {
    ...fact,
    address: 0x100,
    kind: "read-only",
    purpose: "Returns a scalar selected by a word comparison.",
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
  };
  return { image, code, summary, engine };
}
describe("pure scalar call composition", () => {
  it("preserves correlated AX and CWD-derived DX without a new expression kind", () => {
    const { image, code, summary, engine } = fixture();
    expect(pureScalarFrame(code)).toBe(true);
    const bytes = [
      0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 1, 0, 0, 0x59, 0x99, 0x83, 0xfa, 0, 0x75, 0, 0x3d, 0, 0x80,
      0x74, 0, 0xc7, 0x44, 12, 1, 0, 0xeb, 0, 0xc7, 0x44, 12, 2, 0, 0xeb, 0, 0xc7, 0x44, 12, 3, 0, 0x5e, 0x5d, 0xcb,
    ];
    bytes[19] = 32 - 20;
    bytes[24] = 39 - 25;
    bytes[31] = 44 - 32;
    bytes[38] = 44 - 39;
    image.set(bytes);
    const result = analyseRoutine(
      image,
      { address: 0, segment: 0, offset: 0 },
      { summaries: new Map([[0x100, summary]]), engineSummaries: new Map([[0x100, engine]]) },
    );
    expect(result.returnPathsComplete).toBe(true);
    expect(result.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : undefined)).sort()).toEqual([1, 2]);
    expect(result.engineCalls?.some((c) => c.purpose.includes("consecutive input ranges"))).toBe(true);
    expect(result.analysisWork!.pendingPaths).toBe(0);
  });
  it("rejects unpaired nonvolatile restores, argument stores and odd callee cleanup", () => {
    const a = fixture();
    a.code.instructions.find(
      (i) => i.mnemonic === "pop" && i.operands[0]?.kind === "register" && i.operands[0].name === "si",
    )!.mnemonic = "nop";
    expect(pureScalarFrame(a.code)).toBe(false);
    const b = fixture(),
      store = b.code.instructions.find((i) => i.mnemonic === "mov" && i.operands[1]?.kind === "immediate")!;
    store.operands[0] = { kind: "memory", segment: "ss", base: ["bp"], displacement: 6, direct: false, width: 16 };
    expect(pureScalarFrame(b.code)).toBe(false);
    const c = fixture();
    c.code.instructions.at(-1)!.operands = [{ kind: "immediate", value: 1, width: 16 }];
    expect(pureScalarFrame(c.code)).toBe(false);
  });
});
