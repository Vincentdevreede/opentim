import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import {
  discoverFirstContactResponse,
  firstContactResponseFormulae,
  type FirstResponseFormula,
} from "../src/read/behaviour-contact-response-first.ts";

// These checks evaluate the public integer relations, never x86 instructions or game callbacks.
const mask = (width: number) => (1n << BigInt(width)) - 1n;
const wrap = (n: bigint, width: number) => n & mask(width);
const signed = (n: bigint, width: number) => BigInt.asIntN(width, n);
function formula(
  expression: FirstResponseFormula,
  inputs: Record<string, bigint>,
  stages: Map<string, bigint>,
  factors: { first: bigint; second: bigint },
): bigint {
  const run = (e: FirstResponseFormula) => formula(e, inputs, stages, factors);
  if (expression.kind === "constant") return wrap(BigInt(expression.value), expression.width);
  if (expression.kind === "input") {
    if (inputs[expression.name] === undefined) throw Error("Missing input " + expression.name);
    return wrap(inputs[expression.name]!, expression.width);
  }
  if (expression.kind === "stage") {
    if (!stages.has(expression.name))
      throw Error("A stage refers to a later or missing definition: " + expression.name);
    return stages.get(expression.name)!;
  }
  if (expression.kind === "lookup") {
    run(expression.angle);
    return wrap(factors[expression.scalar], 16);
  }
  if (expression.kind === "select")
    return run(expression.condition) !== 0n ? run(expression.whenTrue) : run(expression.whenFalse);
  if (expression.kind === "sign-extend") return wrap(signed(run(expression.value), 16), 32);
  if (expression.kind === "low-word") return wrap(run(expression.value), 16);
  if (expression.kind === "high-word") return wrap(run(expression.value) >> 16n, 16);
  if (expression.kind !== "binary") throw Error("Unknown public expression");
  const a = run(expression.left),
    b = run(expression.right);
  let result: bigint;
  switch (expression.operator) {
    case "+":
      result = a + b;
      break;
    case "-":
      result = a - b;
      break;
    case "*":
      result = a * b;
      break;
    case "&":
      result = a & b;
      break;
    case "|":
      result = a | b;
      break;
    case "<<":
      result = a << b;
      break;
    case ">>":
      result = signed(a, expression.left.width) >> b;
      break;
    case "==":
      result = BigInt(a === b);
      break;
    case "!=":
      result = BigInt(a !== b);
      break;
    case "signed<":
      result = BigInt(signed(a, expression.left.width) < signed(b, expression.right.width));
      break;
    case "signed>":
      result = BigInt(signed(a, expression.left.width) > signed(b, expression.right.width));
      break;
    case "signed>=":
      result = BigInt(signed(a, expression.left.width) >= signed(b, expression.right.width));
      break;
    default:
      throw Error("Unknown public operator " + expression.operator);
  }
  return wrap(result, expression.width);
}
function evaluate(values: Record<string, number> = {}, factors = { first: 16384n, second: 0n }) {
  const inputs = Object.fromEntries(
    Object.entries({
      contactAngle: 0,
      sideFirst: 1,
      sideSecond: 1,
      contactType: 0,
      contactControl: 0,
      ownCoefficient: 0,
      contactCoefficient: 0,
      recordAcceleration: 0,
      velocityX: 0,
      flags: 0,
      limit: 32767,
      positionY: 0,
      ...values,
    }).map(([name, value]) => [name, BigInt(value)]),
  );
  const stages = new Map<string, bigint>();
  for (const stage of firstContactResponseFormulae())
    stages.set(stage.name, formula(stage.value, inputs, stages, factors));
  return (name: string, width = 16) => Number(signed(stages.get(name)!, width));
}

