import { describe, expect, it } from "vitest";
import { findChunk, readChunks, writeChunk } from "../src/chunk.ts";

describe("readChunks", () => {
  it("reads chunks and the chunks inside containers", () => {
    const data = writeChunk("PAL:", [writeChunk("VGA:", Uint8Array.of(1, 2)), writeChunk("CGA:", Uint8Array.of(3))]);
    const chunks = readChunks(data);
    expect(chunks.map((c) => c.tag)).toEqual(["PAL:"]);
    expect(chunks[0]!.children.map((c) => [c.tag, [...c.data]])).toEqual([
      ["VGA:", [1, 2]],
      ["CGA:", [3]],
    ]);
    expect([...findChunk(chunks, "CGA:")!.data]).toEqual([3]);
    expect(chunks[0]!.children.map((c) => c.offset)).toEqual([8, 18]);
    expect(findChunk(chunks, "EGA:")).toBeUndefined();
  });

  it("rejects data that isn't chunks", () => {
    const text = Uint8Array.from("\r\n Start  Stop", (c) => c.charCodeAt(0));
    expect(() => readChunks(text)).toThrow(/No chunk at offset 0/);
  });

  it("rejects a truncated chunk", () => {
    const data = writeChunk("BIN:", Uint8Array.of(1, 2, 3));
    expect(() => readChunks(data.subarray(0, data.length - 1))).toThrow(/Truncated BIN: chunk/);
  });
});
