import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverCollisionDispatch, describeCollisionDispatch } from "../src/read/behaviour-collision-dispatch.ts";
import { matchInstructionRegion } from "../src/read/behaviour-heap-release.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
import type { ProgramParts } from "../src/read/parts.ts";

const finding = { confidence: "inferred" as const, evidence: [], assumptions: [] };
function fixture(origin = 0x80, table = 0x1000, special = false) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; label: string; width: number }[] = [];
  const emit = (...b: number[]) => bytes.push(...b),
    word = (n: number) => [n & 255, (n >>> 8) & 255];
  const label = (name: string) => labels.set(name, origin + bytes.length);
  const jump = (op: number, name: string) => {
    const width = op === 0xe9 ? 2 : 1;
    emit(op, ...Array(width).fill(0));
    patches.push({ at: bytes.length - width, label: name, width });
  };
  const near = (target: number) => {
    const next = origin + bytes.length + 3;
    emit(0xe8, ...word(target - next));
  };
  const response = (target: number) => {
    emit(0x56, 0x90, 0x0e);
    near(target);
  };
  const sites: number[] = [];
  const dispatch = () => {
    emit(0x56, 0x8b, 0x9c, 0x84, 0, 0x8b, 0x47, 4, 0xba, 58, 0, 0xf7, 0xea);
    if (special) emit(0xba, ...word(table >>> 4));
    emit(0x8b, 0xd8);
    if (special) emit(0x8e, 0xc2);
    sites.push(origin + bytes.length);
    emit(...(special ? [0x26] : []), 0xff, 0x9f, ...word(special ? 34 : table + 34), 0x59, 0x0b, 0xc0);
  };
  emit(0x55, 0x8b, 0xec, 0x56);
  label("entry");
  emit(0x8b, 0x36, 0, 8);
  jump(special ? 0xe9 : 0xeb, "header");
  label("body");
  emit(0xf7, 0x44, 6, 8, 0);
  if (special) {
    jump(0x74, "drawGate");
    jump(0xe9, "advance");
  } else jump(0x75, "advance");
  label("drawGate");
  emit(0xf7, 0x44, 8, 0, 32);
  if (special) {
    jump(0x74, "selfGate");
    jump(0xe9, "advance");
  } else jump(0x75, "advance");
  label("selfGate");
  if (special) {
    emit(0xf7, 0x44, 6, 6, 0);
    jump(0x74, "firstGate");
    emit(0x83, 0x7c, 4, 54);
    jump(0x75, "firstGate");
    emit(0x56, 0xb8, ...word(table >>> 4), 0x8e, 0xc0, 0x26, 0xff, 0x1e, ...word(54 * 58 + 34), 0x59);
  }
  label("firstGate");
  emit(0xf7, 0x44, 6, 2, 0);
  jump(0x74, "second");
  dispatch();
  jump(0x74, special ? "advance" : "firstEnd");
  emit(0xf7, 0x44, 6, 1, 0);
  jump(0x74, "otherResponse");
  if (special) {
    emit(0x83, 0x7c, 4, 54);
    jump(0x74, "otherResponse");
  }
  response(0x600);
  jump(0xeb, "cleanup");
  label("otherResponse");
  response(0x610);
  if (special) jump(0xeb, "cleanup");
  else {
    label("cleanup");
    emit(0x59);
    label("firstEnd");
    jump(0xeb, "advance");
  }
  label("second");
  emit(0xf7, 0x44, 6, 4, 0);
  jump(0x74, "advance");
  dispatch();
  jump(0x74, "advance");
  response(0x620);
  if (special) label("cleanup");
  emit(0x59);
  label("advance");
  emit(0x8b, 0x34);
  label("header");
  emit(0x0b, 0xf6);
  if (special) {
    jump(0x74, "exit");
    jump(0xe9, "body");
  } else jump(0x75, "body");
  label("exit");
  emit(0x5e, 0x5d, 0xcb);
  for (const p of patches) {
    const delta = labels.get(p.label)! - origin - p.at - p.width;
    if (p.width === 1 && (delta < -128 || delta > 127)) throw new Error("Synthetic branch out of range");
    bytes[p.at] = delta & 255;
    if (p.width === 2) bytes[p.at + 1] = (delta >> 8) & 255;
  }
  const image = new Uint8Array(0x3000);
  image.set(bytes, origin);
  image.set([0x33, 0xc0, 0xcb], 0x500);
  image.set([0xb8, 1, 0, 0xcb], 0x510);
  for (const at of [0x600, 0x610, 0x620]) image[at] = 0xcb;
  const types = Array.from({ length: special ? 55 : 2 }, (_, n) => n);
  for (const n of types) image.set([...word(n === 0 ? 0x500 : 0x510), 0, 0], table + n * 58 + 34);
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  const codes = new Map(
    [
      code,
      ...[0x500, 0x510, 0x600, 0x610, 0x620].map((address) =>
        readRoutineCode(image, { address, segment: 0, offset: address }, 0),
      ),
    ].map((c) => [c.address, c]),
  );
  const layout: BehaviourLayout = {
    fields: [],
    callbacks: [{ role: "bounce", field: 34, sites, ...finding }],
    objectArgument: finding,
    diagnostics: [],
  };
  const program: Pick<ProgramParts, "table" | "records" | "dataSegment" | "list"> = {
    table,
    dataSegment: 0,
    list: {
      id: "synthetic",
      game: "Synthetic",
      parts: [
        { id: "first", type: 0, sheets: [], frames: [] },
        { id: "second", type: 1, sheets: [], frames: [] },
      ],
    },
    records: types.map((type) => ({
      type,
      at: table + type * 58,
      bytes: image.slice(table + type * 58, table + (type + 1) * 58),
    })),
  };
  return {
    image,
    code,
    codes,
    layout,
    program,
    labels,
    discover: () => discoverCollisionDispatch(image, codes, layout, program),
  };
}

