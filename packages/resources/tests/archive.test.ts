import { describe, expect, it } from "vitest";
import { readArchive, writeArchive } from "../src/archive.ts";

function entry(name: string, bytes: number[]): number[] {
  const header = new Uint8Array(17);
  header.set(Array.from(name, (c) => c.charCodeAt(0)));
  new DataView(header.buffer).setUint32(13, bytes.length, true);
  return [...header, ...bytes];
}

describe("readArchive", () => {
  it("reads every entry with its offset and bytes", () => {
    const data = Uint8Array.from([...entry("tim.pal", [1, 2, 3]), ...entry("L1.LEV", [4])]);
    const entries = readArchive(data, "RESOURCE.001");
    expect(entries.map((e) => [e.name, e.offset, [...e.data]])).toEqual([
      ["TIM.PAL", 0, [1, 2, 3]],
      ["L1.LEV", 20, [4]],
    ]);
  });

  it("rejects a truncated entry", () => {
    const data = Uint8Array.from(entry("PART1.BMP", [1, 2, 3, 4])).subarray(0, 19);
    expect(() => readArchive(data, "RESOURCE.001")).toThrow(/Truncated resource PART1.BMP/);
  });

  it("reads names with an ampersand, like GFSID&AL.BMP in Sid & Al's Incredible Toons", () => {
    const data = Uint8Array.from(entry("GFSID&AL.BMP", [1]));
    expect(readArchive(data, "RESOURCE.001").map((e) => e.name)).toEqual(["GFSID&AL.BMP"]);
    expect(readArchive(writeArchive([{ name: "GFSID&AL.BMP", data: Uint8Array.of(1) }]), "RESOURCE.001")).toHaveLength(1);
  });

  it("rejects unsafe names", () => {
    const data = Uint8Array.from(entry("../X.BMP", []));
    expect(() => readArchive(data, "RESOURCE.001")).toThrow(/Unsafe resource name/);
  });

  it("reads back what writeArchive wrote", () => {
    const data = writeArchive([
      { name: "TIM.PAL", data: Uint8Array.of(1, 2, 3) },
      { name: "EMPTY.DAT", data: new Uint8Array() },
    ]);
    expect(readArchive(data, "RESOURCE.001").map((e) => [e.name, [...e.data]])).toEqual([
      ["TIM.PAL", [1, 2, 3]],
      ["EMPTY.DAT", []],
    ]);
  });

  it("refuses names that don't fit the header", () => {
    expect(() => writeArchive([{ name: "TOOLONGNAME.BMP", data: new Uint8Array() }])).toThrow(/Invalid resource name/);
  });

  it("refuses archives that readArchive wouldn't read", () => {
    // Two 32 MiB entries plus their headers go just over the limit; the buffer is shared to save memory.
    const half = new Uint8Array(32 * 1024 * 1024);
    expect(() =>
      writeArchive([
        { name: "A.BIN", data: half },
        { name: "B.BIN", data: half },
      ]),
    ).toThrow(/exceeds the 64 MiB limit/);
  });
});
