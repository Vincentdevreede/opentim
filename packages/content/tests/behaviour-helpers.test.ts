import { describe, expect, it } from "vitest";
import { discoverEngineSummaries } from "../src/read/behaviour-helpers.ts";
import { readRoutineCode, type RoutineCode } from "../src/read/behaviour-code.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const layout = (width = 0x44, height = 0x46): BehaviourLayout => ({
  callbacks: [],
  objectArgument: { offset: 6, confidence: "inferred", evidence: [], assumptions: [] },
  diagnostics: [],
  fields: [
    ["state", 0x0c],
    ["type", 4],
    ["frameWidth", width],
    ["frameHeight", height],
    ["drawX", 0x2a],
    ["drawY", 0x2c],
  ].map(([name, offset]) => ({
    name: name as string,
    offset: offset as number,
    confidence: "checked",
    evidence: [],
    assumptions: [],
  })),
});

function build(start: number) {
  const bytes: number[] = [];
  const labels = new Map<string, number>();
  const branches: { at: number; label: string; near: boolean }[] = [];
  return {
    emit(...values: number[]) {
      bytes.push(...values);
    },
    label(name: string) {
      labels.set(name, bytes.length);
    },
    branch(opcode: number, label: string) {
      bytes.push(opcode, 0);
      branches.push({ at: bytes.length - 1, label, near: false });
    },
    call(address: number) {
      const next = start + bytes.length + 3;
      const relative = (address - next) & 0xffff;
      bytes.push(0xe8, relative & 255, relative >> 8);
    },
    install(image: Uint8Array) {
      for (const branch of branches) {
        const target = labels.get(branch.label);
        if (target === undefined) throw new Error(`Missing fixture label ${branch.label}`);
        bytes[branch.at] = (target - branch.at - 1) & 255;
      }
      image.set(bytes, start);
    },
  };
}

function head(image: Uint8Array, start: number, globals = 0x200) {
  const b = build(start);
  b.emit(0x55, 0x8b, 0xec, 0x8b, 0x56, 6, 0xf7, 0xc2, 0, 0x10);
  b.branch(0x74, "second");
  b.emit(0xa1, globals & 255, globals >> 8);
  b.branch(0xeb, "end");
  b.label("second");
  b.emit(0xf7, 0xc2, 0, 0x20);
  b.branch(0x74, "empty");
  b.emit(0xa1, (globals + 2) & 255, (globals + 2) >> 8);
  b.branch(0xeb, "end");
  b.label("empty");
  b.emit(0x33, 0xc0);
  b.label("end");
  b.emit(0x5d, 0xcb);
  b.install(image);
}

function next(image: Uint8Array, start: number, first: number) {
  const b = build(start);
  b.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8, 0x83, 0x3c, 0);
  b.branch(0x74, "fallback");
  b.emit(0x8b, 4);
  b.branch(0xeb, "end");
  b.label("fallback");
  b.emit(0x57, 0x0e);
  b.call(first);
  b.emit(0x59);
  b.label("end");
  b.emit(0x5f, 0x5e, 0x5d, 0xcb);
  b.install(image);
}

function codes(image: Uint8Array, ...addresses: number[]): Map<number, RoutineCode> {
  return new Map(
    addresses.map((address) => [address, readRoutineCode(image, { address, segment: 0, offset: address }, 0x40)]),
  );
}

