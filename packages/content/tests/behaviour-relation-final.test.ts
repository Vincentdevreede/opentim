import { describe, expect, it } from "vitest";
import { analyseRoutine, chooseByTests, type Expression, type Predicate } from "../src/read/behaviour.ts";
import { engineFromObjectRelation } from "../src/read/behaviour-geometry-relations.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

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
  it("gives a field one way leaves alone its value as it was on that way", () => {
    // test byte [si+8], 0x10; jz; mov byte [si+0x72], 62; ret
    const image = Uint8Array.from([
      0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xf6, 0x44, 8, 0x10, 0x74, 4, 0xc6, 0x44, 0x72, 62, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 });
    const engine = engineFromObjectRelation(routine, layout, new Map());
    const writes = engine?.writes.filter((write) => write.offset === 0x72) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]!.condition).toEqual({ kind: "true" });
    // A choice between 62 and the field itself.
    expect(JSON.stringify(writes[0]!.value)).toContain('"object":"part","offset":114');
  });
  it("splits on any test the ways all make, in whatever order the code makes them", () => {
    const other: Predicate = { ...flag, left: { kind: "field", object: "part", offset: 10, width: 16 } };
    // The first way's first test isn't on the last way, but the second test is on every way.
    const value = chooseByTests(
      [
        { tests: [other, flag], value: number(1) },
        { tests: [not(other), flag], value: number(2) },
        { tests: [not(flag)], value: number(3) },
      ],
      16,
    );
    expect(value?.kind).toBe("binary");
  });
  it("gives a caller the field exactly when the helper also makes a part and changes the state", () => {
    const copy: EngineSummary = {
      ...proof,
      address: 0x200,
      kind: "part-copy",
      purpose: "Synthetic part copy.",
      argumentOffset: 6,
      argumentKind: "object",
      writes: [],
      returns: [],
      returnPointerClass: "nullable-fresh",
      calls: [],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      },
    };
    // The helper at 0x100 copies the part and sets the copy's x, so a caller can't take its ways one by one; then it
    // sets the state to 5 and 0x72 by the flip flag. The caller at 0 calls it with its part.
    const image = new Uint8Array(0x300);
    image.set(
      [
        ...[0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 2, 0, 0, 0x59],
        ...[0x8b, 0xf8, 0x0b, 0xc0, 0x74, 5, 0xc7, 0x45, 0x1e, 5, 0, 0xc7, 0x44, 12, 5, 0],
        ...[0xf6, 0x44, 8, 0x10, 0x74, 6, 0xc6, 0x44, 0x72, 62, 0xeb, 4, 0xc6, 0x44, 0x72, 1, 0x5f, 0x5e, 0x5d, 0xcb],
      ],
      0x100,
    );
    image[0x200] = 0xcb;
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 1, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
    const helpers = new Map([[0x200, copy]]);
    const helper = analyseRoutine(image, { address: 0x100, segment: 0, offset: 0x100 }, { engineSummaries: helpers });
    const engine = engineFromObjectRelation(helper, layout, helpers)!;
    expect(engine.footprint.preservesPartState).toBe(false);
    const caller = analyseRoutine(
      image,
      { address: 0, segment: 0, offset: 0 },
      { summaries: new Map([[0x100, helper]]), engineSummaries: new Map([...helpers, [0x100, engine]]) },
    );
    expect(caller.outcomes).toHaveLength(1);
    const field = caller.outcomes![0]!.fields.find((f) => f.object === "part" && f.offset === 0x72)!;
    expect(field.value.kind).toBe("binary");
    expect(caller.transitions[0]!.to).toMatchObject({ kind: "constant", value: 5 });
  });
  it("composes a large helper value into a caller, like a drawing position the frame drawing helper set", () => {
    // Helper at 0x100: [si+0x2a] = [si+0x10] + 45 times [si+0x12]. Caller at 0: [si+0x12] = [si+0x20] + [si+0x22], then
    // calls it, so the composed value is larger than the usual budget.
    const image = new Uint8Array(0x300);
    const adds = Array.from({ length: 45 }, () => [0x03, 0x44, 0x12]).flat();
    image.set([0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x8b, 0x44, 0x10, ...adds, 0x89, 0x44, 0x2a, 0x5d, 0xcb], 0x100);
    image.set([
      ...[0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x8b, 0x44, 0x20, 0x03, 0x44, 0x22, 0x89, 0x44, 0x12],
      ...[0x56, 0x9a, 0, 1, 0, 0, 0x59, 0x5e, 0x5d, 0xcb],
    ]);
    const helper = analyseRoutine(image, { address: 0x100, segment: 0, offset: 0x100 });
    expect(helper.outcomes![0]!.fields.find((f) => f.offset === 0x2a)!.value.kind).toBe("binary");
    const caller = analyseRoutine(
      image,
      { address: 0, segment: 0, offset: 0 },
      { summaries: new Map([[0x100, helper]]) },
    );
    const field = caller.outcomes![0]!.fields.find((f) => f.object === "part" && f.offset === 0x2a)!;
    expect(field.value.kind).toBe("binary");
  });
});
