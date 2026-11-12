import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverCountedLoops } from "../src/read/behaviour-loops.ts";
const entry = { address: 0, segment: 0, offset: 0 };

function fixture(storeState = false, skipUpdate = false) {
  // The loop visits four private slots. The state's increment is after the loop.
  const image = new Uint8Array(0x50).fill(0x66);
  image.set([0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0, 0xeb, 0x0d]);
  image.set(storeState ? [0xc7, 0x44, 0x0c, 1, 0] : [0xc7, 0x46, 0xfc, 1, 0], 0x11);
  image.set(skipUpdate ? [0xeb, 6] : [0x90, 0x90], 0x16);
  image.set([0xff, 0x46, 0xfe, 0x90, 0x90, 0x90], 0x18);
  image.set([0x83, 0x7e, 0xfe, 4, 0x7c, 0xed, 0xff, 0x44, 0x0c, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb], 0x1e);
  return image;
}

describe("counted loop invariants", () => {
  it("preserves an owner word copied to possibly aliasing linked objects", () => {
    const bytes = [
      0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x57, 0x8b, 0x76, 6, 0xc7, 0x44, 0x12, 1, 0, 0xc7, 0x46, 0xfe, 0, 0, 0xeb,
      0,
    ];
    const jump = bytes.length - 1,
      body = bytes.length;
    bytes.push(0x8b, 0x7c, 0x54, 0x8b, 0x44, 0x12, 0x89, 0x45, 0x12, 0xff, 0x46, 0xfe);
    const header = bytes.length;
    bytes[jump] = header - jump - 1;
    bytes.push(
      0x83,
      0x7e,
      0xfe,
      2,
      0x7c,
      (body - header - 6) & 255,
      0x8b,
      0x44,
      0x12,
      0x89,
      0x44,
      12,
      0x5f,
      0x5e,
      0x8b,
      0xe5,
      0x5d,
      0xcb,
    );
    const image = Uint8Array.from(bytes);
    const result = analyseRoutine(image, entry);
    expect(result.loops).toHaveLength(1);
    expect(result.loops![0]!.possibleFields.some((field) => field.preservesOwnerValue)).toBe(true);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "constant", value: 1 });
    image[body + 5] = 0x14;
    const changed = analyseRoutine(image, entry);
    expect(changed.loops![0]!.possibleFields.some((field) => field.preservesOwnerValue)).toBe(false);
    expect(changed.transitions[0]!.to).toMatchObject({ kind: "field", unresolved: true });
  });
  it("proves a monotone private counter and continues without interpreting the body", () => {
    const image = fixture();
    const loops = discoverCountedLoops(readRoutineCode(image, entry, 0), new Map(), 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ header: 0x1e, exit: 0x24, step: 1, limit: 4 });
    const result = analyseRoutine(image, entry, { stateCount: 4 });
    expect(result.loops).toHaveLength(1);
    expect(result.uncertainties.some((value) => value.includes("Back edge"))).toBe(false);
    expect(result.transitions[0]?.to).toMatchObject({ kind: "binary", operator: "+" });
  });

  it("rejects a state store in the body", () => {
    expect(discoverCountedLoops(readRoutineCode(fixture(true), entry, 0), new Map(), 12)).toHaveLength(0);
  });

  it("rejects a path which avoids the counter update", () => {
    expect(discoverCountedLoops(readRoutineCode(fixture(false, true), entry, 0), new Map(), 12)).toHaveLength(0);
  });

  it("keeps a loop unresolved when its entry counter is not established", () => {
    const image = fixture();
    image.set([0x8b, 0x46, 8, 0x90, 0x90], 10);
    const result = analyseRoutine(image, entry, { stateCount: 4 });
    expect(result.loops).toHaveLength(0);
    expect(result.uncertainties.some((value) => value.includes("Back edge"))).toBe(true);
  });
});