function guardedFactoryFixture(
  options: {
    strideBits?: number;
    cleanupSafe?: boolean;
    guardSafe?: boolean;
    extraStore?: boolean;
    earlyRestore?: boolean;
    /** Gives the new part's list flags at 0x06 from the type-indexed table, as the games' factory does. */
    startingFlags?: boolean;
  } = {},
) {
  const image = new Uint8Array(0xc00);
  const heap = 0x100,
    fill = 0x180,
    clear = 0x200,
    forward = 0x280,
    factory = 0x380,
    cleanup = 0x500,
    dimensions = 0x550,
    guard = 0x5a0;
  const strideBits = options.strideBits ?? 4;
  image.set(
    [0x56, 0x8b, 0x1e, 0x20, 6, 0x25, 0xfe, 0xff, 0x8b, 0x5f, 6, 0xff, 7, 0x8b, 0xc3, 0x05, 4, 0, 0x5e, 0xcb],
    heap,
  );
  image.set(
    [
      0x55, 0x8b, 0xec, 0x57, 0x1e, 7, 0x8b, 0x7e, 6, 0x8b, 0x4e, 8, 0x8a, 0x46, 0x0a, 0xaa, 0xf3, 0xab, 0x5f, 0x5d,
      0xcb,
    ],
    fill,
  );
  const c = build(clear);
  c.emit(0x55, 0x8b, 0xec, 0x56, 0x0e);
  c.call(heap);
  c.emit(0x8b, 0xf0, 0x0b, 0xf6);
  c.branch(0x74, "end");
  c.emit(0xb0, 0, 0x50, 0xff, 0x76, 8, 0x56, 0x0e);
  c.call(fill);
  c.emit(0x83, 0xc4, 6);
  c.label("end");
  c.emit(0x8b, 0xc6, 0x5e, 0x5d, 0xcb);
  c.install(image);
  const f = build(forward);
  f.emit(0x55, 0x8b, 0xec, 0xff, 0x76, 8, 0xff, 0x76, 6, 0x0e);
  f.call(clear);
  f.emit(0x83, 0xc4, 4, 0x5d, 0xcb);
  f.install(image);
  image.set(
    [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 0x44, 8, 0, 0xc7, 0x44, 0x46, 8, 0, 0x5e, 0x5d, 0xcb],
    dimensions,
  );
  image.set(options.guardSafe === false ? [0xc7, 6, 0x50, 2, 1, 0, 0xcb] : [0x55, 0x8b, 0xec, 0x5d, 0xcb], guard);
  const d = build(cleanup);
  d.emit(0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x0b, 0xf6);
  d.branch(0x74, "end");
  d.emit(0x0e);
  d.call(0xa00);
  d.label("end");
  d.emit(0x5e, 0x5d, 0xcb);
  d.install(image);
  if (options.cleanupSafe === false) image.fill(0x90, cleanup + 9, cleanup + 11);
  const p = build(factory);
  p.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x57, 0x8b, 0x7e, 6, 0xc7, 0x46, 0xfe, 0, 0, 0x0e);
  p.call(guard);
  p.emit(0xb8, 0xa2, 0, 0x50, 0xb8, 1, 0, 0x50, 0x0e);
  p.call(forward);
  p.emit(0x59, 0x59, 0x8b, 0xf0, 0x0b, 0xc0);
  p.branch(0x75, "allocated");
  p.emit(0xc7, 0x46, 0xfe, 1, 0);
  p.branch(0xeb, "check");
  p.label("allocated");
  if (options.earlyRestore) p.emit(0x5e);
  p.emit(0x89, 0x7c, 4);
  if (options.extraStore) p.emit(0xc7, 0x45, 0x0c, 1, 0);
  p.emit(0xb1, strideBits);
  if (options.startingFlags) p.emit(0x8b, 0xdf, 0xd3, 0xe3, 0x8b, 0x87, 0x24, 6, 0x89, 0x44, 6);
  p.emit(0x8b, 0xdf, 0xd3, 0xe3, 0x8b, 0x87, 0x20, 6, 0x0b, 0x87, 0x22, 6);
  p.branch(0x74, "after");
  p.emit(0x56, 0x8b, 0xdf, 0xd3, 0xe3, 0xff, 0x9f, 0x20, 6, 0x59, 0x3d, 1, 0);
  p.branch(0x75, "after");
  p.emit(0xc7, 0x46, 0xfe, 1, 0);
  p.branch(0xeb, "check");
  p.label("after");
  p.emit(0x56, 0x0e);
  p.call(dimensions);
  p.emit(0x59);
  p.label("check");
  p.emit(0x0e);
  p.call(guard);
  p.emit(0x83, 0x7e, 0xfe, 0);
  p.branch(0x74, "object");
  p.emit(0x56, 0x90, 0x0e);
  p.call(cleanup);
  p.emit(0x59, 0x33, 0xc0);
  p.branch(0xeb, "end");
  p.label("object");
  p.emit(0x8b, 0xc6);
  p.label("end");
  p.emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  p.install(image);
  image.set([0x50, 8, 0, 0], 0x620 + 2 ** strideBits);
  return { image, code: codes(image, heap, fill, clear, forward, factory, cleanup, dimensions, guard), factory };
}