describe("First selected contact response", () => {
  it("uses an acyclic graph with distinct computed stages", () => {
    const stages = firstContactResponseFormulae();
    expect(new Set(stages.map((stage) => stage.name)).size).toBe(stages.length);
    expect(evaluate()("fixedPositionY", 32)).toBe(511);
  });
  it.each([
    [0, 0, 0, 4096],
    [0, 1, 0, -4096],
    [0, 1, 1, 0],
    [-32768, 0, 0, -28672],
    [-32768, 1, 0, 28672],
    [123, 0, 0, 123],
  ])(
    "retains side-byte priority for angle %i and side bytes %i / %i",
    (contactAngle, sideFirst, sideSecond, expected) => {
      expect(evaluate({ contactAngle, sideFirst, sideSecond })("adjustedAngle")).toBe(expected);
    },
  );
  it("uses the contact type-five control override only when control is nonzero", () => {
    expect(evaluate({ ownCoefficient: -1, contactCoefficient: -2 })("coefficient")).toBe(-1);
    expect(evaluate({ ownCoefficient: -1, contactCoefficient: 3 })("coefficient")).toBe(3);
    expect(evaluate({ contactType: 5, contactControl: 0, ownCoefficient: 20 })("coefficient")).toBe(20);
    expect(evaluate({ contactType: 5, contactControl: 1, ownCoefficient: 20 })("coefficient")).toBe(256);
    expect(evaluate({ contactType: 4, contactControl: 1, ownCoefficient: 20 })("coefficient")).toBe(20);
  });
  it("retains the negative boundary of a word absolute value", () => {
    const stages = evaluate({ recordAcceleration: -32768 });
    expect(stages("absoluteAcceleration")).toBe(-32768);
    expect(stages("normalAcceleration")).toBe(-32768);
  });
  it("keeps wrapped damping at the signed word boundary", () => {
    const stages = evaluate({ recordAcceleration: -32768, ownCoefficient: 256 });
    expect(stages("damping")).toBe(-32768);
    expect(stages("dampingWithBias")).toBe(-32766);
    expect(stages("unlimitedVelocityX")).toBe(32766);
    expect(evaluate({ recordAcceleration: 32767, ownCoefficient: 256 })("dampingWithBias")).toBe(-32767);
  });
  it("gates projected velocity by the two nonzero signed directions", () => {
    const factors = { first: 0n, second: 16384n };
    expect(evaluate({ contactAngle: 123, velocityX: 10 }, factors)("directionalVelocity")).toBe(10);
    expect(evaluate({ contactAngle: -123, velocityX: -10 }, factors)("directionalVelocity")).toBe(-10);
    expect(evaluate({ contactAngle: 123, velocityX: -10 }, factors)("directionalVelocity")).toBe(0);
    expect(evaluate({ contactAngle: -123, velocityX: 10 }, factors)("directionalVelocity")).toBe(0);
    expect(evaluate({ contactAngle: 0, velocityX: 10 }, factors)("directionalVelocity")).toBe(0);
  });
  it.each([
    [100, 98],
    [-100, -98],
    [1, 0],
    [-1, 0],
    [0, 0],
  ])("damps the zero-acceleration velocity %i to %i", (velocityX, expected) => {
    expect(evaluate({ velocityX })("unlimitedVelocityX")).toBe(expected);
  });
  it("uses flag mask 32 to choose the larger damping bias", () => {
    expect(evaluate({ velocityX: 100, flags: 32 })("dampingWithBias")).toBe(32);
    expect(evaluate({ velocityX: 100, flags: 32 })("unlimitedVelocityX")).toBe(68);
    expect(evaluate({ velocityX: 100, flags: 16 })("dampingWithBias")).toBe(2);
  });
  it("keeps the limit's upper comparison first for a negative limit", () => {
    const stages = evaluate({ velocityX: 100, limit: -100 });
    expect(stages("limitedVelocityX")).toBe(-100);
    expect(stages("limitedVelocityY")).toBe(-100);
  });
  it.each([
    [0, 0, 511],
    [-1, 0, -1],
    [32767, 0, 16777215],
    [-32768, 0, -16776705],
    [0, -1, 0],
    [-1, -1, -512],
    [32767, -1, 16776704],
    [-32768, -1, -16777216],
  ])(
    "reconstructs fixed-point Y from position %i and record acceleration %i",
    (positionY, recordAcceleration, expected) => {
      expect(evaluate({ positionY, recordAcceleration })("fixedPositionY", 32)).toBe(expected);
    },
  );
  it("rejects a small field-writing routine without the complete response graph", () => {
    const image = new Uint8Array(0x1000);
    image.set([0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x89, 0x44, 54, 0x5d, 0xcb], 0x100);
    const code = readRoutineCode(image, { segment: 0, offset: 0x100, address: 0x100 }, 0);
    expect(
      discoverFirstContactResponse(code, new Map([[code.address, code]]), new Map(), image, 0x800, 0, 3),
    ).toBeUndefined();
    expect(
      discoverFirstContactResponse({ ...code, status: "partial" }, new Map(), new Map(), image, 0x800, 0, 3),
    ).toBeUndefined();
  });
});
