import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { addPartCopySummary, PART_COPY_ASSUMPTIONS } from "../src/read/behaviour-part-copy.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const COPY = 0,
  RELEASE = 0x100,
  FREE = 0x180,
  ALLOCATE = 0x190;
const far = (address: number) => [0x9a, address & 0xff, address >> 8, 0, 0];
/**
 * The release a part copy calls when an allocation fails: it frees the outline buffer at 0x82, the belt record at 0x54
 * unless flag 1 is set, the rope record at 0x66 for types 7 and 10, and then the part.
 */
function release(belt = 0x54) {
  return [
    ...[0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0x0b, 0xf6, 0x74, 0x49],
    ...[0x83, 0xbc, 0x82, 0x00, 0x00, 0x74, 0x0a, 0xff, 0xb4, 0x82, 0x00, ...far(FREE), 0x59],
    ...[0x83, 0x7c, belt, 0x00, 0x74, 0x10, 0xf7, 0x44, 0x08, 0x01, 0x00, 0x75, 0x09],
    ...[0xff, 0x74, belt, ...far(FREE), 0x59],
    ...[0x83, 0x7c, 0x66, 0x00, 0x74, 0x15, 0x83, 0x7c, 0x04, 0x07, 0x74, 0x06, 0x83, 0x7c, 0x04, 0x0a, 0x75, 0x09],
    ...[0xff, 0x74, 0x66, ...far(FREE), 0x59],
    ...[0x56, ...far(FREE), 0x59, 0x5e, 0x5d, 0xcb],
  ];
}
/** push bp; mov bp,sp; a far call to the allocator and one to the release; pop bp; retf. */
function routines(belt?: number) {
  const image = new Uint8Array(0x200);
  image.set([0x55, 0x8b, 0xec, ...far(ALLOCATE), ...far(RELEASE), 0x5d, 0xcb], COPY);
  image.set(release(belt), RELEASE);
  image[FREE] = 0xcb;
  image[ALLOCATE] = 0xcb;
  return new Map(
    [COPY, RELEASE, FREE, ALLOCATE].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
}
const pattern = ["push bp", "mov bp,sp", "callf $allocate", "callf $release", "pop bp", "retf"].join("\n");
function allocator(kind = "nullable-allocation", clears = true): Map<number, EngineSummary> {
  return new Map([
    [
      ALLOCATE,
      {
        ...fact,
        address: ALLOCATE,
        kind,
        purpose: "Synthetic allocator.",
        argumentOffset: 6,
        argumentKind: "scalar",
        writes: [],
        returns: [],
        calls: [],
        returnPointerClass: "nullable-fresh",
        ...(clears ? { clearsAllocation: true as const } : {}),
        footprint: {
          complete: false,
          preservesArgumentMemory: false,
          preservesPartState: false,
          unknownEffects: [],
        },
      },
    ],
  ]);
}

describe("the part copy", () => {
  it("returns a fresh part or zero and changes no existing part", () => {
    const summaries = allocator();
    addPartCopySummary(routines(), summaries, [pattern]);
    const summary = summaries.get(COPY)!;
    expect(summary.kind).toBe("part-copy");
    expect(summary.returnPointerClass).toBe("nullable-fresh");
    expect(summary.writes).toEqual([]);
    expect(summary.footprint).toMatchObject({
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
    });
    expect(summary.returns.map((returned) => returned.pointer?.kind)).toEqual(["fresh", "constant"]);
    expect(summary.assumptions).toEqual(expect.arrayContaining(PART_COPY_ASSUMPTIONS));
  });

  it("is not summarised when the allocator or the release isn't the one the proof needs", () => {
    const other = allocator("call-wrapper");
    addPartCopySummary(routines(), other, [pattern]);
    expect(other.has(COPY)).toBe(false);
    const summaries = allocator();
    addPartCopySummary(routines(0x56), summaries, [pattern]);
    expect(summaries.has(COPY)).toBe(false);
  });

  it("is not summarised when its allocator doesn't clear the block", () => {
    const summaries = allocator("nullable-allocation", false);
    addPartCopySummary(routines(), summaries, [pattern]);
    expect(summaries.has(COPY)).toBe(false);
  });
});