describe("collision callback routing", () => {
  it.each([
    [0x80, 0x1000],
    [0x200, 0x1400],
  ])("binds a relocated complete region at %i", (origin, table) => {
    const f = fixture(origin, table),
      [c] = f.discover();
    expect(f.code.status).toBe("complete");
    expect(c).toBeDefined();
    expect(c!.entry).toBe(f.labels.get("entry"));
    expect(c!.exit).toBe(f.labels.get("exit"));
    expect(c!.selection).toMatchObject({
      table,
      owner: "recordedContactPartner",
      ownerPath: [132],
      argument: "collider",
      argumentOffset: 6,
    });
    expect(c!.selection.targets.map((t) => [t.type, t.address, t.constantReturn])).toEqual([
      [0, 0x500, 0],
      [1, 0x510, 1],
    ]);
    expect(c!.passes.map((p) => p.priority)).toEqual(["first", "onlyWhenFirstMaskClear"]);
    expect(c!.passes[0]!.callbackNonzero.map((r) => r.routine)).toEqual([0x600, 0x610]);
    expect(c!.passes[1]!.callbackNonzero[0]!.routine).toBe(0x620);
    expect(c!.passes.every((p) => p.responseConditionsReadAfterCallback)).toBe(true);
    expect(c!.advance).toBe("readCurrentNextAfterCallbacks");
    expect(c!.evidence.some((e) => e.address === f.layout.callbacks[0]!.sites[0] && e.bytes[0] === 0xff)).toBe(true);
    expect(f.code.calls.filter((c) => !c.target)).toHaveLength(2);
  });
  it("links independently certified helper effects without turning reachability into execution", () => {
    const f = fixture();
    const helper: EngineSummary = {
      ...finding,
      address: 0x610,
      kind: "contact-resource-request",
      purpose: "Conditionally requests resource 20.",
      argumentOffset: 6,
      argumentKind: "object",
      writes: [],
      returns: [],
      calls: [],
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: ["Driver effects."],
      },
      contactResponse: {
        kind: "contact-resource-request",
        ownerArgument: 6,
        typeField: 4,
        requiredType: 0,
        velocityFields: [54, 56],
        condition: { kind: "true" },
        resource: 20,
        service: 0x900,
        arithmetic: "wrappedWordAbsoluteValuesAndSumThenSignedComparison",
        audiblePlaybackEstablished: false,
      },
    };
    const [contract] = discoverCollisionDispatch(
      f.image,
      f.codes,
      f.layout,
      f.program,
      new Map([[helper.address, helper]]),
    );
    expect(contract!.responseSupport).toHaveLength(1);
    expect(contract!.responseSupport![0]).toMatchObject({ response: 0x610, helper: 0x610 });
    expect(contract!.responseSupport![0]!.assumptions.join(" ")).toContain("does not prove that its path is taken");
    expect(contract!.passes[0]!.callbackZero).toBe("advanceWithoutResponse");
  });
  it("certifies the far table and the earlier self callback without freezing later flags", () => {
    const f = fixture(0x80, 0x1000, true),
      [c] = f.discover();
    expect(c).toBeDefined();
    expect(c!.selection.targets).toHaveLength(55);
    expect(c!.specialSelfCall).toMatchObject({
      type: 54,
      returnIgnored: true,
      laterGatesReadAfterCall: true,
      target: { address: 0x510 },
    });
    expect(c!.passes[0]!.callbackNonzero).toHaveLength(2);
    expect(c!.passes.every((p) => p.responseConditionsReadAfterCallback)).toBe(true);
    const d = describeCollisionDispatch([c!], { type: 54, routines: [{ slot: 0, address: 0x510 } as never] });
    expect(d?.selfCall).toBe(true);
    expect(d?.description).toContain("earlier self callback");
  });
  it.each(["table", "slot", "argument", "owner", "stride", "mask", "edge", "entry", "return", "record"])(
    "rejects changed %s evidence",
    (change) => {
      const f = fixture();
      const selected = f.code.instructions.find((i) => i.address === f.layout.callbacks[0]!.sites[0])!;
      if (change === "table") f.program.table++;
      if (change === "slot" && selected.operands[0]?.kind === "memory") selected.operands[0].displacement += 4;
      if (change === "argument")
        f.code.instructions.find((i) => i.mnemonic === "push" && i.address === selected.address - 15)!.operands = [
          { kind: "register", name: "di", width: 16 },
        ];
      if (change === "owner") {
        const load = f.code.instructions.find(
          (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "memory" && i.operands[1].displacement === 132,
        )!;
        if (load.operands[1]?.kind === "memory") load.operands[1].displacement = 134;
      }
      if (change === "stride") {
        const stride = f.code.instructions.find(
          (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 58,
        )!;
        if (stride.operands[1]?.kind === "immediate") stride.operands[1].value = 60;
      }
      if (change === "mask") {
        const guard = f.code.instructions.find((i) => i.mnemonic === "test")!;
        if (guard.operands[1]?.kind === "immediate") guard.operands[1].value = 16;
      }
      if (change === "edge")
        f.code.edges.push({ from: f.labels.get("body")!, to: f.labels.get("exit")!, kind: "jump" });
      if (change === "entry") f.code.edges.push({ from: f.code.address, to: selected.address, kind: "jump" });
      if (change === "return") selected.far = false;
      if (change === "record") f.program.records[0]!.bytes[34] = f.program.records[0]!.bytes[34]! ^ 1;
      expect(f.discover()).toEqual([]);
    },
  );
  it("retains evidence for a constant return with a private compiler frame", () => {
    const f = fixture();
    f.image.set([0x55, 0x8b, 0xec, 0xb8, 1, 0, 0x5d, 0xcb], 0x510);
    f.codes.set(0x510, readRoutineCode(f.image, { address: 0x510, segment: 0, offset: 0x510 }, 0));
    const target = f.discover()[0]!.selection.targets[1]!;
    expect(target.constantReturn).toBe(1);
    expect(target.returnEvidence?.map((e) => e.address)).toEqual([0x510, 0x511, 0x513, 0x516, 0x517]);
  });
  it("checks a compiler jump into its private frame cleanup", () => {
    const f = fixture();
    f.image.set([0x55, 0x8b, 0xec, 0xb8, 1, 0, 0xeb, 0, 0x5d, 0xcb], 0x510);
    f.codes.set(0x510, readRoutineCode(f.image, { address: 0x510, segment: 0, offset: 0x510 }, 0));
    expect(f.discover()[0]!.selection.targets[1]!.constantReturn).toBe(1);
    f.codes.get(0x510)!.edges.push({ from: 0x510, to: 0x516, kind: "jump" });
    expect(f.discover()[0]!.selection.targets[1]!.constantReturn).toBeUndefined();
  });
  it("does not infer a constant from a callback that also writes memory", () => {
    const f = fixture();
    f.image.set([0xc7, 6, 0, 9, 1, 0, 0xb8, 1, 0, 0xcb], 0x510);
    f.codes.set(0x510, readRoutineCode(f.image, { address: 0x510, segment: 0, offset: 0x510 }, 0));
    expect(f.discover()[0]!.selection.targets[1]!.constantReturn).toBeUndefined();
  });
  it("describes conditional partner selection and a checked zero return", () => {
    const f = fixture(),
      c = f.discover();
    const description = describeCollisionDispatch(c, { type: 0, routines: [{ slot: 0, address: 0x500 } as never] });
    expect(description?.description).toContain("records this part as its contact partner");
    expect(description?.description).toContain("returns zero");
    expect(description?.confidence).toBe("inferred");
    expect(description?.evidence.length).toBeGreaterThan(40);
    expect(describeCollisionDispatch(c, { type: 0, routines: [{ slot: 0, address: 0x510 } as never] })).toBeUndefined();
  });
});

describe("instruction region boundaries", () => {
  it("checks incoming and outgoing edges and the external exit", () => {
    const image = Uint8Array.from([0x90, 0x90, 0x90, 0xcb]);
    const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
    expect(matchInstructionRegion(code, code.instructions.slice(1, 3), 3, "nop\nnop", new Map())).toBeDefined();
    code.edges.push({ from: 0, to: 2, kind: "jump" });
    expect(matchInstructionRegion(code, code.instructions.slice(1, 3), 3, "nop\nnop", new Map())).toBeUndefined();
  });
});
