import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverConnectionBypass } from "../src/read/behaviour-connection-bypass.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

/** Assembles synthetic compiler shapes with different object fields, code positions and table segments. */
function fixture(shared = false, dataTable = false, origin = 0) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; width: number; name: string }[] = [];
  const emit = (...values: number[]) => bytes.push(...values);
  const label = (name: string) => labels.set(name, bytes.length + origin);
  const jump = (name: string, opcode = 0xe9) => {
    emit(opcode);
    const width = opcode === 0xe9 ? 2 : 1;
    patches.push({ at: bytes.length, width, name });
    emit(...Array<number>(width).fill(0));
  };
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 16, 0x56, 0x57, 0x8b, 0x7e, 8);
  emit(0xf7, 0x45, 0x24, 0, 1);
  jump("scan", 0x74);
  emit(0xb8, 1, 0);
  label("bridge");
  jump("done");
  label("scan");
  emit(0xc7, 0x46, 0xfc, 0, 0, 0xc7, 0x46, 0xfe, 0, 0);
  jump("header");
  label("body");
  emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x41, 0x40, 0x8b, 0xf0, 0x0b, 0xc0);
  jump("nonnull", 0x75);
  jump("update");
  label("nonnull");
  emit(0x56, 0x57, 0x9a, 0, 3, 0, 0, 0x59, 0x59, 0x89, 0x46, 0xf0);
  if (shared) emit(0x8b, 0x46, 0xf0);
  emit(0x3b, 0x46, 6);
  jump("classify", 0x75);
  jump("update");
  label("classify");
  emit(0x39, 0x7c, 2);
  jump("second", 0x75);
  emit(0xc7, 0x46, 0xfa, 0, 0, 0x8a, 0x44, 10, 0xb4, 0, 0x89, 0x46, 0xf8, 0x8a, 0x44, 11);
  jump("index");
  label("second");
  emit(0xc7, 0x46, 0xfa, 1, 0, 0x8a, 0x44, 11, 0xb4, 0, 0x89, 0x46, 0xf8, 0x8a, 0x44, 10);
  label("index");
  emit(0xb4, 0, 0x89, 0x46, 0xf6, 0x83, 0x7d, 0x18, 0);
  jump("negative", 0x7e);
  emit(0x83, 0x7e, 0xf8, 0);
  jump("one", 0x75);
  if (shared) {
    emit(0xc7, 0x46, 0xf2, 0, 0);
    jump("directionBridge");
  } else jump("zero");
  label("one");
  emit(0xc7, 0x46, 0xf2, 1, 0);
  label("directionBridge");
  jump("direction");
  label("negative");
  emit(0x83, 0x7e, 0xf8, 0);
  jump("zero", 0x75);
  if (shared) {
    emit(0xc7, 0x46, 0xf2, 1, 0);
    jump("direction");
  } else jump("one");
  label("zero");
  emit(0xc7, 0x46, 0xf2, 0, 0);
  label("direction");
  emit(0xff, 0x76, 0xf2, 0xff, 0x76, 0xfa, 0x56, 0x9a, 0x20, 3, 0, 0);
  emit(0x83, 0xc4, 6, 0x89, 0x46, 0xf4, 0x8b, 0x46, 10, 0x09, 0x46, 0xf4);
  emit(0xff, 0x76, 16, 0xff, 0x76, 14, 0xff, 0x76, 12, 0xff, 0x76, 0xf4, 0xff, 0x76, 0xf6, 0xff, 0x76, 0xf0, 0x57);
  emit(0x8b, 0x5e, 0xf0, 0x8b, 0x47, 6, 0xba, 58, 0, 0xf7, 0xea);
  if (!dataTable) emit(0xba, 0x30, 0);
  emit(0x8b, 0xd8);
  if (!dataTable) emit(0x8e, 0xc2);
  label("dispatch");
  emit(...(dataTable ? [0xff, 0x9f, 0x50, 2] : [0x26, 0xff, 0x9f, 54, 0]));
  emit(0x83, 0xc4, 14, 0x89, 0x46, 0xfc);
  label("update");
  emit(0xff, 0x46, 0xfe);
  label("header");
  emit(0x83, 0x7e, 0xfe, 2);
  jump("finish", 0x7d);
  emit(0x83, 0x7e, 0xfc, 0);
  jump("finish", 0x75);
  jump("body");
  label("finish");
  emit(0x8b, 0x46, 0xfc);
  if (shared) jump("bridge");
  label("done");
  emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  for (const patch of patches) {
    const delta = labels.get(patch.name)! - (origin + patch.at + patch.width);
    if (patch.width === 1 && (delta < -128 || delta > 127)) throw new Error("Synthetic short branch is out of range");
    bytes[patch.at] = delta & 255;
    if (patch.width === 2) bytes[patch.at + 1] = (delta >> 8) & 255;
  }
  const image = new Uint8Array(0x400).fill(0x66);
  image.set(bytes, origin);
  image[0x300] = image[0x320] = 0xcb;
  return { code: readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0), labels };
}

