import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { engineFromObjectRelation } from "../src/read/behaviour-geometry-relations.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
const proof = { confidence: "inferred" as const, evidence: [], assumptions: [] };
const layout: BehaviourLayout = {
  ...proof,
  callbacks: [],
  objectArgument: { ...proof, offset: 6 },
  diagnostics: [],
  fields: [
    { ...proof, name: "state", offset: 12 },
    { ...proof, name: "outlinePoints", offset: 0x62 },
  ],
};
function fixture(field = 0x62, replace = false) {
  const image = new Uint8Array(0x300),
    address = 0x100;
  image.set(
    [
      0x55,
      0x8b,
      0xec,
      0x56,
      0x57,
      0x8b,
      0x76,
      6,
      0x8b,
      0x7c,
      field,
      0xc6,
      5,
      9,
      ...(replace ? [0xc7, 0x44, field, 0, 0] : []),
      0xc7,
      0x44,
      12,
      11,
      0,
      0x5f,
      0x5e,
      0x5d,
      0xcb,
    ],
    address,
  );
  const routine = analyseRoutine(image, { address, segment: 0, offset: address });
  return { image, routine, engine: engineFromObjectRelation(routine, layout, new Map()) };
}
describe("owner and outline return relations", () => {
  it("retains state writes separately from buffer writes and composes both destinations", () => {
    const f = fixture();
    expect(f.engine).toBeDefined();
    expect(f.engine!.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: false });
    expect(f.engine!.writes.some((w) => w.separateStorage === "outline" && w.path[0] === 0x62)).toBe(true);
    f.image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 1, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
    const caller = analyseRoutine(
      f.image,
      { address: 0, segment: 0, offset: 0 },
      { summaries: new Map([[0x100, f.routine]]), engineSummaries: new Map([[0x100, f.engine!]]) },
    );
    expect(caller.transitions[0]!.to).toMatchObject({ kind: "constant", value: 11 });
    expect(caller.writes.some((w) => w.object === "referenced-by(part+0x62)" && w.offset === 0)).toBe(true);
    expect(caller.uncertainties).toEqual([]);
  });
  it("rejects a different linked-object pointer and a changed outline pointer", () => {
    expect(fixture(0x64).engine).toBeUndefined();
    expect(fixture(0x62, true).engine).toBeUndefined();
  });
  it("requires complete effects and return coverage", () => {
    const f = fixture();
    f.routine.returnPathsComplete = false;
    expect(engineFromObjectRelation(f.routine, layout, new Map())).toBeUndefined();
  });
});

describe("complete owner-field relations", () => {
  it("gives a state it sets on one way a choice with the state as it was, without requiring an outline store", () => {
    const image = Uint8Array.from([
      0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x83, 0x7c, 0x12, 0, 0x74, 5, 0xc7, 0x44, 12, 3, 0, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 });
    const engine = engineFromObjectRelation(routine, layout, new Map());
    expect(engine?.kind).toBe("owner-field-relation");
    expect(engine?.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: false });
    const state = engine?.writes.filter((write) => write.offset === 12) ?? [];
    expect(state).toHaveLength(1);
    expect(state[0]!.condition).toEqual({ kind: "true" });
    expect(JSON.stringify(state[0]!.value)).toContain('"object":"part","offset":12');
    expect(engine?.writes.every((write) => write.root === "argument" && !write.path.length)).toBe(true);
  });

  it("retains caller evidence and refuses unknown destinations", () => {
    const image = Uint8Array.from([
      0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x8b, 0x7c, 0x64, 0xc7, 0x45, 12, 1, 0, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 });
    expect(engineFromObjectRelation(routine, layout, new Map())).toBeUndefined();
  });
});

describe("relations that make a part copy", () => {
  const copy = (kind = "part-copy"): EngineSummary => ({
    ...proof,
    address: 0x200,
    kind,
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
  });
  /** Copies the part, writes the copy's x and the part's width, and may store the copy's address in the part. */
  function relation(helper: EngineSummary, storesCopy = false) {
    const image = new Uint8Array(0x300);
    const store = storesCopy ? [0x89, 0x7c, 0x50] : [];
    image.set([
      ...[0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 2, 0, 0, 0x59, 0x8b, 0xf8, 0x0b, 0xc0],
      ...[0x74, 10 + store.length, 0xc7, 0x45, 0x1e, 5, 0, 0xc7, 0x44, 0x44, 3, 0, ...store],
      ...[0x5f, 0x5e, 0x5d, 0xcb],
    ]);
    image[0x200] = 0xcb;
    const helpers = new Map([[0x200, helper]]);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { engineSummaries: helpers });
    return engineFromObjectRelation(routine, layout, helpers);
  }

  it("leaves out the writes to the fresh copy and keeps the part's", () => {
    const engine = relation(copy());
    expect(engine?.writes.map((write) => [write.root, write.offset])).toEqual([["argument", 0x44]]);
    expect(engine?.assumptions.join(" ")).toContain("stay in that fresh memory");
  });

  it("refuses a copy whose address the part keeps, and memory that isn't a part copy", () => {
    expect(relation(copy(), true)).toBeUndefined();
    expect(relation(copy("nullable-allocation"))).toBeUndefined();
  });
});
