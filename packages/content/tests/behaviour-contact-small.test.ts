import { describe, expect, it } from "vitest";
import type { Expression, Predicate } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverContactSmall } from "../src/read/behaviour-contact-small.ts";

function assembler(origin: number) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; name: string }[] = [];
  return {
    bytes,
    labels,
    emit: (...b: number[]) => bytes.push(...b),
    label: (name: string) => labels.set(name, origin + bytes.length),
    jump(name: string, opcode: number) {
      bytes.push(opcode, 0);
      patches.push({ at: bytes.length - 1, name });
    },
    finish() {
      for (const p of patches) {
        const delta = labels.get(p.name)! - origin - p.at - 1;
        if (delta < -128 || delta > 127) throw new Error("Synthetic branch out of range");
        bytes[p.at] = delta & 255;
      }
      return bytes;
    },
  };
}
const read = (bytes: number[], origin = 0x100, image = new Uint8Array(0x1000)) => {
  image.set(bytes, origin);
  return { image, code: readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0) };
};
function extension(origin = 0x100) {
  const a = assembler(origin);
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x8b, 0x44, 4, 0x2b, 4, 0x8b, 0xd0, 0x0b, 0xd2);
  a.jump("xnegative", 0x7e);
  a.emit(0xff, 0x44, 4);
  a.jump("y", 0xeb);
  a.label("xnegative");
  a.emit(0x0b, 0xd2);
  a.jump("y", 0x7d);
  a.emit(0xff, 0x4c, 4);
  a.label("y");
  a.emit(0x8b, 0x44, 6, 0x2b, 0x44, 2, 0x8b, 0xd0, 0x0b, 0xd2);
  a.jump("ynegative", 0x7e);
  a.emit(0xff, 0x44, 6);
  a.jump("done", 0xeb);
  a.label("ynegative");
  a.emit(0x0b, 0xd2);
  a.jump("done", 0x7d);
  a.emit(0xff, 0x4c, 6);
  a.label("done");
  a.emit(0x5e, 0x5d, 0xcb);
  return read(a.finish(), origin);
}
function membership(bridge = false, origin = 0x100) {
  const a = assembler(origin),
    type = 0x20,
    link = 0x30;
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0x83, 0x7d, type, 17);
  a.jump("zero", 0x75);
  a.emit(0x8b, 0x75, link);
  a.jump("header", 0xeb);
  a.label("body");
  a.emit(0x3b, 0x76, 8);
  a.jump("next", 0x75);
  a.emit(0xb8, 1, 0);
  a.label("bridge");
  a.jump("done", 0xeb);
  a.label("next");
  a.emit(0x8b, 0x74, link);
  a.label("header");
  a.emit(0x0b, 0xf6);
  a.jump("body", 0x75);
  a.label("zero");
  a.emit(0x33, 0xc0);
  if (bridge) a.jump("bridge", 0xeb);
  a.label("done");
  a.emit(0x5f, 0x5e, 0x5d, 0xcb);
  return read(a.finish(), origin);
}
function range(origin = 0x600) {
  const a = assembler(origin);
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x8b, 0x5e, 8, 0x8b, 0x4e, 10, 0x3b, 0xd9);
  a.jump("ascending", 0x7e);
  a.emit(0x8b, 0xc6, 0x2b, 0xc1, 0x8b, 0xd3, 0x2b, 0xd1, 0x3b, 0xc2);
  a.jump("rejectBridge", 0x77);
  a.label("one");
  a.emit(0xb8, 1, 0);
  a.jump("done", 0xeb);
  a.label("rejectBridge");
  a.jump("zero", 0xeb);
  a.label("ascending");
  a.emit(0x8b, 0xc6, 0x2b, 0xc3, 0x8b, 0xd1, 0x2b, 0xd3, 0x3b, 0xc2);
  a.jump("zero", 0x77);
  a.jump("one", 0xeb);
  a.label("zero");
  a.emit(0x33, 0xc0);
  a.label("done");
  a.emit(0x5e, 0x5d, 0xcb);
  return read(a.finish(), origin);
}
function sides(far = false, origin = 0x100, missingBridge = false) {
  const r = range(),
    a = assembler(origin),
    target = r.code.address;
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 10, 0xff, 0x74, 4, 0xff, 0x34, 0xff, 0x76, 8);
  if (far) a.emit(0x9a, target & 255, target >> 8, 0, 0);
  else {
    a.emit(0x90);
    if (!missingBridge) a.emit(0x0e);
    const d = target - origin - a.bytes.length - 3;
    a.emit(0xe8, d & 255, (d >> 8) & 255);
  }
  a.emit(0x83, 0xc4, 6, 0x0b, 0xc0);
  a.jump("outside", 0x74);
  a.emit(0xc6, 0x45, 2, 1);
  a.jump("three", 0xeb);
  a.label("outside");
  a.emit(0x8b, 4, 0x3b, 0x44, 4);
  a.jump("reverse", 0x7d);
  a.emit(0x3b, 0x46, 8);
  a.jump("two", 0x7e);
  a.jump("three", 0xeb);
  a.label("two");
  a.emit(0xc6, 0x45, 2, 1);
  a.jump("done", 0xeb);
  a.label("reverse");
  a.emit(0x8b, 0x44, 4, 0x3b, 0x46, 8);
  a.jump("three", 0x7e);
  a.jump("two", 0xeb);
  a.label("three");
  a.emit(0xc6, 0x45, 3, 1);
  a.label("done");
  a.emit(0x5f, 0x5e, 0x5d, 0xcb);
  const { code } = read(a.finish(), origin, r.image);
  return {
    code,
    range: r.code,
    codes: new Map([
      [code.address, code],
      [r.code.address, r.code],
    ]),
  };
}