describe("structural engine summaries", () => {
  it("recognizes rebased global list getters and retains their conditional pointer alternatives", () => {
    for (const [start, globals] of [
      [0x100, 0x200],
      [0x180, 0x300],
    ] as const) {
      const image = new Uint8Array(0x800);
      head(image, start, globals);
      const summary = discoverEngineSummaries(image, codes(image, start), layout(), undefined, 0x40)[0]!;
      expect(summary.kind).toBe("list-head");
      expect(summary.footprint).toMatchObject({ complete: true, preservesPartState: true });
      expect(summary.returns.map((r) => r.pointer)).toContainEqual({
        kind: "global",
        segment: 0x40,
        offset: globals,
        path: [],
      });
      expect(summary.returns.some((r) => r.condition.kind === "and")).toBe(true);
      expect(summary.evidence[0]!.address).toBe(start);
    }
  });

  it("returns the linked object pointer without executing a next-list helper", () => {
    const image = new Uint8Array(0x800);
    head(image, 0x100);
    next(image, 0x180, 0x100);
    const summaries = discoverEngineSummaries(image, codes(image, 0x100, 0x180), layout(), undefined, 0x40);
    const summary = summaries.find((s) => s.address === 0x180)!;
    expect(summary.kind).toBe("list-next");
    expect(summary.returns.map((r) => r.pointer)).toContainEqual({
      kind: "argument",
      argument: 6,
      path: [0],
      displacement: 0,
    });
    expect(summary.footprint.complete).toBe(true);
  });

  it("resolves a read-only wrapper through its actual call target", () => {
    const image = new Uint8Array(0x800);
    image.set([0x55, 0x8b, 0xec, 0xb8, 3, 0, 0x5d, 0xcb], 0x100);
    const b = build(0x180);
    b.emit(0x55, 0x8b, 0xec, 0x0e);
    b.call(0x100);
    b.emit(0x5d, 0xcb);
    b.install(image);
    const summary = discoverEngineSummaries(image, codes(image, 0x100, 0x180), layout()).find(
      (s) => s.address === 0x180,
    )!;
    expect(summary.footprint).toMatchObject({ complete: true, preservesPartState: true, unknownEffects: [] });
  });

  it("retains a displaced overlap-list footprint and rejects a state-writing variation", () => {
    for (const changesState of [false, true]) {
      const image = new Uint8Array(0x800);
      head(image, 0x100);
      next(image, 0x180, 0x100);
      const b = build(0x300);
      b.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0xc7, 0x45, 0x58, 0, 0, 0x0e);
      b.call(0x100);
      b.emit(0x8b, 0xf0, 0x3b, 0xfe);
      b.branch(0x74, "end");
      b.emit(0x03, 0x44, 0x24, 0x03, 0x44, 0x26);
      for (const arg of [0x0a, 0x0c, 0x0e, 0x10]) {
        b.emit(0x3b, 0x46, arg);
        b.branch(0x7c, "end");
      }
      b.emit(0x8b, 0x45, 0x58, 0x89, 0x44, 0x58, 0x89, 0x75, 0x58);
      if (changesState) b.emit(0xc7, 0x45, 0x0c, 1, 0);
      b.emit(0x0e);
      b.call(0x180);
      b.label("end");
      b.emit(0x5f, 0x5e, 0x5d, 0xcb);
      b.install(image);
      const summary = discoverEngineSummaries(
        image,
        codes(image, 0x100, 0x180, 0x300),
        layout(0x24, 0x26),
        undefined,
        0x40,
      ).find((s) => s.address === 0x300)!;
      expect(summary.kind).toBe("overlap-list");
      expect(summary.writes.some((w) => w.offset === 0x58)).toBe(true);
      expect(
        summary.writes.some((w) => w.root === "unknown" && w.selection === "overlap-candidate" && !w.path.length),
      ).toBe(true);
      expect(summary.writes.some((w) => w.path.length)).toBe(false);
      expect(summary.footprint.preservesPartState).toBe(!changesState);
      expect(summary.footprint.complete).toBe(!changesState);
      expect(summary.list).toMatchObject({
        headField: 0x58,
        nextField: 0x58,
        excludesArgument: true,
        confidence: "checked",
      });
      const guarded = codes(image, 0x300)
        .get(0x300)!
        .instructions.find(
          (i) => i.mnemonic === "cmp" && i.operands[0]?.kind === "register" && i.operands[1]?.kind === "register",
        )!;
      image.fill(0x90, guarded.address, guarded.address + guarded.size + 2);
      const unguarded = discoverEngineSummaries(
        image,
        codes(image, 0x100, 0x180, 0x300),
        layout(0x24, 0x26),
        undefined,
        0x40,
      ).find((s) => s.address === 0x300)!;
      expect(unguarded.list!.excludesArgument).toBe(false);
      expect(unguarded.list!.confidence).toBe("unresolved");
    }
  });

  it("reads the flag tests an overlap query keeps a part by, like the candle's search", () => {
    const query = (typeTest: boolean) => {
      const image = new Uint8Array(0x800);
      head(image, 0x100);
      next(image, 0x180, 0x100);
      const b = build(0x300);
      b.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0xc7, 0x45, 0x58, 0, 0, 0x0e);
      b.call(0x100);
      b.emit(0x8b, 0xf0, 0x3b, 0xfe);
      b.branch(0x74, "skip");
      // Only parts with 0x0004 in field 0x0a, and none with 0x2000 in field 0x08.
      b.emit(0xf7, 0x44, 0x0a, 0x04, 0x00);
      b.branch(0x74, "skip");
      b.emit(0xf7, 0x44, 0x08, 0x00, 0x20);
      b.branch(0x75, "skip");
      // A type test that leaves a part out is a filter the reader can't place.
      if (typeTest) {
        b.emit(0x83, 0x7c, 0x04, 0x05);
        b.branch(0x75, "skip");
      }
      b.emit(0x03, 0x44, 0x24, 0x03, 0x44, 0x26);
      for (const arg of [0x0a, 0x0c, 0x0e, 0x10]) {
        b.emit(0x3b, 0x46, arg);
        b.branch(0x7c, "skip");
      }
      b.emit(0x8b, 0x45, 0x58, 0x89, 0x44, 0x58, 0x89, 0x75, 0x58);
      b.label("skip");
      b.emit(0x0e);
      b.call(0x180);
      b.emit(0x5f, 0x5e, 0x5d, 0xcb);
      b.install(image);
      return discoverEngineSummaries(
        image,
        codes(image, 0x100, 0x180, 0x300),
        layout(0x24, 0x26),
        undefined,
        0x40,
      ).find((s) => s.address === 0x300)!;
    };
    const summary = query(false);
    expect(summary.kind).toBe("overlap-list");
    expect(summary.list!.memberTests!.map(({ offset, mask, set }) => ({ offset, mask, set }))).toEqual([
      { offset: 0x0a, mask: 4, set: true },
      { offset: 8, mask: 0x2000, set: false },
    ]);
    expect(query(true).list!.memberTests).toBeUndefined();
  });

  it("bounds ordered insertion to its displaced forward and backward links", () => {
    for (const extraStateWrite of [false, true]) {
      const image = new Uint8Array(0x800);
      const b = build(0x300);
      b.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8, 0xba, 58, 0, 0xf7, 0xea);
      b.label("search");
      for (const value of [0, 1, 2, 3]) b.emit(0x3d, value, 0);
      b.branch(0x74, "insert");
      b.emit(0x8b, 0x7d, 0x20);
      b.branch(0xeb, "search");
      b.label("insert");
      b.emit(
        0x8b,
        0x45,
        0x20,
        0x89,
        0x44,
        0x20,
        0x89,
        0x7c,
        0x22,
        0x89,
        0x75,
        0x20,
        0x8b,
        0x5c,
        0x20,
        0x89,
        0x77,
        0x22,
      );
      if (extraStateWrite) b.emit(0xc7, 0x44, 0x0c, 1, 0);
      b.emit(0x5f, 0x5e, 0x5d, 0xcb);
      b.install(image);
      const summary = discoverEngineSummaries(image, codes(image, 0x300), layout()).find((s) => s.address === 0x300);
      if (extraStateWrite) expect(summary).toBeUndefined();
      else {
        expect(summary!.kind).toBe("ordered-part-insertion");
        expect(summary!.writes.map((w) => w.offset)).toEqual([0x20, 0x22, 0x20, 0x22]);
        expect(summary!.footprint.preservesPartState).toBe(true);
        expect(summary!.footprint.unknownGlobalEffects!.length).toBeGreaterThan(0);
      }
    }
  });

  it("does not call a redirected stack segment or an invented BP frame private storage", () => {
    for (const body of [
      [0x55, 0x8b, 0xec, 0x8e, 0xd0, 0x89, 0x46, 0xfe, 0x5d, 0xcb],
      [0x8b, 0xe8, 0x89, 0x46, 0xfe, 0xcb],
    ]) {
      const image = new Uint8Array(0x800);
      image.set(body, 0x100);
      expect(discoverEngineSummaries(image, codes(image, 0x100), layout())).toEqual([]);
    }
  });

  it("derives consistent return cleanup from the routine's own returns", () => {
    const image = new Uint8Array(0x800);
    image.set([0xca, 8, 0], 0x100);
    const wrapper = build(0x180);
    wrapper.emit(0x55, 0x8b, 0xec, 0x0e);
    wrapper.call(0x100);
    wrapper.emit(0x5d, 0xcb);
    wrapper.install(image);
    image.set([0x0b, 0xc0, 0x74, 3, 0xca, 4, 0, 0xcb], 0x200);
    const summaries = discoverEngineSummaries(image, codes(image, 0x100, 0x180, 0x200), layout());
    expect(summaries.find((s) => s.address === 0x100)!.returnConvention).toEqual({ kind: "far", stackBytes: 8 });
    expect(summaries.find((s) => s.address === 0x180)!.returnConvention).toEqual({ kind: "far", stackBytes: 0 });
    expect(summaries.find((s) => s.address === 0x200)!.returnConvention).toBeUndefined();
  });

  it("does not clear unknown call effects", () => {
    const image = new Uint8Array(0x800);
    const b = build(0x180);
    b.emit(0x55, 0x8b, 0xec, 0x0e);
    b.call(0x300);
    b.emit(0x5d, 0xcb);
    b.install(image);
    const summary = discoverEngineSummaries(image, codes(image, 0x180), layout())[0]!;
    expect(summary.footprint.complete).toBe(false);
    expect(summary.footprint.preservesPartState).toBe(false);
    expect(summary.footprint.unknownEffects.length).toBeGreaterThan(0);
  });

  it("uses discovered dimension fields instead of assuming their offsets", () => {
    const image = new Uint8Array(0x800);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x89, 0x44, 0x24, 0x89, 0x44, 0x26, 0x5e, 0x5d, 0xcb], 0x100);
    const summary = discoverEngineSummaries(image, codes(image, 0x100), layout(0x24, 0x26))[0]!;
    expect(summary.kind).toBe("frame-dimensions");
    expect(summary.writes.map((w) => w.offset)).toEqual([0x24, 0x26]);
    expect(summary.footprint.preservesPartState).toBe(true);
  });

  it("retains mapped callee fields in a complete owner footprint", () => {
    const image = new Uint8Array(0x800);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 0x22, 1, 0, 0x5e, 0x5d, 0xcb], 0x100);
    const b = build(0x180);
    b.emit(0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 0x24, 2, 0, 0x56, 0x0e);
    b.call(0x100);
    b.emit(0x59, 0x5e, 0x5d, 0xcb);
    b.install(image);
    const summary = discoverEngineSummaries(image, codes(image, 0x100, 0x180), layout()).find(
      (s) => s.address === 0x180,
    )!;
    expect(summary.kind).toBe("owner-field-update");
    expect(summary.writes.map((w) => w.offset).sort()).toEqual([0x22, 0x24]);
    expect(summary.footprint).toMatchObject({ complete: true, partMemoryComplete: true, preservesPartState: true });
  });

  it("gives a helper's stores the tests of the part's fields on every path to them, like the mouse motor's start", () => {
    const image = new Uint8Array(0x800);
    image.set(
      [
        ...[0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6],
        // test word [si+0x08], 0x0010; je +7
        ...[0xf7, 0x44, 0x08, 0x10, 0x00, 0x74, 0x07],
        // mov word [si+0x12], 0xffff; jmp +5; mov word [si+0x12], 1
        ...[0xc7, 0x44, 0x12, 0xff, 0xff, 0xeb, 0x05, 0xc7, 0x44, 0x12, 0x01, 0x00],
        // mov word [si+0x96], 100; mov word [si+0x22], 1; or word [si+0x22], 2
        ...[0xc7, 0x84, 0x96, 0x00, 0x64, 0x00, 0xc7, 0x44, 0x22, 1, 0, 0x83, 0x4c, 0x22, 2],
        ...[0x5e, 0x5d, 0xcb],
      ],
      0x100,
    );
    const summary = discoverEngineSummaries(image, codes(image, 0x100), layout())[0]!;
    expect(summary.kind).toBe("owner-field-update");
    const flag = (operator: string) => ({
      kind: "compare",
      operator,
      left: {
        kind: "binary",
        operator: "&",
        left: { kind: "field", object: "part", offset: 8, width: 16 },
        right: { kind: "constant", value: 0x10, width: 16 },
        width: 16,
      },
      right: { kind: "constant", value: 0, width: 16 },
      signed: false,
    });
    expect(summary.writes.map((w) => [w.offset, w.value, w.condition])).toEqual([
      [0x12, { kind: "constant", value: 0xffff, width: 16 }, flag("!=")],
      [0x12, { kind: "constant", value: 1, width: 16 }, flag("==")],
      [0x96, { kind: "constant", value: 100, width: 16 }, { kind: "true" }],
      // A store an `or` changes afterwards is not the last, and the `or` itself sets no value.
      [0x22, { kind: "constant", value: 1, width: 16 }, expect.objectContaining({ kind: "unknown" })],
      [0x22, expect.anything(), expect.objectContaining({ kind: "unknown" })],
    ]);
  });

  it("uses checked layout names in helper prose and keeps offsets in structured writes", () => {
    const image = new Uint8Array(0x800);
    image.set(
      [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 0x22, 1, 0, 0xc7, 0x44, 0x24, 2, 0, 0x5e, 0x5d, 0xcb],
      0x100,
    );
    const known = layout();
    known.fields.push(
      { name: "velocityX", offset: 0x22, confidence: "checked", evidence: [], assumptions: [] },
      { name: "velocityY", offset: 0x24, confidence: "checked", evidence: [], assumptions: [] },
    );
    const named = discoverEngineSummaries(image, codes(image, 0x100), known)[0]!;
    expect(named.purpose).toBe("Updates horizontal and vertical velocity while preserving the state.");
    const unnamed = discoverEngineSummaries(image, codes(image, 0x100), layout())[0]!;
    expect(unnamed.purpose).toBe("Updates object fields whose meaning is not established.");
    expect(named.writes.map((w) => w.offset)).toEqual([0x22, 0x24]);
  });

  it("rejects owner arithmetic, indexed stores and a changed data segment", () => {
    for (const bytes of [
      [0x83, 0xc6, 2, 0xc7, 0x44, 0x22, 1, 0],
      [0xc7, 0x40, 0x22, 1, 0],
      [0x8e, 0xd8, 0xc7, 0x44, 0x22, 1, 0],
    ]) {
      const image = new Uint8Array(0x800);
      image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...bytes, 0x5e, 0x5d, 0xcb], 0x100);
      expect(discoverEngineSummaries(image, codes(image, 0x100), layout())).toEqual([]);
    }
  });

  it("rejects an additional state write in a dimension helper", () => {
    const image = new Uint8Array(0x800);
    image.set(
      [
        0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x89, 0x44, 0x24, 0x89, 0x44, 0x26, 0xc7, 0x44, 0x0c, 1, 0, 0x5e, 0x5d,
        0xcb,
      ],
      0x100,
    );
    const summary = discoverEngineSummaries(image, codes(image, 0x100), layout(0x24, 0x26))[0]!;
    expect(summary.kind).toBe("owner-field-update");
    expect(summary.footprint.preservesPartState).toBe(false);
    expect(summary.footprint.partMemoryComplete).toBe(true);
    expect(summary.writes.some((w) => w.offset === 0x0c)).toBe(true);
  });

  it("keeps a rebased nullable factory pointer fact while constructor effects remain unresolved", () => {
    for (const shift of [0, 0x80]) {
      const image = new Uint8Array(0x900);
      const heap = 0x100 + shift,
        fill = 0x180 + shift,
        clear = 0x200 + shift,
        forward = 0x280 + shift,
        factory = 0x380 + shift;
      image.set(
        [0x56, 0x8b, 0x1e, 0x20, 6, 0x25, 0xfe, 0xff, 0x8b, 0x5f, 6, 0xff, 7, 0x8b, 0xc3, 0x05, 4, 0, 0x5e, 0xcb],
        heap,
      );
      image.set(
        [
          0x55, 0x8b, 0xec, 0x57, 0x1e, 7, 0x8b, 0x7e, 6, 0x8b, 0x4e, 8, 0x8a, 0x46, 0x0a, 0xaa, 0xf3, 0xab, 0x5f, 0x5d,
          0xcb,
        ],
        fill,
      );
      const c = build(clear);
      c.emit(0x55, 0x8b, 0xec, 0x56, 0x0e);
      c.call(heap);
      c.emit(0x8b, 0xf0, 0x0b, 0xf6);
      c.branch(0x74, "end");
      c.emit(0xb0, 0, 0x50, 0xff, 0x76, 8, 0x56, 0x0e);
      c.call(fill);
      c.emit(0x83, 0xc4, 6);
      c.label("end");
      c.emit(0x8b, 0xc6, 0x5e, 0x5d, 0xcb);
      c.install(image);
      const f = build(forward);
      f.emit(0x55, 0x8b, 0xec, 0xff, 0x76, 8, 0xff, 0x76, 6, 0x0e);
      f.call(clear);
      f.emit(0x83, 0xc4, 4, 0x5d, 0xcb);
      f.install(image);
      const p = build(factory);
      p.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0xb8, 0xa2, 0, 0x50, 0xb8, 1, 0, 0x50, 0x0e);
      p.call(forward);
      p.emit(0x59, 0x59, 0x8b, 0xf0, 0x0b, 0xc0);
      p.branch(0x74, "failed");
      p.emit(0x89, 0x7c, 4, 0x56, 0xff, 0x9f, 0x20, 6, 0x59, 0x8b, 0xc6);
      p.branch(0xeb, "end");
      p.label("failed");
      p.emit(0x33, 0xc0);
      p.label("end");
      p.emit(0x5f, 0x5e, 0x5d, 0xcb);
      p.install(image);
      const summaries = discoverEngineSummaries(image, codes(image, heap, fill, clear, forward, factory), layout());
      const summary = summaries.find((s) => s.address === factory)!;
      expect(summary.kind).toBe("part-factory");
      expect(summary.returnPointerClass).toBe("nullable-fresh");
      expect(summary.allocationSize).toBe(0xa2);
      expect(summary.returns.map((r) => r.pointer?.kind)).toEqual(["fresh", "constant"]);
      expect(summary.footprint).toMatchObject({ complete: false, preservesPartState: false });
      expect(summary.footprint.unknownPartEffects!.length).toBeGreaterThan(0);
      const misleading = discoverEngineSummaries(image, codes(image, fill, clear, forward, factory), layout());
      expect(misleading.some((s) => s.kind === "part-factory")).toBe(false);
    }
  });

  it("specializes only bounded type entries whose checked constructor pointer is empty", () => {
    for (const strideBits of [3, 4]) {
      const f = guardedFactoryFixture({ strideBits });
      const summary = discoverEngineSummaries(f.image, f.code, layout(), 0x880, 0, 3).find(
        (s) => s.address === f.factory,
      )!;
      expect(summary.factory).toMatchObject({
        typeArgument: 6,
        constructorTable: { segment: 0, offset: 0x620, stride: 2 ** strideBits, typeCount: 3 },
        noConstructorTypes: [0, 2],
      });
      expect(summary.factory!.noConstructor.footprint).toMatchObject({
        preservesPartState: true,
        partMemoryComplete: true,
      });
      expect(summary.factory!.noConstructor.initialState).toEqual({ offset: 0x0c, value: 0 });
      // Every other word the zero fill covers and no success path writes is known zero too.
      const zero = summary.factory!.noConstructor.zeroWords!;
      expect(zero).toContain(0x0c);
      expect(zero.every((offset) => offset % 2 === 0 && offset + 2 <= summary.allocationSize!)).toBe(true);
      for (const w of summary.factory!.noConstructor.writes)
        expect(zero.some((offset) => offset < w.offset + w.width / 8 && w.offset < offset + 2)).toBe(false);
      expect(summary.footprint.preservesPartState).toBe(false);
      expect(
        summary.factory!.noConstructor.evidence.some((e) => e.bytes.length === 4 && e.text.includes("type 2")),
      ).toBe(true);
      expect(
        discoverEngineSummaries(f.image, f.code, layout(), 0x880, 0).find((s) => s.address === f.factory)!.factory,
      ).toBeUndefined();
    }
  });

  it("reads the words a new part starts with from the factory's type-indexed table", () => {
    for (const strideBits of [3, 4]) {
      const f = guardedFactoryFixture({ strideBits, startingFlags: true });
      for (let type = 0; type < 3; type++)
        f.image.set([0x00, type === 1 ? 0x48 : 0x08], 0x624 + type * 2 ** strideBits);
      const summary = discoverEngineSummaries(f.image, f.code, layout(), 0x880, 0, 3).find(
        (s) => s.address === f.factory,
      )!;
      expect(summary.factory?.startingWords).toMatchObject([
        { field: 6, table: { segment: 0, offset: 0x624, stride: 2 ** strideBits }, values: [0x800, 0x4800, 0x800] },
      ]);
      const plain = guardedFactoryFixture({ strideBits });
      expect(
        discoverEngineSummaries(plain.image, plain.code, layout(), 0x880, 0, 3).find((s) => s.address === plain.factory)
          ?.factory?.startingWords,
      ).toBeUndefined();
    }
  });

  it("refuses factory specialization when cleanup, auxiliary calls or fresh-only stores are unproved", () => {
    for (const options of [
      { cleanupSafe: false },
      { guardSafe: false },
      { extraStore: true },
      { earlyRestore: true },
    ]) {
      const f = guardedFactoryFixture(options);
      const summary = discoverEngineSummaries(f.image, f.code, layout(), 0x880, 0, 3).find(
        (s) => s.address === f.factory,
      )!;
      expect(summary.returnPointerClass).toBe("nullable-fresh");
      expect(summary.factory).toBeUndefined();
    }
  });

  it("proves the register ABI of rebased 32-bit shifts from both guarded instruction paths", () => {
    for (const left of [true, false]) {
      const image = new Uint8Array(0x800);
      const b = build(left ? 0x100 : 0x180);
      b.emit(0x80, 0xf9, 16);
      b.branch(0x73, "wide");
      b.emit(
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
      b.label("wide");
      b.emit(0x80, 0xe9, 16, 0x92);
      if (left) b.emit(0x33, 0xc0);
      else b.emit(0x99);
      b.emit(0xd3, left ? 0xe2 : 0xf8, 0xcb);
      b.install(image);
      const summary = discoverEngineSummaries(image, codes(image, left ? 0x100 : 0x180), layout())[0]!;
      expect(summary.kind).toBe("wide-integer-shift");
      expect(summary.numeric).toMatchObject({
        operation: left ? "leftShift32" : "arithmeticRightShift32",
        width: 32,
        low: "ax",
        high: "dx",
        count: "cl",
        minimumCount: 0,
        maximumCount: 31,
      });
      expect(summary.footprint.preservesPartState).toBe(true);
    }
  });

  it("keeps resource backend effects and storage assumptions explicit", () => {
    const image = new Uint8Array(0x800);
    image.set(
      [
        0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x81, 0xfe, 0xe9, 3, 0x81, 0xfe, 0xe9, 3, 0x8b, 0xde, 0xd1, 0xe3, 0x8b,
        0x87, 0, 2, 0xff, 0xb7, 0x20, 2, 0x9a, 0, 3, 0, 0, 0x59, 0x5e, 0x5d, 0xcb,
      ],
      0x100,
    );
    image.set(
      [
        0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xa1, 0x40, 2, 0x8b, 0x16, 0x42, 2, 0xc4, 0x1e, 0x40, 2, 0x26, 0x39,
        0x77, 0x0a, 0xcd, 0x21, 0x5e, 0x5d, 0xcb,
      ],
      0x300,
    );
    const summary = discoverEngineSummaries(image, codes(image, 0x100, 0x300), layout(), undefined, 0x40).find(
      (s) => s.address === 0x100,
    )!;
    expect(summary.kind).toBe("scalar-resource-service");
    expect(summary.argumentKind).toBe("scalar");
    expect(summary.confidence).toBe("inferred");
    expect(summary.footprint).toMatchObject({ complete: false, preservesPartState: true });
    expect(summary.footprint.unknownGlobalEffects!.length).toBeGreaterThan(0);
    expect(summary.assumptions.some((s) => s.includes("no hidden access"))).toBe(true);
  });
});
