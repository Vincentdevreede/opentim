import { describe, expect, it } from "vitest";
import { discoverCreationDefaults } from "../src/read/behaviour-creation.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const finding = { confidence: "checked" as const, evidence: [], assumptions: [] };
const preserved = {
  complete: true,
  partMemoryComplete: true,
  preservesArgumentMemory: true,
  preservesPartState: true,
  unknownEffects: [],
};
function helper(address: number, extra: Partial<EngineSummary> = {}): EngineSummary {
  return {
    ...finding,
    address,
    kind: "read-only",
    purpose: "Synthetic helper.",
    argumentOffset: 6,
    argumentKind: "object",
    writes: [],
    returns: [],
    calls: [],
    footprint: preserved,
    ...extra,
  };
}
function fixture(constructor: number[], offset = 0x30, shift = 0) {
  const image = new Uint8Array(0x1000);
  const factory = 0x100 + shift,
    allocator = 0x80 + shift,
    entry = 0x200 + shift,
    table = 0x500 + shift;
  image.set(
    [
      0x55,
      0x8b,
      0xec,
      0x9a,
      allocator & 255,
      allocator >> 8,
      0,
      0,
      0x8b,
      0xf0,
      0x56,
      0xff,
      0x9f,
      table & 255,
      table >> 8,
      0x59,
      0x5d,
      0xcb,
    ],
    factory,
  );
  image.set(constructor, entry);
  image.set([entry & 255, entry >> 8, 0, 0], table);
  const engine = helper(factory, {
    kind: "part-factory",
    factory: {
      typeArgument: 6,
      constructorTable: { segment: 0, offset: table, stride: 16, typeCount: 2 },
      noConstructorTypes: [1],
      noConstructor: {
        ...finding,
        purpose: "Synthetic scoped allocator contract.",
        footprint: preserved,
        writes: [],
        freshFieldsOnly: true,
        initialState: { offset, value: 0 },
      },
    },
  });
  const layout: BehaviourLayout = {
    callbacks: [],
    objectArgument: { ...finding, offset: 6 },
    fields: [
      { ...finding, name: "state", offset },
      { ...finding, name: "savedState", offset: 0x70 },
      { ...finding, name: "stateDelta", offset: 0x12 },
    ],
    diagnostics: [],
  };
  return {
    image,
    engine,
    layout,
    allocator,
    entry,
    helpers: [engine, helper(allocator, { kind: "nullable-allocation" })],
  };
}
const prefix = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
const suffix = [0x5e, 0x5d, 0xcb];

