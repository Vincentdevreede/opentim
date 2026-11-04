import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverBoundedSearchLoops } from "../src/read/behaviour-search-loops.ts";

function fixture() {
  const image = new Uint8Array(0x70).fill(0x66);
  image.set([
    0xb9, 2, 0, 0xbb, 0x30, 0, 0x2e, 0x8b, 7, 0x3b, 0x46, 0xfe, 0x74, 7, 0x83, 0xc3, 2, 0xe2, 0xf3, 0xeb, 7, 0x2e, 0xff,
    0x67, 4, 0x66, 0x66, 0x66, 0xcb,
  ]);
  image.set([3, 0, 9, 0, 0x40, 0, 0x50, 0], 0x30);
  image[0x40] = 0xcb;
  image[0x50] = 0xcb;
  return readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
}
describe("bounded switch-search invariants", () => {
  it("proves the CX reload and retains the instructions bounding the search", () => {
    const result = discoverBoundedSearchLoops(fixture());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ entry: 0, header: 6, latch: 17, count: 2 });
    expect(result[0]!.evidence.some((i) => i.text.startsWith("loop"))).toBe(true);
  });
  it("rejects a path entering after the count reload", () => {
    const code = fixture();
    code.edges.push({ from: 0x40, to: 6, kind: "jump" });
    expect(discoverBoundedSearchLoops(code)).toEqual([]);
  });
  it("rejects a modified count instead of assuming the original table metadata is enough", () => {
    const code = fixture();
    code.instructions[0]!.operands[1] = { kind: "immediate", value: 0, width: 16 };
    expect(discoverBoundedSearchLoops(code)).toEqual([]);
  });
});
