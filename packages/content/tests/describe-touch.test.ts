import { describe, expect, it } from "vitest";
import type { Expression, Predicate } from "../src/read/behaviour.ts";
import { joinPaths, longPart, predicatesOf, testsInWords, testsOf, type Names } from "../src/read/describe-touch.ts";

const c = (value: number, width = 16): Expression => ({ kind: "constant", value: value & (2 ** width - 1), width });
const f = (offset: number, object = "collider"): Expression => ({ kind: "field", object, offset, width: 16 });
const compare = (left: Expression, operator: string, value: number, signed = true): Predicate => ({
  kind: "compare",
  operator,
  left,
  right: c(value),
  signed,
});
const names: Names = { field: (offset) => `+0x${offset.toString(16)}`, of: (object, what) => `${object}.${what}` };
const words = (terms: Predicate[]) => testsInWords(testsOf(terms)!)!.map((t) => t.words(names));

describe("touch tests", () => {
  it("says the values one expression may take in short", () => {
    expect(words([compare(f(0x8a), "!=", 0), compare(f(0x8a), "==", 2)])).toEqual(["collider.+0x8a is 2"]);
    expect(words([compare(f(0x12, "part"), ">=", 0), compare(f(0x12, "part"), ">", 0)])).toEqual([
      "part.+0x12 is at least 1",
    ]);
    expect(words([compare(f(0x88), ">=", -2048), compare(f(0x88), "<=", 2048)])).toEqual([
      "collider.+0x88 is between -2048 and 2048",
    ]);
  });

  it("reads a jump table index as the value it picks by, like the gear's contactEdge", () => {
    const bin = (operator: string, left: Expression, right: Expression): Expression => ({
      kind: "binary",
      operator,
      left,
      right,
      width: 16,
    });
    const edge = f(0x8a);
    // `cmp bx, 7; ja` then `jmp [bx*2 + table]`: contactEdge at most 7, and its index (contactEdge << 1) is 4.
    expect(words([compare(edge, "<=", 7, false), compare(bin("<<", edge, c(1)), "==", 4, false)])).toEqual([
      "collider.+0x8a is 2",
    ]);
    // A masked value is always at most 7, so that test drops out.
    const masked = bin("&", bin("+", edge, c(4)), c(7));
    expect(words([compare(masked, "<=", 7, false), compare(bin("<<", masked, c(1)), "==", 12, false)])).toEqual([
      "(collider.+0x8a + 4) & 0x0007 is 6",
    ]);
    // Without a bound the shift may lose a bit, and the test stays as it is.
    expect(words([compare(bin("<<", edge, c(1)), "==", 4, false)])).toEqual(["collider.+0x8a << 1 is 4"]);
  });

  it("joins paths whose tests differ in one expression only, and drops a test every value passes", () => {
    const edge = (n: number) => compare(f(0x8a), "==", n, false);
    const below = compare(f(0x88), "<", -2048);
    const above = compare(f(0x88), ">", 2048);
    const joined = joinPaths(
      [below, above].map((angle) => ({ tests: testsOf([edge(2), angle])!, value: [angle] })),
      (into, from) => into.push(...from),
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]!.joined).toBe(true);
    expect(testsInWords(joined[0]!.tests)!.map((t) => t.words(names))).toEqual([
      "collider.+0x8a is 2",
      "collider.+0x88 is not between -2048 and 2048",
    ]);
    // Both sides of a test together let every value through: the test drops out.
    const all = joinPaths(
      [compare(f(0x38), "<", 1536), compare(f(0x38), ">=", 1536)].map((t) => ({
        tests: testsOf([edge(0), t])!,
        value: 0,
      })),
      () => {},
    );
    expect(predicatesOf(all[0]!.tests)).toEqual([compare(f(0x8a), "==", 0, false)]);
  });

  it("keeps paths apart when their joined tests aren't one range", () => {
    const joined = joinPaths(
      [0, 5].map((n) => ({ tests: testsOf([compare(f(0x8a), "==", n, false)])!, value: n })),
      () => {},
    );
    expect(joined).toHaveLength(2);
  });

  it("reads the two words of a long set from a word times a power of two", () => {
    const word = f(0x20);
    const widened: Expression = {
      kind: "binary",
      operator: "|",
      left: {
        kind: "binary",
        operator: "<<",
        left: { kind: "binary", operator: ">>", left: word, right: c(15), width: 16 },
        right: c(16),
        width: 32,
      },
      right: word,
      width: 32,
    };
    const shifted: Expression = { kind: "binary", operator: "<<", left: widened, right: c(9), width: 32 };
    const low: Expression = { kind: "binary", operator: "&", left: shifted, right: c(0xffff), width: 16 };
    const high: Expression = {
      kind: "binary",
      operator: "&",
      left: { kind: "binary", operator: ">>>", left: shifted, right: c(16), width: 32 },
      right: c(0xffff),
      width: 16,
    };
    expect(longPart(low)).toEqual({ word, shift: 9, high: false });
    expect(longPart(high)).toEqual({ word, shift: 9, high: true });
    expect(longPart(word)).toBeUndefined();
  });
});
