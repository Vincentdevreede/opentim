import { describe, expect, it } from "vitest";
import { discoverAngleClassifier } from "../src/read/behaviour-angle.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { analyseRoutine, type Expression } from "../src/read/behaviour.ts";

function fixture(origin = 0x40, far = true, shared = false) {
  const body = [
    0x55,
    0x8b,
    0xec,
    0x8b,
    0x56,
    far ? 6 : 4,
    0x81,
    0xfa,
    0,
    0x20,
    0x75,
    4,
    0x33,
    0xc0,
    0xeb,
    25,
    0x81,
    0xfa,
    0,
    0xa0,
    0x75,
    5,
    0xb8,
    2,
    0,
    0xeb,
    14,
    0x81,
    0xc2,
    0,
    0x20,
    0xb1,
    14,
    0xd3,
    0xfa,
    0x81,
    0xe2,
    3,
    0,
    0x8b,
    0xc2,
    0x5d,
    far ? 0xcb : 0xc3,
  ];
  if (shared) {
    body[15] = 27;
    body[26] = 243;
    body.splice(41, 0, 0xeb, 227);
  }
  const image = new Uint8Array(origin + body.length);
  image.set(body, origin);
  const entry = { address: origin, offset: origin, segment: 0 };
  return { image, entry, code: readRoutineCode(image, entry, 0) };
}

/** Evaluates the public report algebra to check its mathematical relation, without interpreting instructions. */
function valueOf(expression: Expression, input: number): number {
  const mask = 2 ** expression.width - 1;
  if (expression.kind === "constant") return expression.value & mask;
  if (expression.kind === "field" && expression.object === "argument") return input & mask;
  if (expression.kind !== "binary") throw new Error("Expected a closed scalar relation");
  const a = valueOf(expression.left, input),
    b = valueOf(expression.right, input);
  switch (expression.operator) {
    case "+":
      return (a + b) & mask;
    case "-":
      return (a - b) & mask;
    case "&":
      return a & b & mask;
    case ">>>":
      return (a >>> b) & mask;
    case "==":
      return Number(a === b);
    default:
      throw new Error("Unexpected scalar operator");
  }
}

function caller(farCallee: boolean, farCall: boolean, pushSegment: boolean) {
  const { image: leaf, code } = fixture(0x40, farCallee);
  const image = new Uint8Array(0x100);
  image.set(leaf);
  const body = [0x55, 0x8b, 0xec, 0xff, 0x76, 8];
  if (pushSegment) body.push(0x0e);
  const site = body.length;
  if (farCall) body.push(0x9a, 0x40, 0, 0, 0);
  else body.push(0xe8, 0x40 - site - 3, 0);
  body.push(0x59, 0x5d, 0xcb);
  image.set(body);
  const entry = { address: 0, segment: 0, offset: 0 };
  return { image, entry, site, code: readRoutineCode(image, entry, 0), summary: discoverAngleClassifier(code)! };
}