// These evaluate the extracted plain expressions on synthetic scalar inputs, never decoded instructions or callbacks.
const signed = (n: number) => (n & 0x8000 ? (n & 65535) - 65536 : n & 65535);
function value(e: Expression, words: Record<string, number>): number {
  if (e.kind === "constant") return e.value & (2 ** e.width - 1);
  if (e.kind === "field") return words[e.object + ":" + e.offset]! & 65535;
  if (e.kind !== "binary") throw new Error("Unexpected extracted expression");
  const a = value(e.left, words),
    b = value(e.right, words);
  if (e.operator === "+") return (a + b) & 65535;
  if (e.operator === "-") return (a - b) & 65535;
  if (e.operator === "*") return (a * b) & 65535;
  if (e.operator === "^") return a ^ b;
  if (e.operator === "|") return a | b;
  if (e.operator === "<=") return Number(a <= b);
  if (e.operator === "==") return Number(a === b);
  throw new Error("Unexpected operator");
}
function holds(p: Predicate, words: Record<string, number>): boolean {
  if (p.kind === "true") return true;
  if (p.kind === "and") return p.terms.every((t) => holds(t, words));
  if (p.kind !== "compare") throw new Error("Unexpected extracted predicate");
  const a = p.signed ? signed(value(p.left, words)) : value(p.left, words),
    b = p.signed ? signed(value(p.right, words)) : value(p.right, words);
  if (p.operator === "<") return a < b;
  if (p.operator === "<=") return a <= b;
  if (p.operator === ">") return a > b;
  if (p.operator === ">=") return a >= b;
  if (p.operator === "==") return a === b;
  if (p.operator === "!=") return a !== b;
  throw new Error("Unexpected comparison");
}

