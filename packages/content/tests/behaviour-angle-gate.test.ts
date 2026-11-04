import { describe, expect, it } from "vitest";
import { discoverAngleGate } from "../src/read/behaviour-angle-gate.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { Expression } from "../src/read/behaviour.ts";

function fixture(options: { shared?: boolean; classifierNear?: boolean; farCall?: boolean; origin?: number } = {}) {
  const origin = options.origin ?? 0x40,
    shared = options.shared ?? false;
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; name: string; width: number }[] = [];
  const emit = (...values: number[]) => bytes.push(...values);
  const label = (name: string) => labels.set(name, bytes.length + origin);
  const jump = (name: string, opcode = 0xe9) => {
    emit(opcode);
    const width = opcode === 0xe9 ? 2 : 1;
    patches.push({ at: bytes.length, name, width });
    emit(...Array<number>(width).fill(0));
  };
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x57, 0x83, 0x3e, 0, 5, 0);
  jump("enabled", 0x75);
  if (shared) {
    label("zeroEntry");
    emit(0x33, 0xc0);
    label("bridge");
    jump("done");
  } else jump("zero");
  label("enabled");
  emit(0xff, 0x76, 6, 0x90);
  if (!options.classifierNear && !options.farCall) emit(0x0e);
  if (options.farCall) emit(0x9a, 0, 3, 0, 0);
  else {
    emit(0xe8);
    const displacement = 0x300 - (origin + bytes.length + 2);
    emit(displacement & 255, (displacement >> 8) & 255);
  }
  emit(0x59, 0x89, 0x46, 0xfe);
  if (shared) emit(0x8b, 0x46, 0xfe);
  emit(0x3b, 6, 4, 5);
  jump("prepare", 0x74);
  jump(shared ? "zeroEntry" : "zero");
  label("prepare");
  emit(0xc7, 0x46, 0xfc, 0, 0, 0x8b, 0x46, 6, 5, 0, 0x20, 0x8b, 0xf0, 0xa1, 8, 5, 5, 0, 0x20, 0x8b, 0xf8);
  emit(0x0b, 0xf6);
  jump("second", 0x7c);
  emit(0x81, 0xfe, 0, 0x40);
  jump("second", 0x7f);
  emit(0x0b, 0xff);
  jump("second", 0x7c);
  emit(0x81, 0xff, 0, 0x40);
  jump("second", 0x7f);
  if (shared) {
    emit(0xc7, 0x46, 0xfc, 1, 0);
    jump("check");
  } else jump("accept");
  label("second");
  emit(0x8b, 0x46, 6, 5, 0, 0xa0, 0x8b, 0xf0, 0xa1, 8, 5, 5, 0, 0xa0, 0x8b, 0xf8);
  emit(0x0b, 0xf6);
  jump("check", 0x7c);
  emit(0x81, 0xfe, 0, 0x40);
  jump("check", 0x7f);
  emit(0x0b, 0xff);
  jump("check", 0x7c);
  emit(0x81, 0xff, 0, 0x40);
  jump("check", 0x7f);
  label("accept");
  emit(0xc7, 0x46, 0xfc, 1, 0);
  label("check");
  emit(0x83, 0x7e, 0xfc, 0);
  jump("zero", 0x74);
  emit(0x8b, 0x46, 6, 0x3b, 6, 8, 5);
  jump("pivot", 0x75);
  if (shared) jump("true");
  else {
    label("true");
    emit(0xb8, 1, 0);
    jump("done");
  }
  label("pivot");
  emit(0x81, 0xfe, 0, 0x20);
  jump("both", 0x74);
  emit(0x81, 0xff, 0, 0x20);
  jump("sides", 0x75);
  label("both");
  jump("true");
  label("sides");
  emit(0x81, 0xfe, 0, 0x20);
  jump("above", 0x7d);
  emit(0x81, 0xff, 0, 0x20);
  jump("above", 0x7d);
  jump("true");
  label("above");
  emit(0x81, 0xfe, 0, 0x20);
  jump("zero", 0x7e);
  emit(0x81, 0xff, 0, 0x20);
  jump("zero", 0x7e);
  if (shared) {
    label("true");
    emit(0xb8, 1, 0);
    jump("bridge");
  } else jump("true");
  label("zero");
  if (shared) jump("zeroEntry");
  else emit(0x33, 0xc0);
  label("done");
  emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  for (const patch of patches) {
    const delta = labels.get(patch.name)! - (origin + patch.at + patch.width);
    if (patch.width === 1 && (delta < -128 || delta > 127)) throw new Error("Synthetic short branch is out of range");
    bytes[patch.at] = delta & 255;
    if (patch.width === 2) bytes[patch.at + 1] = (delta >> 8) & 255;
  }
  const image = new Uint8Array(0x600).fill(0x66);
  image.set(bytes, origin);
  image.set(
    [
      0x55,
      0x8b,
      0xec,
      0x8b,
      0x56,
      options.classifierNear ? 4 : 6,
      0x81,
      0xfa,
      0,
      0x20,
      0x75,
      4,
      0x33,
      0xc0,
      0xeb,
      25,
      0x81,
      0xfa,
      0,
      0xa0,
      0x75,
      5,
      0xb8,
      2,
      0,
      0xeb,
      14,
      0x81,
      0xc2,
      0,
      0x20,
      0xb1,
      14,
      0xd3,
      0xfa,
      0x81,
      0xe2,
      3,
      0,
      0x8b,
      0xc2,
      0x5d,
      options.classifierNear ? 0xc3 : 0xcb,
    ],
    0x300,
  );
  const classifier = readRoutineCode(image, { address: 0x300, segment: 0, offset: 0x300 }, 0);
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  expect(code.status).toBe("complete");
  return { code, classifier, codes: new Map([[classifier.address, classifier]]), labels };
}

