import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import {
  discoverContactRotation,
  discoverRotationScalar,
  discoverRotationScalarSummary,
  discoverRotationShift,
  discoverRotationLeftShift,
  rotationScalarExpression,
  rotationFormulae,
} from "../src/read/behaviour-contact-rotation.ts";
import type { Expression } from "../src/read/behaviour.ts";

const word = (n: number) => [n & 255, (n >>> 8) & 255];
function assembly(origin = 0x100) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    fixups: { at: number; name: string }[] = [];
  return {
    bytes,
    emit: (...b: number[]) => bytes.push(...b),
    label: (name: string) => labels.set(name, bytes.length),
    jump(op: number, name: string) {
      bytes.push(op, 0);
      fixups.push({ at: bytes.length - 1, name });
    },
    call(address: number, far: boolean) {
      if (far) bytes.push(0x9a, ...word(address), 0, 0);
      else {
        const next = origin + bytes.length + 3;
        bytes.push(0xe8, ...word(address - next));
      }
    },
    finish() {
      for (const { at, name } of fixups) {
        const delta = labels.get(name)! - at - 1;
        if (delta < -128 || delta > 127) throw Error("Synthetic short branch exceeds its span");
        bytes[at] = delta & 255;
      }
      return bytes;
    },
  };
}
function read(image: Uint8Array, address: number, segment = 0) {
  return readRoutineCode(image, { address, segment, offset: address - segment * 16 }, 0);
}
function scalar(image: Uint8Array, address: number, phase = false, table = 0x2000, segment = 0) {
  const a = assembly(address);
  a.emit(0x8b, 0xdc, 0x36, 0x8b, 0x47, 4);
  if (phase) a.emit(0x05, 0, 0xc0);
  a.emit(0xd1, 0xe8, 0xd1, 0xe8, 0xd1, 0xe8, 0xd1, 0xe8, 0xa9, 0, 8);
  a.jump(0x74, "lookup");
  a.emit(0xf7, 0xd8, 0x05, 0, 16);
  a.label("lookup");
  a.emit(0x8b, 0xd8, 0xd1, 0xe3, 0x2e, 0x8b, 0x87, ...word(table), 0xcb);
  image.set(a.finish(), address);
  return read(image, address, segment);
}
function shift(image: Uint8Array, address: number, near = true, left = false) {
  const a = assembly(address);
  if (near) a.emit(0x5b, 0x0e, 0x53);
  a.emit(0x80, 0xf9, 16);
  a.jump(0x73, "large");
  a.emit(
    0x8b,
    left ? 0xd8 : 0xda,
    0xd3,
    left ? 0xe0 : 0xe8,
    0xd3,
    left ? 0xe2 : 0xfa,
    0xf6,
    0xd9,
    0x80,
    0xc1,
    16,
    0xd3,
    left ? 0xeb : 0xe3,
    0x0b,
    left ? 0xd3 : 0xc3,
    0xcb,
  );
  a.label("large");
  a.emit(0x80, 0xe9, 16, 0x92, ...(left ? [0x33, 0xc0] : [0x99]), 0xd3, left ? 0xe2 : 0xf8, 0xcb);
  image.set(a.finish(), address);
  return read(image, address);
}
function fixture(farShift = false, origin = 0x100) {
  const image = new Uint8Array(0x7000),
    a = assembly(origin);
  for (let n = 0; n < 2049; n++) image.set(word((n * 91 + 23) & 65535), 0x2000 + 2 * n);
  const first = scalar(image, 0x600),
    second = scalar(image, 0x680, true);
  image.set([0x8b, 0xdc, 0x8b, 0x47, 4, 0xf7, 0x6f, 6, 0xcb], 0x800);
  const product = read(image, 0x800),
    shifted = shift(image, 0x900, !farShift);
  a.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 12, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8, 0xff, 0x76, 10);
  a.call(0x600, true);
  a.emit(0x59, 0x89, 0x46, 0xfe, 0xff, 0x76, 10);
  a.call(0x680, true);
  a.emit(0x59, 0x89, 0x46, 0xfc, 0xff, 0x76, 0xfe, 0xff, 0x34);
  a.call(0x800, true);
  a.emit(0x59, 0x59, 0x50, 0x52, 0xff, 0x76, 0xfc, 0xff, 0x35);
  a.call(0x800, true);
  a.emit(
    0x59,
    0x59,
    0x5b,
    0x59,
    0x2b,
    0xc8,
    0x1b,
    0xda,
    0x89,
    0x5e,
    0xfa,
    0x89,
    0x4e,
    0xf8,
    0xff,
    0x76,
    0xfc,
    0xff,
    0x34,
  );
  a.call(0x800, true);
  a.emit(0x59, 0x59, 0x50, 0x52, 0xff, 0x76, 0xfe, 0xff, 0x35);
  a.call(0x800, true);
  a.emit(
    0x59,
    0x59,
    0x5b,
    0x59,
    0x03,
    0xc8,
    0x13,
    0xda,
    0x89,
    0x5e,
    0xf6,
    0x89,
    0x4e,
    0xf4,
    0x8b,
    0x56,
    0xfa,
    0x8b,
    0x46,
    0xf8,
    0xb1,
    14,
  );
  a.call(0x900, farShift);
  a.emit(0x89, 4, 0x8b, 0x56, 0xf6, 0x8b, 0x46, 0xf4, 0xb1, 14);
  a.call(0x900, farShift);
  a.emit(0x89, 5, 0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  image.set(a.finish(), origin);
  const code = read(image, origin),
    codes = new Map([code, first, second, product, shifted].map((c) => [c.address, c]));
  return { image, code, codes, discover: () => discoverContactRotation(code, codes, new Map(), image) };
}
const mask = (n: number, width: number) => (width === 32 ? n >>> 0 : n & ((1 << width) - 1));
const signed = (n: number, width: number) => (width === 32 ? n | 0 : (n << (32 - width)) >> (32 - width));
/** This evaluates the public algebra only; it does not interpret any decoded instruction. */
function evaluate(e: Expression, fields: Record<string, number> = {}, table?: (index: number) => number): number {
  if (e.kind === "constant") return mask(e.value, e.width);
  if (e.kind === "field") return mask(fields[e.object]!, e.width);
  if (e.kind === "table") return table ? table(evaluate(e.index, fields, table) / 2) : evaluate(e.index, fields);
  if (e.kind !== "binary") throw Error("Unexpected unresolved algebra");
  const a = evaluate(e.left, fields, table),
    b = evaluate(e.right, fields, table);
  const n =
    e.operator === "+"
      ? a + b
      : e.operator === "-"
        ? a - b
        : e.operator === "*"
          ? a * b
          : e.operator === ">>>"
            ? a >>> b
            : e.operator === ">>"
              ? signed(a, e.left.width) >> b
              : e.operator === "<<"
                ? a << b
                : e.operator === "&"
                  ? a & b
                  : NaN;
  if (Number.isNaN(n)) throw Error("Unexpected public operator");
  return mask(n, e.width);
}
const field = (object: string): Expression => ({ kind: "field", object, offset: 0, width: 16 });

