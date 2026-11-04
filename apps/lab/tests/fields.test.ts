import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { fieldAt, fieldsOf, firstFieldFrom, wordFields } from "../src/fields.ts";
import type { Resource } from "../src/importer.ts";

const u16 = (...values: number[]) => new Uint8Array(new Uint16Array(values).buffer);
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

function resource(name: string, group: Resource["group"], data: Uint8Array): Resource {
  return { name, kind: "binary", group, archive: "RESOURCE.001", offset: 0, data };
}

/** A TIM 1 puzzle of version 0x102 with one static part of type 2 at 408, 120. */
function level(): Uint8Array {
  const header = [0xaced, 0x102];
  const after = [400, 300, 67, 272, 0xfff8, 0xfff8, 1002, 1, 0, 0];
  const part = [
    2, 0xe600, 0x80, 0, 0, 0, 16, 32, 16, 32, 408, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0xffff, 0xffff, 0xffff, 0xffff,
  ];
  return Uint8Array.from([
    ...u16(...header),
    ...text("TITLE"),
    0,
    ...text("Goal"),
    0,
    ...u16(...after),
    ...u16(...part),
  ]);
}

/** Fields must be sorted and must not overlap. */
function expectOrdered(fields: { offset: number; size: number }[]) {
  for (let i = 1; i < fields.length; i++)
    expect(fields[i]!.offset).toBeGreaterThanOrEqual(fields[i - 1]!.offset + fields[i - 1]!.size);
}

describe("fieldsOf", () => {
  it("reads a level's header and every field of its parts", () => {
    const fields = fieldsOf(resource("L1.LEV", "level", level()), { nameOf: () => "Wood incline" });
    expectOrdered(fields);
    expect(fields.reduce((n, f) => n + f.size, 0)).toBe(level().length);
    expect(fields.find((f) => f.name === "title")).toMatchObject({ value: "“TITLE”", kind: "text", size: 6 });
    expect(fields.find((f) => f.name === "scroll.x")).toMatchObject({ value: "-8", type: "i16 LE" });
    const x = fields.find((f) => f.name === "position.x");
    expect(x).toMatchObject({ label: "x", value: "408", kind: "position", group: "part #0 · static · Wood incline" });
    expect(fields.find((f) => f.name === "flags.0")).toMatchObject({ label: "flags", value: "E600", kind: "flags" });
    expect(fields.find((f) => f.name === "size2.height")).toMatchObject({ label: "height2", value: "32" });
    expect(fields.find((f) => f.name === "links.1")).toMatchObject({ label: "link", value: "none", kind: "link" });
    expect(fields.find((f) => f.name === "belt")).toMatchObject({ value: "no", kind: "link" });
  });

  it("reads the chunks of an image", () => {
    const data = writeChunk("SCR:", [
      writeChunk("DIM:", u16(320, 200)),
      writeChunk("BIN:", Uint8Array.of(2, 4, 0, 0, 0, 9, 9)),
    ]);
    const fields = fieldsOf(resource("TITLE.SCR", "screen", data));
    expectOrdered(fields);
    expect(fields.map((f) => [f.offset, f.label, f.value])).toEqual([
      [0, "tag", "SCR:"],
      [4, "size", String(data.length - 8)],
      [8, "tag", "DIM:"],
      [12, "size", "4"],
      [16, "width", "320"],
      [18, "height", "200"],
      [20, "tag", "BIN:"],
      [24, "size", "7"],
      [28, "packing", "LZW"],
      [29, "unpacked", "4"],
      [33, "pixels", "2 bytes"],
    ]);
  });

  it("reads a sound bank's names", () => {
    const tag = Uint8Array.from([...u16(1, 7), ...text("FUNK"), 0]);
    const data = writeChunk("SND:", [writeChunk("TAG:", tag)]);
    const fields = fieldsOf(resource("TIM.SX", "sound", data));
    expect(fields.slice(-3).map((f) => [f.name, f.value])).toEqual([
      ["name count", "1"],
      ["sound id", "7"],
      ["sound name", "“FUNK”"],
    ]);
  });

  it("reads files without a decoder as words, and a broken level too", () => {
    const fields = fieldsOf(resource("PART0.PAR", "other", Uint8Array.of(1, 0, 2)));
    expect(fields.map((f) => [f.offset, f.size, f.value])).toEqual([
      [0, 2, "1"],
      [2, 1, "2"],
    ]);
    expect(fieldsOf(resource("L2.LEV", "level", Uint8Array.of(0xef, 0xac)))).toHaveLength(1);
  });
});

describe("wordFields", () => {
  it("keeps runs of letters as text, cut to whole words", () => {
    const data = Uint8Array.from([...text("PROPI"), 1, 0x10, 0x0b]);
    expect(wordFields(data).map((f) => [f.offset, f.kind, f.value])).toEqual([
      [0, "text", "“PROP”"],
      [4, "word", String(0x149)],
      [6, "word", String(0x0b10)],
    ]);
  });
});

describe("fieldAt and firstFieldFrom", () => {
  const fields = wordFields(new Uint8Array(10));

  it("find the field holding a byte and the first field from an offset", () => {
    expect(fieldAt(fields, 5)?.offset).toBe(4);
    expect(fieldAt(fields, 10)).toBeUndefined();
    expect(firstFieldFrom(fields, 5)).toBe(2);
    expect(firstFieldFrom(fields, 6)).toBe(3);
  });
});