/** This evaluates the extracted scalar algebra, never an instruction stream or a callback. */
function valueOf(e: Expression, a: number, b: number, q: number, enabled: number): number {
  if (e.kind === "constant") return e.value;
  if (e.kind === "field") {
    if (e.object === "argument") return a;
    if (e.object === "data") return e.offset === 0x500 ? enabled : e.offset === 0x504 ? q : b;
  }
  if (e.kind !== "binary") throw new Error("Expected scalar relation");
  const left = valueOf(e.left, a, b, q, enabled),
    right = valueOf(e.right, a, b, q, enabled);
  switch (e.operator) {
    case "+":
      return (left + right) & 65535;
    case "*":
      return (left * right) & 65535;
    case "|":
      return left | right;
    case "<=":
      return Number(left <= right);
    case ">=":
      return Number(left >= right);
    case "==":
      return Number(left === right);
    case "!=":
      return Number(left !== right);
    default:
      throw new Error("Unexpected scalar operator");
  }
}
function expected(a: number, b: number, q: number, enabled: number): number {
  if (!enabled) return 0;
  const sector = a <= 0x2000 ? 0 : a <= 0x5fff ? 1 : a <= 0xa000 ? 2 : a <= 0xdfff ? 3 : 0;
  if (sector !== q) return 0;
  const first = (a <= 0x2000 || a >= 0xe000) && (b <= 0x2000 || b >= 0xe000);
  const second = a >= 0x6000 && a <= 0xa000 && b >= 0x6000 && b <= 0xa000;
  return Number(
    (first && ((a <= 0x2000 && b <= 0x2000) || (a >= 0xe000 && b >= 0xe000) || a === 0 || b === 0)) ||
      (second && ((a <= 0x8000 && b <= 0x8000) || (a >= 0x8000 && b >= 0x8000))),
  );
}

describe("saved-angle gate summary", () => {
  it.each([false, true])("matches the complete relocated compiler shape with shared return %s", (shared) => {
    const { code, classifier, codes } = fixture({ shared, origin: 0x80 });
    const summary = discoverAngleGate(code, codes);
    expect(summary).toMatchObject({
      kind: "saved-angle-gate",
      argumentOffset: 6,
      argumentKind: "scalar",
      footprint: { complete: true, preservesArgumentMemory: true },
    });
    expect(summary!.evidence).toHaveLength(code.instructions.length + classifier.instructions.length);
    const size = (e: Expression): number => (e.kind === "binary" ? 1 + size(e.left) + size(e.right) : 1);
    expect(size(summary!.returns[0]!.value)).toBeLessThan(96);
  });

  it.each([{ farCall: true }, { classifierNear: true }])("checks the classifier calling convention %j", (options) => {
    const { code, codes } = fixture(options);
    expect(discoverAngleGate(code, codes)).toBeDefined();
  });

  it("covers window, pivot and classifier boundaries without assuming saved-class consistency", () => {
    const { code, codes } = fixture();
    const relation = discoverAngleGate(code, codes)!.returns[0]!.value;
    const points = [
      ...new Set([0, 1, 65535, ...[0x2000, 0x6000, 0x8000, 0xa000, 0xe000].flatMap((n) => [n - 1, n, n + 1])]),
    ];
    for (const a of points)
      for (const b of points)
        for (const q of [0, 1, 2, 3, 4, 65535])
          for (const enabled of [0, 1, 65535]) {
            expect(valueOf(relation, a, b, q, enabled)).toBe(expected(a, b, q, enabled));
          }
  });

  it("covers every scalar input against both window pivots", () => {
    const { code, codes } = fixture();
    const relation = discoverAngleGate(code, codes)!.returns[0]!.value;
    for (const [b, q] of [
      [0, 0],
      [0x8000, 2],
    ])
      for (let a = 0; a < 65536; a++) {
        if (valueOf(relation, a, b!, q!, 1) !== expected(a, b!, q!, 1)) throw new Error(`Wrong gate at ${a},${b}`);
      }
  });

  it("rejects an uncertified classifier, extra CFG edge or changed window", () => {
    for (const change of ["classifier", "edge", "window"]) {
      const { code, classifier, codes, labels } = fixture();
      if (change === "classifier") classifier.instructions.find((i) => i.mnemonic === "sar")!.mnemonic = "shr";
      if (change === "edge") code.edges.push({ from: code.address, to: labels.get("accept")!, kind: "jump" });
      if (change === "window") {
        const add = code.instructions.find((i) => i.mnemonic === "add")!;
        if (add.operands[1]?.kind === "immediate") add.operands[1].value++;
      }
      expect(discoverAngleGate(code, codes)).toBeUndefined();
    }
  });

  it("rejects overlapping global words or an added non-stack store", () => {
    for (const store of [false, true]) {
      const { code, codes } = fixture();
      if (store) {
        const source = code.instructions.find(
          (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "memory" && i.operands[1].segment === "ds",
        )!;
        source.operands.reverse();
      } else {
        for (const i of code.instructions)
          for (const operand of i.operands)
            if (operand.kind === "memory" && operand.segment === "ds" && operand.displacement === 0x508)
              operand.displacement = 0x504;
      }
      expect(discoverAngleGate(code, codes)).toBeUndefined();
    }
  });

  it("rejects an incompatible far call to a near-return classifier", () => {
    const { code, codes } = fixture({ classifierNear: true, farCall: true });
    expect(discoverAngleGate(code, codes)).toBeUndefined();
  });
});