function outlineFixture(field = 0x72, writesState = false, uncertainOrigin = false) {
  const image = new Uint8Array(0x80).fill(0x66);
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x83,
    0xec,
    2,
    0x56,
    0x57,
    0x8b,
    0x5e,
    6,
    ...(uncertainOrigin ? [0x8b, 0xf0, 0x90, 0x90] : [0x8b, 0xb7, field, 0]),
    0xbf,
    0x60,
    0,
    0xc7,
    0x46,
    0xfe,
    0,
    0,
    0xeb,
    0,
  ];
  const jump = bytes.length - 1,
    body = bytes.length;
  bytes.push(0x8a, 5, 0x88, 4, 0x8a, 0x45, 1, 0x88, 0x44, 1);
  if (writesState) bytes.push(0xc7, 0x47, 12, 1, 0);
  bytes.push(0xff, 0x46, 0xfe, 0x83, 0xc6, 4, 0x83, 0xc7, 2);
  const header = bytes.length;
  bytes[jump] = header - jump - 1;
  bytes.push(
    0x83,
    0x7e,
    0xfe,
    4,
    0x7c,
    (body - header - 6) & 255,
    0x8b,
    0x5e,
    6,
    0xc7,
    0x47,
    12,
    1,
    0,
    0x5f,
    0x5e,
    0x8b,
    0xe5,
    0x5d,
    0xcb,
  );
  image.set(bytes);
  return image;
}

