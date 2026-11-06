import { describe, expect, it } from "vitest";
import { analyseRoutine, chooseByTests, type Expression, type Predicate } from "../src/read/behaviour.ts";
import { engineFromObjectRelation } from "../src/read/behaviour-geometry-relations.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const proof = { confidence: "inferred" as const, evidence: [], assumptions: [] };
const layout: BehaviourLayout = {
  ...proof,
  callbacks: [],
  objectArgument: { ...proof, offset: 6 },
  diagnostics: [],
  fields: [{ ...proof, name: "state", offset: 12 }],
};
const number = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const flag: Predicate = {
  kind: "compare",
  operator: "==",
  left: { kind: "field", object: "part", offset: 8, width: 16 },
  right: number(0),
  signed: false,
};
const not = (p: Predicate): Predicate =>
  p.kind === "compare" ? { ...p, operator: p.operator === "==" ? "!=" : "==" } : p;

describe("the value a routine leaves in a field", () => {
  it("chooses by the tests when the ways split like a tree", () => {
    const value = chooseByTests(
      [
        { tests: [flag], value: number(1) },
        { tests: [not(flag)], value: number(62) },
      ],
      8,
    );
    expect(value?.kind).toBe("binary");
    // A side without a way, or a way without the test, leaves it open.
    expect(chooseByTests([{ tests: [flag], value: number(1) }], 8)).toBeUndefined();
    expect(
      chooseByTests(
        [
          { tests: [flag], value: number(1) },
          { tests: [], value: number(62) },
        ],
        8,
      ),
    ).toBeUndefined();
  });
  it("gives a relation one exact write per field that every way sets", () => {
    // test byte [si+8], 0x10; jz; mov byte [si+0x72], 62; jmp; mov byte [si+0x72], 1; ret
    const image = Uint8Array.from([
      0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xf6, 0x44, 8, 0x10, 0x74, 6, 0xc6, 0x44, 0x72, 62, 0xeb, 4, 0xc6, 0x44, 0x72, 1,
      0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 });
    const engine = engineFromObjectRelation(routine, layout, new Map());
    const writes = engine?.writes.filter((write) => write.offset === 0x72) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]!.condition).toEqual({ kind: "true" });
    expect(writes[0]!.value.kind).toBe("binary");
  });
  it("keeps the conditional writes of a field that one way leaves alone", () => {
    // test byte [si+8], 0x10; jz; mov byte [si+0x72], 62; ret
    const image = Uint8Array.from([
      0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xf6, 0x44, 8, 0x10, 0x74, 4, 0xc6, 0x44, 0x72, 62, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 });
    const engine = engineFromObjectRelation(routine, layout, new Map());
    const writes = engine?.writes.filter((write) => write.offset === 0x72) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]!.condition.kind).not.toBe("true");
  });
});
