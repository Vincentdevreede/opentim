import { describe, expect, it } from "vitest";
import { readMap, writeMap } from "../src/map.ts";

describe("readMap", () => {
  it("reads back what writeMap wrote", () => {
    const archives = [
      { name: "RESOURCE.001", offsets: [0, 1446] },
      { name: "RESOURCE.004", offsets: [] },
    ];
    expect(readMap(writeMap(archives))).toEqual(archives);
  });

  it("rejects a truncated map", () => {
    const data = writeMap([{ name: "RESOURCE.001", offsets: [0, 20] }]);
    expect(() => readMap(data.subarray(0, data.length - 1))).toThrow(/Truncated map/);
  });

  it("rejects bytes after the last archive", () => {
    const data = writeMap([{ name: "RESOURCE.001", offsets: [0] }]);
    expect(() => readMap(Uint8Array.from([...data, 0]))).toThrow(/1 unexpected bytes/);
  });
});