describe("creation defaults", () => {
  it("uses only the factory's proved zero word through a masked constructor", () => {
    const f = fixture([...prefix, 0x83, 0x64, 0x30, 3, ...suffix]);
    const result = discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]!;
    expect(result.fields.map((f) => [f.name, f.value])).toEqual([["state", 0]]);
    delete f.engine.factory!.noConstructor.initialState;
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]!.fields).toEqual([]);
  });
  it("reads rebased far constructors and displaced literal fields without seeding loaded parts", () => {
    for (const [offset, shift] of [
      [0x30, 0],
      [0x32, 0x100],
    ]) {
      const f = fixture(
        [...prefix, 0xb8, 28, 0, 0x89, 0x44, offset!, 0x89, 0x44, 0x70, 0x33, 0xc0, 0x89, 0x44, 0x12, ...suffix],
        offset,
        shift,
      );
      const result = discoverCreationDefaults(f.image, f.helpers, f.layout, 0);
      expect(result[0]?.fields.map((field) => [field.name, field.value])).toEqual([
        ["state", 28],
        ["savedState", 28],
        ["stateDelta", 0],
      ]);
      expect(result[0]?.routine).toBe(f.entry);
      expect(result[0]?.fields[0]?.evidence.some((e) => e.text.includes("0x001c"))).toBe(true);
      expect(result[1]?.source).toBe("zeroed-allocation");
      expect(result[1]?.fields.map((field) => [field.name, field.value])).toEqual([["state", 0]]);
    }
  });

  it("requires a literal on every return path and does not invent a constructor default", () => {
    const f = fixture([...prefix, 0x83, 0x7e, 8, 0, 0x74, 5, 0xc7, 0x44, 0x30, 1, 0, ...suffix]);
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields).toEqual([]);
    const empty = fixture([...prefix, ...suffix]);
    delete empty.engine.factory!.noConstructor.initialState;
    expect(discoverCreationDefaults(empty.image, empty.helpers, empty.layout, 0)[0]?.fields).toEqual([]);
  });

  it("invalidates literals after unknown calls and after loss of the object pointer", () => {
    const f = fixture([...prefix, 0xc7, 0x44, 0x30, 7, 0, 0x9a, 0, 6, 0, 0, ...suffix]);
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields).toEqual([]);
    const lost = fixture([...prefix, 0x8b, 0x74, 0x60, 0xc7, 0x44, 0x30, 7, 0, ...suffix]);
    expect(discoverCreationDefaults(lost.image, lost.helpers, lost.layout, 0)[0]?.fields).toEqual([]);
  });

  it("keeps fields only when a complete called footprint excludes their bytes", () => {
    const f = fixture([
      ...prefix,
      0xb8,
      9,
      0,
      0x89,
      0x44,
      0x30,
      0x89,
      0x44,
      0x70,
      0x56,
      0x9a,
      0,
      6,
      0,
      0,
      0x59,
      ...suffix,
    ]);
    f.helpers.push(
      helper(0x600, {
        footprint: { ...preserved, preservesArgumentMemory: false },
        writes: [
          {
            ...finding,
            argumentOffset: 6,
            root: "argument",
            path: [],
            offset: 0x70,
            width: 16,
            value: { kind: "unknown", width: 16, reason: "Conditional store." },
            condition: { kind: "true" },
          },
        ],
      }),
    );
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields.map((field) => field.name)).toEqual([
      "state",
    ]);
  });

  it("proves narrow related-buffer helpers separately from owner stores", () => {
    const f = fixture([...prefix, 0xc7, 0x44, 0x30, 28, 0, 0x56, 0x9a, 0, 6, 0, 0, 0x59, ...suffix]);
    f.image.set([...prefix, 0x8b, 0x7c, 0x62, 0xc6, 0x05, 4, 0x83, 0xc7, 4, 0xc6, 0x45, 1, 8, ...suffix], 0x600);
    f.helpers.push(
      helper(0x700, {
        kind: "geometry-edge-data",
        footprint: { ...preserved, preservesArgumentMemory: false },
        writes: [
          {
            ...finding,
            argumentOffset: 6,
            root: "argument",
            path: [0x62],
            offset: 2,
            width: 16,
            value: { kind: "unknown", reason: "Angle.", width: 16 },
            condition: { kind: "true" },
            repeated: { stride: 4 },
          },
        ],
      }),
    );
    const result = discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0];
    expect(result?.fields[0]?.value).toBe(28);
    expect(result?.assumptions.some((s) => s.includes("separate allocations"))).toBe(true);
    f.image.set([0xc7, 0x44, 0x30, 2, 0], 0x600 + prefix.length);
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields).toEqual([]);
  });

  it("does not treat a newly assigned register as the value pushed earlier", () => {
    const f = fixture([...prefix, 0xc7, 0x44, 0x30, 7, 0, 0x57, 0x8b, 0xfe, 0x9a, 0, 6, 0, 0, 0x59, ...suffix]);
    f.helpers.push(
      helper(0x600, {
        footprint: { ...preserved, preservesArgumentMemory: false },
        writes: [
          {
            ...finding,
            argumentOffset: 6,
            root: "argument",
            path: [],
            offset: 0x70,
            width: 16,
            value: { kind: "unknown", reason: "Conditional store.", width: 16 },
            condition: { kind: "true" },
          },
        ],
      }),
    );
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields).toEqual([]);
  });

  it("does not reuse stale implicit arithmetic results as literal defaults", () => {
    const f = fixture([...prefix, 0xb8, 28, 0, 0xf7, 0xf9, 0x89, 0x44, 0x30, ...suffix]);
    expect(discoverCreationDefaults(f.image, f.helpers, f.layout, 0)[0]?.fields).toEqual([]);
  });
});
