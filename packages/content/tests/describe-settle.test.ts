import { describe, expect, it } from "vitest";
import { choose, type BehaviourReport, type Expression, type Predicate } from "../src/read/behaviour.ts";
import { settleForType, tidyArithmetic, withOwnOverlaps } from "../src/read/describe-effects.ts";

const MEMBER = "overlap candidate at 0x1ac7e";
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const field = (offset: number, object = MEMBER): Expression => ({ kind: "field", object, offset, width: 16 });
const binary = (operator: string, left: Expression, right: Expression, width = 16): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width,
});
const compare = (operator: string, left: Expression, right: Expression) =>
  ({ kind: "compare", operator, left, right, signed: true }) as Extract<Predicate, { kind: "compare" }>;
/** A type table at 0x100 with records of 0x3a bytes; type 4 has mass 120 at +0x02. */
const table = {
  address: 0x100,
  stride: 0x3a,
  words: Array.from({ length: 6 }, (_, type) => Array.from({ length: 29 }, (_, n) => (n === 1 ? type * 30 : 0))),
} as unknown as BehaviourReport["typeTable"];
const record = (offset: number): Expression => ({
  kind: "table",
  segment: 0x10,
  offset,
  index: binary("*", field(4), constant(0x3a)),
  width: 16,
});
const overlapX: Expression = {
  kind: "field",
  object: `overlapX the query at 0x1abc7 found for ${MEMBER}`,
  offset: 0x7a,
  width: 16,
  unresolved: true,
} as Expression;

describe("settling a value for the found part's type", () => {
  it("reads the overlap its search stored as the part's own field", () => {
    expect(withOwnOverlaps(binary("-", constant(256), overlapX), MEMBER)).toEqual(
      binary("-", constant(256), field(0x7a)),
    );
    // Another part's overlap stays a run value.
    expect(withOwnOverlaps(overlapX, "member found by the loop at 0x10")).toBe(overlapX);
  });

  it("puts in the type's mass and takes a value kept within the part's own speed limit as the value inside", () => {
    const speed = binary("+", field(0x36), binary("s/", field(0x7a), record(0x02)));
    const limit = record(0x0a);
    const negative = binary("-", constant(0), limit);
    const kept = choose(compare(">", speed, limit), limit, choose(compare("<", speed, negative), negative, speed));
    const settled = settleForType(kept, MEMBER, 4, 4, table, { table: false });
    expect(settled.kept).toBe(true);
    expect(settled.value).toEqual(binary("+", field(0x36), binary("s/", field(0x7a), constant(120))));
    // A limit read for another type's record isn't the part's own: nothing is taken out.
    const other: Expression = { ...limit, index: constant(0x3a * 2) } as Expression;
    const negativeOther = binary("-", constant(0), other);
    const elsewhere = choose(
      compare(">", speed, other),
      other,
      choose(compare("<", speed, negativeOther), negativeOther, speed),
    );
    expect(settleForType(elsewhere, MEMBER, 4, 4, table, { table: false }).kept).toBe(false);
  });
});

describe("arithmetic as the words say it", () => {
  const word = field(0x7a, "part");
  it("reads a sign extended word as the word, and a 32-bit number past 2^31 as negative", () => {
    expect(tidyArithmetic(binary("-", binary("^", word, constant(0x8000), 32), constant(0x8000), 32))).toEqual(word);
    expect(tidyArithmetic(constant(2 ** 32 - 16, 32))).toEqual(binary("-", constant(0, 32), constant(16, 32), 32));
  });

  it("scales a product shifted by a power of two its number is a multiple of, keeping the sign", () => {
    const shifted = (c: number) => binary(">>", binary("*", constant(c, 32), word, 32), constant(8, 8), 32);
    expect(tidyArithmetic(shifted(4096))).toEqual(binary("*", constant(16, 32), word, 32));
    expect(tidyArithmetic(shifted(2 ** 32 - 4096))).toEqual(
      binary("*", binary("-", constant(0, 32), constant(16, 32), 32), word, 32),
    );
    // 100 isn't a multiple of 256: the shift stays.
    expect(tidyArithmetic(shifted(100))).toEqual(shifted(100));
  });

  it("drops products by 1 or 0, a division by 1, and a low-word mask where 16-bit arithmetic wraps anyway", () => {
    const x = field(0x36, "part");
    expect(tidyArithmetic(binary("*", constant(1), x, 16))).toEqual(x);
    expect(tidyArithmetic(binary("+", binary("*", constant(0), x, 16), x, 16))).toEqual(x);
    expect(tidyArithmetic(binary("s/", x, constant(1), 16))).toEqual(x);
    const product = binary("*", constant(48, 32), word, 32);
    const low = binary("&", product, constant(0xffff), 16);
    expect(tidyArithmetic(binary("-", x, low, 16))).toEqual(binary("-", x, product, 16));
    // A shift right sees the low word's sign, which the 32-bit product doesn't have: the mask stays.
    expect(tidyArithmetic(binary(">>", low, constant(1, 8), 16))).toEqual(binary(">>", low, constant(1, 8), 16));
  });

  it("reads the low word of a signed quotient as the quotient, written ÷", () => {
    const quotient = binary("s/", word, constant(40, 32), 32);
    expect(tidyArithmetic(binary("&", quotient, constant(0xffff), 16))).toEqual({ ...quotient, operator: "÷" });
  });
});
