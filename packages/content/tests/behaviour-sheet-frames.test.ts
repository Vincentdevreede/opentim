import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { binary, type Expression } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { matchHeapRoutine } from "../src/read/behaviour-heap-release.ts";
import {
  proveSheetFrameList,
  sheetFrameSizeForType,
  sheetFrameSizes,
  type FrameSize,
} from "../src/read/behaviour-sheet-frames.ts";

const words = (...values: number[]) => Uint8Array.from(values.flatMap((v) => [v & 255, v >> 8]));
/** A sheet as the parts ship it: one BMP: chunk with INF:, SCN: and OFF: chunks, and any others given. */
const sheet = (inf: Uint8Array, frames: number, extra: Uint8Array[] = []) =>
  writeChunk("BMP:", [
    writeChunk("INF:", inf),
    writeChunk("SCN:", new Uint8Array(4)),
    writeChunk("OFF:", new Uint8Array(frames * 4)),
    ...extra,
  ]);

describe("the frame sizes the game reads from a sheet", () => {
  it("are the INF: chunk's widths and heights, in frame order", () => {
    expect(sheetFrameSizes(sheet(words(3, 40, 72, 56, 41, 57, 42), 3))).toEqual([
      { width: 40, height: 41 },
      { width: 72, height: 57 },
      { width: 56, height: 42 },
    ]);
  });
  it("are the first width and height for every frame when the chunk has one pair", () => {
    expect(sheetFrameSizes(sheet(words(3, 24, 11), 3))).toEqual(Array(3).fill({ width: 24, height: 11 }));
  });
  it("are not read for a sheet the loader takes another way or can't read", () => {
    const inf = words(2, 24, 24, 11, 10);
    expect(sheetFrameSizes(sheet(inf, 2, [writeChunk("RLE:", new Uint8Array(2))]))).toBeUndefined();
    expect(sheetFrameSizes(sheet(inf, 2, [writeChunk("SCL:", new Uint8Array(2))]))).toBeUndefined();
    expect(sheetFrameSizes(sheet(inf, 1))).toBeUndefined();
    expect(
      sheetFrameSizes(writeChunk("BMP:", [writeChunk("INF:", inf), writeChunk("OFF:", new Uint8Array(8))])),
    ).toBeUndefined();
    expect(sheetFrameSizes(sheet(words(0), 0))).toBeUndefined();
    expect(sheetFrameSizes(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

const DS = 0x2fe1;
const LIST = 0x2ef10 + 4 * 58 + 0x14;
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const build = (operator: string, left: Expression, right: Expression, width?: number) =>
  binary(operator, left, right, width, Infinity);
/** The list word of the type record, as the type's drawing value reads it. */
const list: Expression = { kind: "table", segment: 0x2ef1, offset: 4 * 58 + 0x14, index: constant(0), width: 16 };
const table = (offset: number, index: Expression): Expression => ({
  kind: "table",
  segment: DS,
  offset,
  index,
  width: 16,
});
/** The frame size helper's width: `(L != 0) * T[ds:6 + T[ds:k + L + 2·J]]`. */
const width = (pointer: Expression) => build("*", build("!=", list, constant(0), 16), table(6, pointer), 16);
const frames: FrameSize[] = [
  { width: 32, height: 48 },
  { width: 72, height: 71 },
  { width: 72, height: 67 },
];
/** The value of an expression with the part's frame at `0x0c`, or undefined when it reads something else. */
function evaluate(e: Expression, frame: number): number | undefined {
  if (e.kind === "constant") return e.value;
  if (e.kind === "field") return e.offset === 0x0c ? frame : undefined;
  if (e.kind !== "binary") return undefined;
  const left = evaluate(e.left, frame),
    right = evaluate(e.right, frame);
  if (e.operator === "&" && (left === 0 || right === 0)) return 0;
  if (left === undefined || right === undefined) return undefined;
  return (build(e.operator, constant(left), constant(right), e.width) as { value: number }).value;
}

describe("the frame sizes of a part with a sheet", () => {
  it("are numbers for a frame that is a number", () => {
    const used = { sheet: false };
    expect(sheetFrameSizeForType(width(table(2, list)), LIST, DS, frames, build, used)).toEqual(constant(72));
    expect(used.sheet).toBe(true);
  });
  it("are selected by a frame that is a value of the part", () => {
    const next = build("+", field(0x0c), constant(1), 16);
    const pointer = table(0, build("+", list, build("<<", next, constant(1), 16), 16));
    const value = sheetFrameSizeForType(width(pointer), LIST, DS, frames, build, { sheet: false });
    expect([0, 1].map((frame) => evaluate(value, frame))).toEqual([72, 72]);
    // From the last frame the game reads past the list, so the read stays.
    expect(evaluate(value, 2)).toBeUndefined();
  });
  it("stay reads for a frame the sheet doesn't have or another type's list", () => {
    const past = width(table(6, list));
    expect(sheetFrameSizeForType(table(6, table(6, list)), LIST, DS, frames, build, { sheet: false })).toEqual(
      table(6, table(6, list)),
    );
    const other = { sheet: false };
    expect(sheetFrameSizeForType(past, LIST + 58, DS, frames, build, other)).toBe(past);
    expect(other.sheet).toBe(false);
  });
});

describe("the frame list proof", () => {
  it("matches a call through a data word by its operand", () => {
    // call far [0x40]; retf
    const code = readRoutineCode(
      Uint8Array.from([0xff, 0x1e, 0x40, 0, 0xcb]),
      { address: 0, segment: 0, offset: 0 },
      0,
    );
    expect(matchHeapRoutine(code, "callf *32:ds[{hook}]\nretf", new Map())?.get("hook")).toBe(0x40);
    expect(matchHeapRoutine(code, "call *32:ds[{hook}]\nretf", new Map())).toBeUndefined();
    expect(matchHeapRoutine(code, "callf $hook\nretf", new Map())).toBeUndefined();
  });
  it("finds nothing in a program without the store", () => {
    expect(proveSheetFrameList(new Uint8Array(0x100), 0, 0)).toBeUndefined();
  });
});