const outlineSummary = (field: number): import("../src/read/behaviour-helpers.ts").EngineSummary => {
  const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
  return {
    ...fact,
    address: 0x70,
    kind: "geometry-edge-data",
    purpose: "Updates outline edges.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    writes: [
      {
        ...fact,
        root: "argument",
        argumentOffset: 6,
        path: [field],
        offset: 2,
        width: 16,
        value: { kind: "unknown", reason: "Edge direction", width: 16 },
        condition: { kind: "true" },
        repeated: { stride: 4 },
      },
    ],
    footprint: {
      complete: false,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
};

describe("outline buffer loop invariants", () => {
  it("rejects a state-only helper whose unrecorded field writes could invalidate cached values", () => {
    const bytes = [
      0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0, 0xeb, 10, 0x56, 0x9a, 0x70, 0, 0, 0,
      0x59, 0xff, 0x46, 0xfe, 0x83, 0x7e, 0xfe, 4, 0x7c, 0xf0, 0xc7, 0x44, 12, 1, 0, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb,
    ];
    const image = Uint8Array.from(bytes),
      helper = outlineSummary(0x72);
    helper.writes = [];
    helper.returnConvention = { kind: "far", stackBytes: 0 };
    helper.footprint.partMemoryComplete = false;
    expect(discoverCountedLoops(readRoutineCode(image, entry, 0), new Map([[0x70, helper]]), 12)).toHaveLength(0);
    helper.footprint.partMemoryComplete = true;
    expect(discoverCountedLoops(readRoutineCode(image, entry, 0), new Map([[0x70, helper]]), 12)).toHaveLength(1);
  });
  it.each([0x72, 0x86])("uses the discovered buffer field %s and preserves the owner state", (field) => {
    const image = outlineFixture(field),
      helpers = new Map([[0x70, outlineSummary(field)]]);
    const loops = discoverCountedLoops(readRoutineCode(image, entry, 0), helpers, 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.possibleFields.some((effect) => effect.object === "buffer")).toBe(true);
    const result = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(result.loops).toHaveLength(1);
    expect(result.transitions[0]?.to).toMatchObject({ kind: "constant", value: 1 });
    expect(result.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(false);
  });

  it("rejects an owner-state write in a buffer-copy loop", () => {
    const image = outlineFixture(0x72, true);
    expect(
      discoverCountedLoops(readRoutineCode(image, entry, 0), new Map([[0x70, outlineSummary(0x72)]]), 12),
    ).toHaveLength(0);
  });

  it("does not infer a separate buffer from an unknown origin", () => {
    const image = outlineFixture(0x72, false, true);
    expect(
      discoverCountedLoops(readRoutineCode(image, entry, 0), new Map([[0x70, outlineSummary(0x72)]]), 12),
    ).toHaveLength(0);
  });
});

function indexedFixture(offset = 0x64, initial = 0) {
  const image = new Uint8Array(0x60).fill(0x66);
  image.set([
    0x55,
    0x8b,
    0xec,
    0x83,
    0xec,
    2,
    0x56,
    0x8b,
    0x76,
    6,
    0xc7,
    0x46,
    0xfe,
    initial & 255,
    (initial >> 8) & 255,
    0xeb,
    13,
    0x8b,
    0x5e,
    0xfe,
    0xd1,
    0xe3,
    0xc7,
    0x40,
    offset,
    0,
    0,
    0xff,
    0x46,
    0xfe,
    0x83,
    0x7e,
    0xfe,
    4,
    0x7c,
    0xed,
    0xff,
    0x44,
    12,
    0x5e,
    0x8b,
    0xe5,
    0x5d,
    0xcb,
  ]);
  return image;
}

describe("indexed owner-field footprints", () => {
  it("bounds scaled counter indices without evaluating the loop", () => {
    const image = indexedFixture();
    const loops = discoverCountedLoops(readRoutineCode(image, entry, 0), new Map(), 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.minimumCounter).toBe(0);
    expect(loops[0]!.possibleFields.filter((field) => field.object === "part").map((field) => field.offset)).toEqual([
      0x64, 0x66, 0x68, 0x6a,
    ]);
    expect(analyseRoutine(image, entry).loops).toHaveLength(1);
  });

  it("rejects an indexed footprint containing the state", () => {
    const image = indexedFixture(8);
    expect(discoverCountedLoops(readRoutineCode(image, entry, 0), new Map(), 12)).toHaveLength(0);
  });

  it("does not apply a nonnegative-index contract to a negative counter", () => {
    const result = analyseRoutine(indexedFixture(0x64, -1), entry);
    expect(result.loops).toHaveLength(0);
    expect(result.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(true);
  });
});

/** A far routine: `prefix`, a jump to the loop's test, the body, the test and a `jl` back to the body, then `tail`. */
function loopRoutine(prefix: number[], body: number[], test: number[], tail: number[]) {
  const bytes = [...prefix, 0xeb, body.length, ...body, ...test];
  bytes.push(0x7c, -(body.length + test.length + 2) & 0xff, ...tail);
  return Uint8Array.from(bytes);
}

describe("counted loop effects after the loop", () => {
  it("forgets a linked part's field the body writes, also when it is first read after the loop", () => {
    // The body stores 5 in [part+0x54]+0x20 twice; after the loop that field is copied to the state at 0x0c.
    const image = loopRoutine(
      [0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x57, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0],
      [0x8b, 0x7c, 0x54, 0xc7, 0x45, 0x20, 5, 0, 0xff, 0x46, 0xfe],
      [0x83, 0x7e, 0xfe, 2],
      [0x8b, 0x7c, 0x54, 0x8b, 0x45, 0x20, 0x89, 0x44, 0x0c, 0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb],
    );
    const result = analyseRoutine(image, entry);
    expect(result.loops).toHaveLength(1);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]!.to).toMatchObject({ offset: 0x20, unresolved: true });
    expect(result.transitions[0]!.confidence).not.toBe("inferred");
  });
});

describe("counted loop indexed stores", () => {
  // xor di,di; the body is inc di; mov bx,di; shl bx,1; mov word [bx+si+4],7 while di < 4.
  const image = loopRoutine(
    [0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x33, 0xff],
    [0x47, 0x8b, 0xdf, 0xd1, 0xe3, 0xc7, 0x40, 0x04, 7, 0],
    [0x83, 0xff, 4],
    [0x5f, 0x5e, 0x5d, 0xcb],
  );
  const code = readRoutineCode(image, entry, 0);

  it("lists the fields an index read after the increment reaches", () => {
    const loops = discoverCountedLoops(code, new Map(), 0x40);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.possibleFields.map((f) => f.offset)).toEqual([6, 8, 10, 12]);
  });

  it("rejects the loop when the last of those fields is the state", () => {
    expect(discoverCountedLoops(code, new Map(), 12)).toHaveLength(0);
  });
});
