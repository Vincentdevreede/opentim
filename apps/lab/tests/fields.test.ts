import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { fieldAt, fieldsOf, firstFieldFrom, programFields, textFields } from "../src/fields.ts";
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
    expect(fields.find((f) => f.name === "baseSize.height")).toMatchObject({ label: "base h", value: "32" });
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

  it("names a TIM 2 .PAR file's words and outline points", () => {
    const words = [0x149, 12, 2000, 120, 0, 64, 0, 240, 240, 0, 0, 39, 42, 8, 1, 2];
    const data = writeChunk(
      "PAR:",
      Uint8Array.from([...text("PROP"), ...u16(...words, 7, 9, 0, 0, 1, 0x4000, 38, 41)]),
    );
    const fields = fieldsOf(resource("PART12.PAR", "other", data));
    expectOrdered(fields);
    expect(fields.find((f) => f.label === "width")).toMatchObject({ offset: 8 + 0x1a, value: "39" });
    expect(fields.slice(-3).map((f) => [f.group, f.name, f.value])).toEqual([
      ["outline 0", "point 0", "0, 1"],
      ["outline 0", "flags of point 1, the last", "0x4000"],
      ["outline 0", "point 1, the last", "38, 41"],
    ]);
  });

  it("leaves the bytes of files without a decoder unread, and of a broken level too", () => {
    expect(fieldsOf(resource("PART0.PAR", "other", Uint8Array.of(1, 0, 2)))).toEqual([]);
    expect(fieldsOf(resource("L2.LEV", "level", Uint8Array.of(0xef, 0xac)))).toEqual([]);
    const unknown = resource("X.BMP", "sprites", writeChunk("ZZZ:", Uint8Array.of(0xff, 0xff)));
    expect(fieldsOf(unknown).map((f) => f.label)).toEqual(["tag", "size"]);
  });
});

describe("textFields", () => {
  it("reads runs of four letters or more as text and leaves the other bytes", () => {
    const data = Uint8Array.from([...text("PROPI"), 1, ...text("ABC"), 0, ...text("WXYZ")]);
    expect(textFields(data).map((f) => [f.offset, f.size, f.value])).toEqual([
      [0, 5, "“PROPI”"],
      [10, 4, "“WXYZ”"],
    ]);
    expect(textFields(data, 1, 4)).toEqual([]);
  });

  it("reads a run of letters longer than a call can take as arguments", () => {
    const data = new Uint8Array(500_000).fill(0x41);
    const [field] = textFields(data);
    expect(field?.size).toBe(500_000);
    expect(field?.value).toBe(`“${"A".repeat(500_000)}”`);
  });
});

describe("fieldAt and firstFieldFrom", () => {
  const fields = textFields(Uint8Array.from([...text("ABCD"), 0, ...text("EFGH"), 0, ...text("IJKL")]));

  it("find the field holding a byte and the first field from an offset", () => {
    expect(fieldAt(fields, 6)?.offset).toBe(5);
    expect(fieldAt(fields, 4)).toBeUndefined();
    expect(firstFieldFrom(fields, 4)).toBe(1);
    expect(firstFieldFrom(fields, 9)).toBe(2);
  });
});

describe("programFields", () => {
  it("reads the DOS program header and its relocations", () => {
    const header = u16(0x5a4d, 0x50, 3, 1, 4, 0, 0xffff, 0x10, 0x200, 0, 0x100, 0x20, 28, 0);
    const exe = Uint8Array.from([...header, ...u16(0x34, 0x1234), ...new Array(30).fill(0)]);
    const fields = programFields(exe);
    expect(fields.slice(0, 3).map((f) => [f.label, f.value])).toEqual([
      ["magic", "MZ"],
      ["last page", "80"],
      ["pages", "3"],
    ]);
    expect(fields.find((f) => f.label === "ip")?.value).toBe("0x0100");
    expect(fields.at(-1)).toMatchObject({ offset: 28, size: 4, value: "1234:0034", group: "DOS relocations" });
    expect(programFields(Uint8Array.of(1, 2, 3))).toEqual([]);
    expect(fieldsOf(resource("TIM.EXE", "other", exe)).at(-1)).toMatchObject({ offset: 28, label: "reloc" });
  });
});