describe("Integer contact rotation", () => {
  it.each([false, true])("checks the whole rotation with far shift=%s", (far) => {
    const f = fixture(far),
      summary = f.discover()!;
    expect(f.code.status).toBe("complete");
    expect(summary?.contactRotation.shift.convention).toBe(far ? "far" : "near");
    expect(summary.contactRotation.stores).toEqual([
      { argument: 6, value: "x" },
      { argument: 8, value: "y" },
    ]);
    expect(summary.contactRotation.inputs).toBe("beforeAnyOutputStore");
    expect(summary.contactRotation.aliasing).toBe("laterStoreWinsOverlappingBytes");
    expect(summary.footprint.preservesPartState).toBe(false);
    expect(summary.writes.map((w) => w.argumentOffset)).toEqual([6, 8]);
  });
  it("binds a relocated rotation without requiring the same code address", () => {
    expect(fixture(false, 0x300).discover()?.contactRotation.routine).toBe(0x300);
  });
  it.each([false, true])("checks every word angle and the endpoint with phase=%s", (phase) => {
    const image = new Uint8Array(0x5000),
      code = scalar(image, 0x100, phase);
    const r = discoverRotationScalar(code, image)!;
    const expression = rotationScalarExpression(r, field("angle"));
    for (let angle = 0; angle < 65536; angle++) {
      const q = ((angle + (phase ? 49152 : 0)) & 65535) >>> 4;
      const index = evaluate(expression, { angle }, (index) => index);
      if (index !== (q <= 2048 ? q : 4096 - q)) throw Error("Wrong folded index at angle " + angle);
    }
    expect(r.table.initialImageWords).toHaveLength(2049);
    expect(evaluate(expression, { angle: phase ? 0xc000 : 0x8000 }, (index) => index)).toBe(2048);
  });
  it("keeps snapshots separate from the runtime lookup and binds the code segment", () => {
    const image = new Uint8Array(0x7000),
      code = scalar(image, 0x1100, false, 0x2000, 0x100);
    image.set(word(0xabcd), 0x3000);
    const relation = discoverRotationScalar(code, image)!;
    expect(relation.table.segment).toBe(0x100);
    expect(relation.table.initialImageWords[0]).toBe(0xabcd);
    expect(rotationScalarExpression(relation, { kind: "constant", value: 0, width: 16 }).kind).toBe("table");
    expect(discoverRotationScalarSummary(code, image)?.returns[0]?.register).toBe("ax");
  });
  it("declines lookup spans that wrap or fall outside the image", () => {
    const image = new Uint8Array(0x10000);
    expect(discoverRotationScalar(scalar(image, 0x100, false, 0xff00), image)).toBeUndefined();
    const code = scalar(image, 0x100, false, 0x2000);
    expect(discoverRotationScalar(code, image.subarray(0, 0x3000))).toBeUndefined();
  });
  it("requires the multiplication, shift and same coefficient table proofs", () => {
    const f = fixture();
    for (const address of [0x600, 0x680, 0x800, 0x900]) {
      const codes = new Map(f.codes);
      codes.delete(address);
      expect(discoverContactRotation(f.code, codes, new Map(), f.image)).toBeUndefined();
    }
    const second = scalar(f.image, 0x680, true, 0x3000);
    f.codes.set(second.address, second);
    expect(f.discover()).toBeUndefined();
  });
  it("rejects a changed product combine, output store and added CFG edge", () => {
    const f = fixture();
    for (const instruction of f.code.instructions.filter(
      (i) =>
        i.mnemonic === "sbb" ||
        (i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].segment === "ds"),
    )) {
      const image = f.image.slice();
      image[instruction.address] = 0x90;
      expect(discoverContactRotation(read(image, f.code.address), f.codes, new Map(), image)).toBeUndefined();
    }
    f.code.edges.push({ from: f.code.address, to: f.code.instructions[3]!.address, kind: "jump" });
    expect(f.discover()).toBeUndefined();
  });
  it.each([false, true])("checks complete long-shift cores and near adapters with left=%s", (left) => {
    for (const near of [false, true]) {
      const image = new Uint8Array(0x1000),
        code = shift(image, 0x100, near, left);
      const summary = (left ? discoverRotationLeftShift : discoverRotationShift)(code)!;
      expect(summary?.numeric?.operation).toBe(left ? "leftShift32" : "arithmeticRightShift32");
      expect(summary.returnConvention?.kind).toBe(near ? "near" : "far");
      expect((left ? discoverRotationShift : discoverRotationLeftShift)(code)).toBeUndefined();
      code.edges.push({ from: code.address, to: null, kind: "return" });
      expect((left ? discoverRotationLeftShift : discoverRotationShift)(code)).toBeUndefined();
    }
  });
  it("retains signed products, long overflow and downward right-shift rounding exactly", () => {
    const formula = rotationFormulae(field("x"), field("y"), field("c"), field("s"));
    const samples = [-32768, -32767, -16385, -1, 0, 1, 16384, 32767];
    for (const x of samples)
      for (const y of samples)
        for (const c of samples)
          for (const s of samples) {
            const first = BigInt.asIntN(32, BigInt(x) * BigInt(c) - BigInt(y) * BigInt(s));
            const second = BigInt.asIntN(32, BigInt(x) * BigInt(s) + BigInt(y) * BigInt(c));
            expect(evaluate(formula.x, { x, y, c, s })).toBe(Number(BigInt.asUintN(16, first >> 14n)));
            expect(evaluate(formula.y, { x, y, c, s })).toBe(Number(BigInt.asUintN(16, second >> 14n)));
          }
    expect(evaluate(formula.x, { x: -1, y: 0, c: 1, s: 0 })).toBe(65535);
  });
});