describe("small contact helpers", () => {
  it.each([0x100, 0x200])("certifies endpoint extension and its pre-write return at %s", (origin) => {
    const { code } = extension(origin),
      result = discoverContactSmall(code, new Map())!;
    expect(result.contactSmall.kind).toBe("endpoint-extension");
    expect(result.writes.map((w) => [w.offset, w.width])).toEqual([
      [4, 16],
      [4, 16],
      [6, 16],
      [6, 16],
    ]);
    expect(result.returns).toEqual([]);
    for (const [start, end, expected] of [
      [0, 1, 2],
      [1, 0, 65535],
      [1, 1, 1],
      [65535, 0, 1],
      [0, 32768, 32767],
      [65535, 32767, 32766],
    ]) {
      const words = { "part:0": start!, "part:4": end! },
        writes = result.writes.filter((w) => w.offset === 4 && holds(w.condition, words));
      expect(writes.length).toBeLessThanOrEqual(1);
      expect(writes.length ? value(writes[0]!.value, words) : end).toBe(expected);
    }
    expect(result.writes.every((w) => w.evidence.length === 1 && w.evidence[0]!.bytes.length > 0)).toBe(true);
  });
  it.each([false, true])("certifies typed list membership without inventing a numeric choice: bridge=%s", (bridge) => {
    const { code } = membership(bridge),
      result = discoverContactSmall(code, new Map())!;
    expect(result.contactSmall).toMatchObject({
      kind: "typed-list-membership",
      requiredType: 17,
      typeField: 0x20,
      headField: 0x30,
      nextField: 0x30,
      normalReturnValues: [0, 1],
    });
    expect(result.writes).toEqual([]);
    expect(result.returns).toEqual([]);
    expect(result.footprint.preservesArgumentMemory).toBe(true);
  });
  it.each([false, true])("certifies sticky side flags with the checked range callee: far=%s", (far) => {
    const f = sides(far),
      result = discoverContactSmall(f.code, f.codes)!;
    expect(result.contactSmall.kind).toBe("direction-side-flags");
    if (result.contactSmall.kind !== "direction-side-flags") throw new Error("No side relation");
    expect(result.contactSmall.rangeRoutine).toBe(f.range.address);
    expect(result.returns).toEqual([]);
    for (const [a, b, coordinate, flags] of [
      [0, 10, 5, [2, 3]],
      [0, 10, 0, [2, 3]],
      [0, 10, 11, [2]],
      [0, 10, 65535, [3]],
      [10, 0, 11, [3]],
      [10, 0, 65535, [2]],
      [0, 0, 0, [2, 3]],
      [0, 0, 1, [3]],
      [65535, 1, 0, [2, 3]],
    ] as const) {
      const words = { "part:0": a, "part:4": b, "argument:8": coordinate },
        cases = result.contactSmall.cases.filter((c) => holds(c.condition, words));
      expect(cases).toHaveLength(1);
      expect(cases[0]!.flags).toEqual(flags);
      expect(result.writes.filter((w) => holds(w.condition, words)).map((w) => w.offset)).toEqual(flags);
    }
    expect(
      result.writes.every(
        (w) => w.argumentOffset === 10 && w.width === 8 && w.value.kind === "constant" && w.value.value === 1,
      ),
    ).toBe(true);
  });
  it("rejects the wrong return convention, signed direction branch and endpoint pointer", () => {
    for (const mutate of [
      (c: ReturnType<typeof extension>["code"]) => {
        c.instructions.at(-1)!.mnemonic = "ret";
      },
      (c: ReturnType<typeof extension>["code"]) => {
        c.instructions.find((i) => i.mnemonic === "jle")!.mnemonic = "jbe";
      },
      (c: ReturnType<typeof extension>["code"]) => {
        const o = c.instructions[3]!.operands[1]!;
        if (o.kind === "memory") o.displacement = 8;
      },
    ]) {
      const { code } = extension();
      mutate(code);
      expect(discoverContactSmall(code, new Map())).toBeUndefined();
    }
  });
  it("requires the same list link and every complete CFG edge", () => {
    const f = membership(),
      load = f.code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          i.operands[0]?.kind === "register" &&
          i.operands[0].name === "si" &&
          i.operands[1]?.kind === "memory" &&
          i.operands[1].base.join() === "si",
      )!;
    if (load.operands[1]?.kind === "memory") load.operands[1].displacement += 2;
    expect(discoverContactSmall(f.code, new Map())).toBeUndefined();
    const g = membership();
    g.code.edges.push({ from: g.code.address, to: g.code.instructions.at(-1)!.address, kind: "jump" });
    expect(discoverContactSmall(g.code, new Map())).toBeUndefined();
  });
  it("rejects a missing near-to-far bridge and an uncertified range helper", () => {
    const f = sides(false, 0x100, true);
    expect(discoverContactSmall(f.code, f.codes)).toBeUndefined();
    const g = sides();
    g.range.instructions.find((i) => i.mnemonic === "ja")!.mnemonic = "jg";
    expect(discoverContactSmall(g.code, g.codes)).toBeUndefined();
    const h = sides();
    h.codes.delete(h.range.address);
    expect(discoverContactSmall(h.code, h.codes)).toBeUndefined();
  });
  it("rejects a changed side write or incomplete graph", () => {
    const f = sides(),
      store = f.code.instructions.find(
        (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].width === 8,
      )!;
    if (store.operands[1]?.kind === "immediate") store.operands[1].value = 0;
    expect(discoverContactSmall(f.code, f.codes)).toBeUndefined();
    const g = extension();
    g.code.status = "partial";
    expect(discoverContactSmall(g.code, new Map())).toBeUndefined();
  });
});
