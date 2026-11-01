import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverEngineSummaries } from "../src/read/behaviour-helpers.ts";

const leaf = 0x100,
  wrapper = 0x180,
  caller = 0x220;
function fixture(
  options: { output?: number; frame?: number; unsafeLoad?: boolean; foreignCall?: boolean; global?: boolean } = {},
) {
  const image = new Uint8Array(0x500);
  const load = options.unsafeLoad ? [0x75, 3, 0x8b, 0x5e, 10] : [0x8b, 0x5e, 10];
  image.set(
    [0x55, 0x8b, 0xec, ...load, 0x89, 7, 0x89, 0x47, 2, ...(options.global ? [0xa3, 0, 4] : []), 0x5d, 0xcb],
    leaf,
  );
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x83,
    0xec,
    options.frame ?? 12,
    0x8d,
    0x46,
    (options.output ?? -12) & 255,
    0x50,
    0x8d,
    0x46,
    0xf8,
    0x50,
    0x8d,
    0x46,
    0xfc,
    0x50,
    0x0e,
  ];
  const target = options.foreignCall ? 0x400 : leaf;
  const delta = (target - (wrapper + bytes.length + 3)) & 0xffff;
  bytes.push(0xe8, delta & 255, delta >> 8, 0x83, 0xc4, 6, 0x8b, 0xe5, 0x5d, 0xcb);
  image.set(bytes, wrapper);
  const d = (wrapper - (caller + 7)) & 0xffff;
  image.set([0x55, 0x8b, 0xec, 0x0e, 0xe8, d & 255, d >> 8, 0x5d, 0xcb], caller);
  const codes = new Map(
    [leaf, wrapper, caller].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
  return discoverEngineSummaries(image, codes);
}

describe("private output-buffer footprints", () => {
  it("finds a separately supplied output argument and retains every store address", () => {
    const result = fixture().find((s) => s.address === leaf)!;
    expect(result.kind).toBe("argument-buffer-update");
    expect(result.footprint.preservesPartState).toBe(false);
    expect(result.writes.map((w) => [w.argumentOffset, w.offset, w.width])).toEqual([
      [10, 0, 16],
      [10, 2, 16],
    ]);
    expect(result.writes.every((w) => w.evidence.length > 0)).toBe(true);
    expect(result.returns).toEqual([]);
  });
  it("composes a private-frame buffer query into its outer read-only caller", () => {
    const summaries = fixture();
    for (const address of [wrapper, caller])
      expect(summaries.find((s) => s.address === address)).toMatchObject({
        kind: "private-buffer-query",
        footprint: { complete: true, preservesArgumentMemory: true, preservesPartState: true },
        writes: [],
      });
  });
  it.each([{ output: -2 }, { frame: 8 }, { foreignCall: true }, { global: true }])(
    "rejects a private-frame claim when an output or callee is unbounded",
    (options) => {
      expect(fixture(options).find((s) => s.address === wrapper)?.footprint.complete).not.toBe(true);
    },
  );
  it("requires the argument pointer load on every incoming path to a store", () => {
    expect(fixture({ unsafeLoad: true }).find((s) => s.address === leaf)?.kind).not.toBe("argument-buffer-update");
    expect(fixture({ unsafeLoad: true }).find((s) => s.address === wrapper)?.footprint.complete).not.toBe(true);
  });
});
