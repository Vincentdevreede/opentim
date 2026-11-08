import { describe, expect, it } from "vitest";
import { choose, type BehaviourReport, type Expression, type Predicate } from "../src/read/behaviour.ts";
import {
  keptWithin,
  rulesIgnoreLimit,
  speedLimitRange,
  settleForType,
  sourceChoices,
  splitBySource,
  tidyArithmetic,
  withOwnOverlaps,
} from "../src/read/describe-effects.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";

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

  it("gives the limit as a number for a type whose limit is the same in every level", () => {
    const speed = binary("+", field(0x36), constant(1536));
    const limit = record(0x0a);
    const negative = binary("-", constant(0), limit);
    const kept = choose(compare(">", speed, limit), limit, choose(compare("<", speed, negative), negative, speed));
    const withLimits = {
      ...table,
      speedLimits: { fixed: [{ type: 4, limit: 12288 }] },
    } as unknown as BehaviourReport["typeTable"];
    expect(settleForType(kept, MEMBER, 4, 4, withLimits, { table: false })).toEqual({
      value: speed,
      kept: true,
      limit: 12288,
    });
    // Another type's limit is still worked out for each level.
    expect(settleForType(kept, MEMBER, 4, 5, withLimits, { table: false }).limit).toBeUndefined();
  });

  it("gives a type the routine doesn't fix the range of limits the air pressures a level can have give", () => {
    const speed = binary("+", field(0x38), constant(1536));
    const limit = record(0x0a);
    const negative = binary("-", constant(0), limit);
    const kept = choose(compare(">", speed, limit), limit, choose(compare("<", speed, negative), negative, speed));
    const withLimits = {
      ...table,
      speedLimits: { fixed: [], base: 9728, air: { address: 0x4cb7, split: 70, below: 1, above: 4 } },
    } as unknown as BehaviourReport["typeTable"];
    expect(speedLimitRange(withLimits)).toEqual({ min: 7680, max: 9728 });
    expect(settleForType(kept, MEMBER, 4, 4, withLimits, { table: false }).range).toEqual({ min: 7680, max: 9728 });
  });

  it("knows when a part's rules can't tell the limits of the range apart", () => {
    const speed = field(0x38, "part");
    const absolute = binary(
      "-",
      binary("^", speed, binary(">>", speed, constant(15))),
      binary(">>", speed, constant(15)),
    );
    const range = { min: 7680, max: 9728 };
    const rules = (condition: Predicate, updates: unknown[] = []) => ({
      transitions: [{ from: 0, to: constant(1), condition, updates }],
    });
    const fast = compare(">", absolute, constant(1536));
    // Mel's: whether he moves faster than 1536, a note whether faster than 7168, and the speed kept or cleared.
    const mel = rules(fast, [
      {
        offset: 0x9c,
        value: choose(compare(">", speed, constant(7168)), constant(1), constant(0)),
        condition: { kind: "true" },
      },
      {
        offset: 0x38,
        value: choose(compare("!=", field(0x88, "collider"), constant(0)), speed, constant(0)),
        condition: { kind: "true" },
      },
    ]);
    const ignore = (part: object) =>
      rulesIgnoreLimit(part as Parameters<typeof rulesIgnoreLimit>[0], 0x38, range, evaluateBehaviourCondition);
    expect(ignore(mel)).toBe(true);
    // A test inside the range, or a speed stored elsewhere, tells them apart.
    expect(ignore(rules(compare(">", absolute, constant(8000))))).toBe(false);
    expect(ignore(rules(fast, [{ offset: 0x9c, value: speed, condition: { kind: "true" } }]))).toBe(false);
  });

  it("keeps a value within a limit that is a number as the speed limit routine does", () => {
    const value = keptWithin(field(0x36, "part"), 12288);
    const word = (n: number) => ((n % 0x10000) + 0x10000) % 0x10000;
    // Whether the value is `expected` when velocityX is `speed`.
    const is = (speed: number, expected: number) =>
      evaluateBehaviourCondition({ ...compare("==", value, constant(word(expected))), signed: false }, [
        { object: "part", offset: 0x36, width: 16, value: word(speed), knownMask: 0xffff },
      ]);
    expect(is(12288 + 1536, 12288)).toBe(true);
    expect(is(12288, 12288)).toBe(true);
    expect(is(100, 100)).toBe(true);
    expect(is(-12288, -12288)).toBe(true);
    expect(is(-12288 - 1536, -12288)).toBe(true);
    expect(is(12288 - 1536, 12288)).toBe(false);
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
    // A 32-bit factor can make the product wrap: (2 × x) >> 1 is -1 for x = 0x7fffffff, so the shift stays.
    const long: Expression = { ...field(0x7a, "part"), width: 32 };
    const wraps = binary(">>", binary("*", constant(2, 32), long, 32), constant(1, 8), 32);
    expect(tidyArithmetic(wraps)).toEqual(wraps);
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

describe("values that pick by the source's tests", () => {
  const delta = field(0x12);
  const mirrored = (set: boolean) => compare(set ? "!=" : "==", binary("&", field(8), constant(0x10)), constant(0));
  // The jack-in-the-box tilts the bellows by which side of the bellows' positionX + 12 its centre X is on.
  const near = compare("<", binary("+", field(0x1e), constant(12)), field(0x1e, "part"));
  const tilt = choose(near, constant(1), delta);
  const value = choose(mirrored(true), tilt, choose(mirrored(false), constant(1), delta));

  it("splits a value by the tests that read the source, and keeps one that reads only the part", () => {
    expect(sourceChoices(tilt)).toEqual([
      { tests: [near], value: constant(1) },
      { tests: [{ ...near, operator: ">=" }], value: delta },
    ]);
    const kept = choose(compare(">", delta, constant(4)), constant(4), delta);
    expect(sourceChoices(kept)).toEqual([{ tests: [], value: kept }]);
  });

  it("gives a way for each case, without one that changes nothing or whose tests contradict", () => {
    const outcome = {
      condition: compare("==", field(4), constant(16)),
      fields: [{ object: MEMBER, offset: 0x12, width: 16, value, condition: { kind: "true" } }],
    } as unknown as Parameters<typeof splitBySource>[0];
    const ways = splitBySource(outcome, MEMBER);
    const flag = (operator: string) => ({ ...mirrored(true), operator, signed: false });
    expect(ways.map((w) => w.condition)).toEqual([
      { kind: "and", terms: [outcome.condition, flag("!="), near] },
      { kind: "and", terms: [outcome.condition, flag("!="), { ...near, operator: ">=" }] },
      { kind: "and", terms: [outcome.condition, flag("==")] },
    ]);
    // Past the bellows it tilts it; short of it, it leaves stateDelta as it was; not mirrored, the inner choice reads
    // only the bellows and stays one value.
    expect(ways.map((w) => w.fields.map((f) => f.value))).toEqual([
      [constant(1)],
      [],
      [choose(mirrored(false), constant(1), delta)],
    ]);
  });
});
