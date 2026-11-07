import { describe, expect, it } from "vitest";
import { analyseRoutine, binary, choiceOf, choose, transitionCounts } from "../src/read/behaviour.ts";
import type { Expression, Predicate } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const field = (offset: number, width = 16): Expression => ({ kind: "field", object: "part", offset, width });
const compare = (operator: string, left: Expression, right: Expression, signed = false) =>
  ({ kind: "compare", operator, left, right, signed }) as Extract<Predicate, { kind: "compare" }>;

/** The number a value has when the part's fields have these numbers, folded the way the analysis folds constants. */
function evaluate(e: Expression, fields: Record<number, number>): number {
  const put = (e: Expression): Expression =>
    e.kind === "field"
      ? constant(fields[e.offset]!, e.width)
      : e.kind === "binary"
        ? binary(e.operator, put(e.left), put(e.right), e.width)
        : e;
  const value = put(e);
  if (value.kind !== "constant") throw new Error("not a number");
  return value.value;
}

/** Tests field 0x10 with `jl`, a signed test, and stores 3 or 7 at 0x12; both paths keep the frame. */
function signedTestRoutine() {
  const image = new Uint8Array(0x40);
  // prettier-ignore
  image.set([
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; mov si,[bp+6]
    0x83, 0x7c, 0x10, 5, // cmp word [si+0x10],5
    0x7c, 7, // jl below
    0xc7, 0x44, 0x12, 3, 0, // mov word [si+0x12],3
    0xeb, 5, // jmp done
    0xc7, 0x44, 0x12, 7, 0, // below: mov word [si+0x12],7
    0x5e, 0x5d, 0xcb, // done: pop si; pop bp; retf
  ]);
  return image;
}

describe("values chosen by a test", () => {
  it("gives the value of the side whose test holds", () => {
    const value = choose(compare("==", field(0x10), constant(4)), constant(3), constant(5));
    expect(evaluate(value, { 0x10: 4 })).toBe(3);
    expect(evaluate(value, { 0x10: 9 })).toBe(5);
  });

  it("orders a signed test by sign, like jl and jg do", () => {
    const value = choose(compare("<", field(0x10), constant(5), true), constant(7), constant(3));
    expect(evaluate(value, { 0x10: 0xfffe })).toBe(7); // -2 is below 5
    expect(evaluate(value, { 0x10: 4 })).toBe(7);
    expect(evaluate(value, { 0x10: 5 })).toBe(3);
    expect(evaluate(value, { 0x10: 0x7fff })).toBe(3);
    // Unsigned, 0xfffe is above 5.
    const plain = choose(compare("<", field(0x10), constant(5)), constant(7), constant(3));
    expect(evaluate(plain, { 0x10: 0xfffe })).toBe(3);
  });

  it("orders a signed byte by its own sign bit", () => {
    const value = choose(compare(">", field(0x10, 8), constant(0, 8), true), constant(1, 8), constant(2, 8), 8);
    expect(evaluate(value, { 0x10: 0x80 })).toBe(2); // -128
    expect(evaluate(value, { 0x10: 0x7f })).toBe(1);
  });

  it("gives the test and both values back", () => {
    const signed = compare(">=", field(0x10), field(0x14), true);
    expect(choiceOf(choose(signed, field(0x12), constant(0)))).toEqual({
      test: signed,
      then: field(0x12),
      otherwise: constant(0),
    });
    const withNumber = compare("<", field(0x10), constant(0xfffb), true);
    expect(choiceOf(choose(withNumber, constant(1), constant(2)))?.test).toEqual(withNumber);
    expect(choiceOf(binary("+", field(0x10), constant(1)))).toBeUndefined();
  });

  it("keeps an unknown value unknown, with its own reason", () => {
    const lost: Expression = { kind: "unknown", reason: "A connected part may change this field", width: 16 };
    expect(choose(compare("==", field(0x10), constant(0)), constant(1), lost)).toEqual(lost);
    expect(choose(compare("==", lost, constant(0)), constant(1), constant(2))).toEqual(lost);
    expect(choose(compare("==", field(0x10), constant(0)), constant(1), constant(1))).toEqual(constant(1));
  });

  it("joins two paths that set a field differently into one rule that keeps both values", () => {
    const routine = analyseRoutine(signedTestRoutine(), entry, { stateCount: 4 });
    expect(routine.transitions).toHaveLength(1);
    const [rule] = routine.transitions;
    const write = rule!.updates?.find((update) => update.offset === 0x12);
    expect(write?.confidence).not.toBe("unresolved");
    expect(evaluate(write!.value, { 0x10: 0xfffe })).toBe(7);
    expect(evaluate(write!.value, { 0x10: 5 })).toBe(3);
    expect(choiceOf(write!.value)?.test.signed).toBe(true);
    expect(transitionCounts(routine.transitions).unknownWrites).toBe(0);
  });
});