describe("angle sector summary", () => {
  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])("finds a relocated classifier with far return %s and shared bridge %s", (far, shared) => {
    const { code } = fixture(0x160, far, shared);
    const summary = discoverAngleClassifier(code);
    expect(code.status).toBe("complete");
    expect(summary).toMatchObject({
      argumentOffset: far ? 6 : 4,
      argumentKind: "scalar",
      kind: "angle-sector",
      returnConvention: { kind: far ? "far" : "near", stackBytes: 0 },
      footprint: { complete: true, preservesPartState: true },
    });
    expect(summary!.evidence).toHaveLength(code.instructions.length);
    expect(summary!.returns).toHaveLength(1);
  });

  it("covers all 65536 inputs including both exceptions and word wrap", () => {
    const relation = discoverAngleClassifier(fixture().code)!.returns[0]!.value;
    for (let input = 0; input < 65536; input++) {
      const expected = input <= 0x2000 ? 0 : input <= 0x5fff ? 1 : input <= 0xa000 ? 2 : input <= 0xdfff ? 3 : 0;
      if (valueOf(relation, input) !== expected) throw new Error(`Incorrect sector at ${input}`);
    }
  });

  it.each(["boundary", "shift", "mask", "return", "argument", "store"])("rejects a changed %s", (change) => {
    const { code } = fixture();
    if (change === "return") code.instructions.at(-1)!.mnemonic = "iret";
    else {
      const instruction = code.instructions.find((i) =>
        change === "boundary"
          ? i.mnemonic === "cmp"
          : change === "shift"
            ? i.mnemonic === "sar"
            : change === "mask"
              ? i.mnemonic === "and"
              : i.mnemonic === "mov" && i.operands[1]?.kind === "memory",
      )!;
      if (change === "shift") instruction.mnemonic = "shr";
      else if (change === "store") instruction.operands.reverse();
      else if (change === "argument") {
        const source = instruction.operands[1]!;
        if (source.kind === "memory") source.displacement += 2;
      } else {
        const source = instruction.operands[1]!;
        if (source.kind === "immediate") source.value++;
      }
    }
    expect(discoverAngleClassifier(code)).toBeUndefined();
  });

  it("rejects an extra edge bypassing an exception", () => {
    const { code } = fixture();
    code.edges.push({ from: code.address, to: code.instructions.at(-2)!.address, kind: "jump" });
    expect(discoverAngleClassifier(code)).toBeUndefined();
  });

  it("keeps a caller on one symbolic path and retains the full classifier evidence", () => {
    const { image: leaf, code } = fixture(0x40);
    const image = new Uint8Array(0x100);
    image.set(leaf);
    // A scalar far argument, near call with PUSH CS, and a far return.
    image.set([0x55, 0x8b, 0xec, 0xff, 0x76, 8, 0x0e, 0xe8, 0x36, 0, 0x59, 0x5d, 0xcb]);
    const summary = discoverAngleClassifier(code)!;
    const result = analyseRoutine(
      image,
      { address: 0, segment: 0, offset: 0 },
      {
        engineSummaries: new Map([[code.address, summary]]),
      },
    );
    expect(result.uncertainEffects).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes![0]!.returnValue.kind).toBe("binary");
    expect(result.outcomes![0]!.evidence.some((e) => e.address === code.instructions.at(-1)!.address)).toBe(true);
  });
  it.each([
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])(
    "rejects a mismatched caller frame: far return %s, far call %s, segment push %s",
    (farCallee, farCall, pushSegment) => {
      const f = caller(farCallee!, farCall!, pushSegment!);
      const result = analyseRoutine(f.image, f.entry, { engineSummaries: new Map([[f.summary.address, f.summary]]) });
      expect(result.uncertainEffects).toBe(true);
      expect(result.engineCalls).toHaveLength(0);
      expect(result.outcomes).toHaveLength(0);
      expect(result.returnPathsComplete).toBe(false);
    },
  );

  it.each([
    [true, true, false],
    [true, false, true],
    [false, false, false],
  ])(
    "accepts a matching caller frame: far return %s, far call %s, segment push %s",
    (farCallee, farCall, pushSegment) => {
      const f = caller(farCallee!, farCall!, pushSegment!);
      const result = analyseRoutine(f.image, f.entry, { engineSummaries: new Map([[f.summary.address, f.summary]]) });
      expect(result.uncertainEffects).toBe(false);
      expect(result.engineCalls).toHaveLength(1);
      expect(result.outcomes![0]!.returnValue.kind).toBe("binary");
    },
  );

  it("rejects a call route that skips the far-frame segment push", () => {
    const f = caller(true, false, true);
    f.code.edges.push({ from: 3, to: f.site, kind: "jump" });
    const result = analyseRoutine(f.image, f.entry, {
      code: f.code,
      engineSummaries: new Map([[f.summary.address, f.summary]]),
    });
    expect(result.uncertainEffects).toBe(true);
    expect(result.engineCalls).toHaveLength(0);
  });
  it("blocks ordinary callee return relations at an invalid scalar frame too", () => {
    const f = caller(true, false, false);
    const leaf = analyseRoutine(f.image, { address: f.summary.address, segment: 0, offset: f.summary.address });
    expect(leaf.outcomes!.length).toBeGreaterThan(0);
    const result = analyseRoutine(f.image, f.entry, {
      summaries: new Map([[f.summary.address, leaf]]),
      engineSummaries: new Map([[f.summary.address, f.summary]]),
    });
    expect(result.uncertainEffects).toBe(true);
    expect(result.returnPathsComplete).toBe(false);
    expect(result.outcomes).toHaveLength(0);
    expect(result.transitions[0]!.confidence).toBe("unresolved");
  });
});
