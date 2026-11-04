import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import {
  addSuccessfulConstructors,
  successfulOwnerConstructor,
} from "../src/read/behaviour-successful-constructors.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const layout: BehaviourLayout = {
  ...fact,
  objectArgument: { ...fact, offset: 6 },
  callbacks: [],
  diagnostics: [],
  fields: [
    { ...fact, name: "type", offset: 4 },
    { ...fact, name: "state", offset: 12 },
  ],
};
const prefix = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6],
  suffix = [0x5e, 0x5d, 0xcb];
function constructor(body: number[]) {
  const image = Uint8Array.from([...prefix, ...body, ...suffix]);
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  return successfulOwnerConstructor(image, code, 0xa2, layout, 0);
}
describe("always-successful owner-only constructors", () => {
  it("proves bounded owner stores and a zero result on all returns", () => {
    const proof = constructor([0x83, 0x4c, 8, 4, 0xc6, 0x44, 0x6a, 0, 0x33, 0xc0]);
    expect(proof?.confidence).toBe("inferred");
    expect(proof?.evidence.some((i) => i.text === "xor ax, ax")).toBe(true);
  });
  it("rejects a changed owner that reaches a physically earlier store", () => {
    expect(constructor([0xeb, 6, 0x83, 0x4c, 8, 4, 0xeb, 5, 0x83, 0xc6, 4, 0xeb, 0xf5, 0x33, 0xc0])).toBeUndefined();
  });
  it("rejects an unmatched nonvolatile-register restore", () => {
    const image = Uint8Array.from([...prefix, 0xc6, 0x44, 0x6a, 0, 0x33, 0xc0, 0x5b, 0x5d, 0xcb]);
    expect(
      successfulOwnerConstructor(
        image,
        readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0),
        0xa2,
        layout,
        0,
      ),
    ).toBeUndefined();
  });
  it("requires the owner load on every path reaching a store", () => {
    const image = Uint8Array.from([...prefix, 0xc6, 0x44, 0x6a, 0, 0x33, 0xc0, ...suffix]);
    const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
    code.edges.push({ from: 1, to: prefix.length, kind: "jump" });
    expect(successfulOwnerConstructor(image, code, 0xa2, layout, 0)).toBeUndefined();
  });
  it.each([
    [0xb8, 1, 0],
    [0xe6, 0x40, 0x33, 0xc0],
    [0xbf, 1, 0, 0x33, 0xc0],
    [0xc7, 0x44, 4, 1, 0, 0x33, 0xc0],
    [0xc7, 0x44, 12, 1, 0, 0x33, 0xc0],
    [0xc7, 0x84, 0xa1, 0, 1, 0, 0x33, 0xc0],
    [0xa3, 0x20, 0, 0x33, 0xc0],
    [0x46, 0xc6, 0x44, 0x6a, 0, 0x33, 0xc0],
    [0x9a, 0, 1, 0, 0, 0x33, 0xc0],
    [0x58, 0x58, 0xc6, 0x44, 0x6a, 0, 0x33, 0xc0],
  ])("rejects failure returns, protected fields, escaped stores or invalid calling state %s", (...body) => {
    expect(constructor(body)).toBeUndefined();
  });
});
function factoryFixture(options: { failure?: boolean; wrongComparison?: boolean; bypass?: boolean } = {}) {
  const image = new Uint8Array(0x600);
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x56,
    0x9a,
    0,
    1,
    0,
    0,
    0x8b,
    0xf0,
    0x8b,
    0x87,
    0,
    3,
    0x0b,
    0x87,
    2,
    3,
    0x74,
    0,
    0x56,
    0x8b,
    0xdf,
    0xc1,
    0xe3,
    4,
    0xff,
    0x9f,
    0,
    3,
    0x59,
    0x83,
    0xf8,
    options.wrongComparison ? 2 : 1,
    0x75,
    0,
    0x33,
    0xc0,
    0x5e,
    0x5d,
    0xcb,
  ];
  bytes[20] = 39 - 21;
  bytes[36] = 39 - 37;
  image.set(bytes);
  image[0x100] = 0xcb;
  image.set([...prefix, 0xc6, 0x44, 0x6a, 0, ...(options.failure ? [0xb8, 1, 0] : [0x33, 0xc0]), ...suffix], 0x200);
  image.set([0, 2, 0, 0], 0x310);
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  if (options.bypass) code.edges.push({ from: 0, to: 27, kind: "jump" });
  const proof = code.instructions
    .filter((i) => i.address === 19)
    .map(({ address, bytes, text }) => ({ address, bytes, text }));
  const preserved = {
    complete: false,
    partMemoryComplete: true,
    preservesArgumentMemory: true,
    preservesPartState: true,
    unknownEffects: [],
    unknownGlobalEffects: ["Heap metadata changes."],
  };
  const factory: EngineSummary = {
    ...fact,
    address: 0,
    kind: "part-factory",
    purpose: "Allocates a part.",
    argumentOffset: 6,
    argumentKind: "scalar",
    allocationSize: 0xa2,
    returnPointerClass: "nullable-fresh",
    writes: [],
    returns: [],
    calls: [],
    footprint: { ...preserved, preservesArgumentMemory: false, preservesPartState: false, partMemoryComplete: false },
    factory: {
      typeArgument: 6,
      constructorTable: { segment: 0, offset: 0x300, stride: 16, typeCount: 2 },
      noConstructorTypes: [0],
      noConstructor: {
        ...fact,
        evidence: proof,
        purpose: "Proved null-constructor skeleton.",
        writes: [],
        freshFieldsOnly: true,
        footprint: preserved,
      },
    },
  };
  const allocator: EngineSummary = { ...factory, address: 0x100, kind: "nullable-allocation", factory: undefined };
  const summaries = new Map([
    [0, factory],
    [0x100, allocator],
  ]);
  addSuccessfulConstructors(image, new Map([[0, code]]), summaries, layout, 0);
  return { image, factory, summaries };
}
describe("factory success continuations", () => {
  it("extends the checked skeleton only for a type whose constructor cannot fail", () => {
    const { image, factory, summaries } = factoryFixture();
    expect(factory.factory?.alwaysSuccessfulConstructors?.map((c) => c.type)).toEqual([1]);
    image.set(
      [
        0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xc7, 0x44, 12, 2, 0, 0x6a, 1, 0x9a, 0, 0, 0, 0, 0x59, 0xff, 0x44, 12, 0x5d,
        0xcb,
      ],
      0x400,
    );
    const result = analyseRoutine(image, { address: 0x400, segment: 0, offset: 0x400 }, { engineSummaries: summaries });
    expect(result.uncertainties).toEqual([]);
    expect(result.transitions[0]?.to).toMatchObject({ kind: "constant", value: 3 });
  });
  it.each([{ failure: true }, { wrongComparison: true }, { bypass: true }])(
    "does not bypass an unproved constructor or dispatch bridge %s",
    (options) => {
      expect(factoryFixture(options).factory.factory?.alwaysSuccessfulConstructors ?? []).toEqual([]);
    },
  );
});
