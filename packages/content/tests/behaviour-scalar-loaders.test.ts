import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverScalarLoaders, SCALAR_SERVICE_ASSUMPTION } from "../src/read/behaviour-scalar-loaders.ts";

/**
 * A loader at 0: push bp; mov bp, sp; push word [bp+6]; call far 0:0x40; add sp, 2; pop bp; retf. The routine at 0x40
 * opens a file: push bp; mov bp, sp; mov ah, 0x3d; int 0x21; pop bp; retf.
 */
function codes(loaderPushes: number[]) {
  const image = new Uint8Array(0x100);
  image.set([0x55, 0x8b, 0xec, ...loaderPushes, 0x9a, 0x40, 0, 0, 0, 0x83, 0xc4, 0x02, 0x5d, 0xcb], 0);
  image.set([0x55, 0x8b, 0xec, 0xb4, 0x3d, 0xcd, 0x21, 0x5d, 0xcb], 0x40);
  const map = new Map<number, ReturnType<typeof readRoutineCode>>();
  for (const address of [0, 0x40])
    map.set(address, readRoutineCode(image, { segment: 0, offset: address, address }, 0));
  return map;
}

describe("scalar loaders", () => {
  it("reads a routine that only passes its number on to code that reaches the system as a resource service", () => {
    const found = discoverScalarLoaders(codes([0xff, 0x76, 0x06]), new Map(), new Set(), 0xffff);
    expect(found.map((summary) => [summary.address, summary.kind, summary.argumentKind])).toEqual([
      [0, "scalar-resource-service", "scalar"],
    ]);
    expect(found[0]!.footprint).toMatchObject({ preservesPartState: true, partMemoryComplete: true, complete: false });
    expect(found[0]!.assumptions).toEqual([SCALAR_SERVICE_ASSUMPTION]);
  });

  it("doesn't when the argument is used as an address", () => {
    // mov bx, [bp+6]; push bx instead of push word [bp+6]
    expect(discoverScalarLoaders(codes([0x8b, 0x5e, 0x06, 0x53]), new Map(), new Set(), 0xffff)).toEqual([]);
  });

  it("doesn't when a part's callback or the program's start is reached", () => {
    expect(discoverScalarLoaders(codes([0xff, 0x76, 0x06]), new Map(), new Set([0x40]), 0xffff)).toEqual([]);
    expect(discoverScalarLoaders(codes([0xff, 0x76, 0x06]), new Map(), new Set(), 0x40)).toEqual([]);
  });
});