describe("connection query bypass certificates", () => {
  it.each([
    [false, false],
    [true, false],
    [true, true],
    [false, true],
  ])("proves both no-call cases with shared return %s and data table %s", (shared, dataTable) => {
    const { code } = fixture(shared, dataTable, 0x20);
    const certificate = discoverConnectionBypass(code);
    expect(code.status).toBe("complete");
    expect(certificate).toMatchObject({ ownerArgument: 8, argumentOffset: 6, confidence: "inferred" });
    expect(certificate!.cases.map((c) => c.value)).toEqual([
      { kind: "constant", value: 1, width: 16 },
      { kind: "constant", value: 0, width: 16 },
    ]);
    const text = JSON.stringify(certificate!.cases);
    expect(text).toContain('"offset":36');
    expect(text).toContain('"offset":64');
    expect(text).toContain('"offset":66');
    expect(certificate!.remaining).toMatchObject({ kind: "and" });
    expect(certificate!.evidence).toHaveLength(code.instructions.length);
    expect(code.calls.at(-1)!.target).toBeUndefined();
  });

  it("rejects an additional edge bypassing the null guard", () => {
    const { code, labels } = fixture();
    code.edges.push({ from: labels.get("body")!, to: labels.get("dispatch")!, kind: "jump" });
    expect(discoverConnectionBypass(code)).toBeUndefined();
  });

  it("rejects a changed loop limit or nonzero initial result", () => {
    for (const name of ["scan", "header"]) {
      const { code, labels } = fixture();
      const instruction = code.instructions.find((i) => i.address === labels.get(name))!;
      const value = instruction.operands[1]!;
      if (value.kind === "immediate") value.value++;
      expect(discoverConnectionBypass(code)).toBeUndefined();
    }
  });

  it("rejects a null branch changed to a call path", () => {
    const { code, labels } = fixture();
    const jump = code.instructions.find((i) => i.mnemonic === "jmp" && i.target?.address === labels.get("update"))!;
    jump.target = { address: labels.get("nonnull")!, segment: 0, offset: labels.get("nonnull")! };
    expect(discoverConnectionBypass(code)).toBeUndefined();
  });

  it("rejects a non-stack store on the flag-return path", () => {
    const { code } = fixture();
    const instruction = code.instructions.find(
      (i) =>
        i.mnemonic === "mov" &&
        i.operands[0]?.kind === "register" &&
        i.operands[0].name === "ax" &&
        i.operands[1]?.kind === "immediate",
    )!;
    instruction.operands[0] = {
      kind: "memory",
      segment: "ds",
      base: ["di"],
      displacement: 12,
      width: 16,
      direct: false,
    };
    expect(discoverConnectionBypass(code)).toBeUndefined();
  });

  it.each(["segment", "width", "base", "displacement"])("independently checks the indirect call's %s", (property) => {
    const { code, labels } = fixture();
    const operand = code.instructions.find((i) => i.address === labels.get("dispatch"))!.operands[0]!;
    if (operand.kind !== "memory") throw new Error("Synthetic dispatch must be indirect");
    if (property === "segment") operand.segment = "ss";
    if (property === "width") operand.width = 16;
    if (property === "base") operand.base = ["si"];
    if (property === "displacement") operand.displacement++;
    expect(discoverConnectionBypass(code)).toBeUndefined();
  });

  it("rejects a changed nonnull callback argument bridge", () => {
    const { code } = fixture();
    const cleanup = code.instructions.find(
      (i) => i.mnemonic === "add" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 14,
    )!;
    if (cleanup.operands[1]?.kind === "immediate") cleanup.operands[1].value = 12;
    expect(discoverConnectionBypass(code)).toBeUndefined();
  });

  it("uses discovered layout fields and the recorded dispatch site", () => {
    const { code, labels } = fixture();
    const fact = { confidence: "checked" as const, evidence: [], assumptions: [] };
    const layout: BehaviourLayout = {
      objectArgument: fact,
      fields: [{ ...fact, name: "drawingFlags", offset: 0x24 }],
      callbacks: [{ ...fact, role: "rope", field: 54, sites: [labels.get("dispatch")!] }],
      diagnostics: [],
    };
    expect(discoverConnectionBypass(code, layout)).toBeDefined();
    layout.fields[0]!.offset++;
    expect(discoverConnectionBypass(code, layout)).toBeUndefined();
    layout.fields[0]!.offset--;
    layout.callbacks[0]!.sites = [];
    expect(discoverConnectionBypass(code, layout)).toBeUndefined();
  });
});
