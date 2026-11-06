import { describe, expect, it } from "vitest";
import { analyseRoutine, speedLimitOf, type Expression, type Predicate } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const limit: Expression = {
  kind: "table",
  segment: 0x200,
  offset: 10,
  index: {
    kind: "binary",
    operator: "*",
    left: field(4),
    right: { kind: "constant", value: 58, width: 16 },
    width: 16,
  },
  width: 16,
};
const negative: Expression = {
  kind: "binary",
  operator: "-",
  left: { kind: "constant", value: 0, width: 16 },
  right: limit,
  width: 16,
};
const compare = (operator: string, left: Expression, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: true,
});
/** The speed limit as its matcher gives it: two cases per speed, vertical first. */
function limiter(): EngineSummary {
  const cases = [56, 54].flatMap((offset) => [
    { field: offset, condition: compare(">", field(offset), limit), value: limit },
    {
      field: offset,
      condition: {
        kind: "and" as const,
        terms: [compare("<=", field(offset), limit), compare("<", field(offset), negative)],
      },
      value: negative,
    },
  ]);
  return {
    ...fact,
    address: 0x100,
    kind: "contact-velocity-limit",
    purpose: "Limits the speeds.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    writes: cases.map((c) => ({
      ...fact,
      root: "argument" as const,
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
    },
    contactResponse: {
      kind: "velocity-limit",
      ownerArgument: 6,
      typeField: 4,
      fields: [56, 54],
      table: { segment: 0x200, offset: 0, stride: 58, limitField: 10, typeCount: 3 },
      cases,
      order: "verticalThenHorizontal",
      comparisons: "signedWordsUpperBranchFirst",
      tableReads: "runtime",
    },
  };
}
// push si; call far 0000:0100; pop cx
const call = [0x56, 0x9a, 0, 1, 0, 0, 0x59];
function analyse(body: number[], summary: EngineSummary) {
  const image = new Uint8Array(0x120);
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...body, 0x5e, 0x5d, 0xcb]);
  image[0x100] = 0xcb;
  return analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { engineSummaries: new Map([[0x100, summary]]) });
}
const word = (n: number) => [n & 255, (n >>> 8) & 255];
/** A value worked out for the given speed, type limit and other fields, as signed words. */
function evaluate(e: Expression, speed: number, bound: number): number {
  const w = (n: number) => n & 0xffff;
  switch (e.kind) {
    case "constant":
      return w(e.value);
    case "field":
      return w(e.offset === 0x36 ? speed : 0);
    case "table":
      return w(bound);
    case "binary": {
      const [a, b] = [evaluate(e.left, speed, bound), evaluate(e.right, speed, bound)];
      const result: Record<string, number> = {
        "+": a + b,
        "-": a - b,
        "*": a * b,
        "^": a ^ b,
        ">": +(a > b),
        "<": +(a < b),
        ">=": +(a >= b),
        "<=": +(a <= b),
      };
      if (!(e.operator in result)) throw Error(`Unexpected operator ${e.operator}`);
      return w(result[e.operator]!);
    }
    default:
      throw Error(`Unexpected ${e.kind}`);
  }
}
const signed = (n: number) => (n >= 0x8000 ? n - 0x10000 : n);

describe("The speed limit", () => {
  it("gives each speed exactly: the limit above it, minus the limit below minus it, else the speed", () => {
    const result = analyse(call, limiter());
    const speed = result.outcomes![0]!.fields.find((f) => f.object === "part" && f.offset === 0x36)!.value;
    expect(speed.kind).not.toBe("unknown");
    expect(speedLimitOf(speed)).toEqual({ speed: field(0x36), limit });
    for (const bound of [-100, -1, 0, 1, 100, 32767])
      for (const input of [-32768, -101, -100, -1, 0, 1, 99, 100, 101, 32767]) {
        const expected = input > bound ? bound : input < signed(-bound & 0xffff) ? -bound : input;
        expect(signed(evaluate(speed, input & 0xffff, bound & 0xffff))).toBe(signed(expected & 0xffff));
      }
  });
  it("puts a known speed into the limit", () => {
    // mov word [si+0x36], 0x3000 before the call
    const result = analyse([0xc7, 0x44, 0x36, ...word(0x3000), ...call], limiter());
    const speed = result.outcomes![0]!.fields.find((f) => f.object === "part" && f.offset === 0x36)!.value;
    expect(speedLimitOf(speed)?.speed).toEqual({ kind: "constant", value: 0x3000, width: 16 });
  });
});
