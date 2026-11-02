import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { proveOverlapProducer } from "../src/read/behaviour-overlap-producer.ts";

function assembly(origin: number) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; name: string; width: number }[] = [];
  return {
    bytes,
    labels,
    emit: (...values: number[]) => bytes.push(...values),
    label: (name: string) => labels.set(name, origin + bytes.length),
    jump(name: string, opcode = 0xe9) {
      bytes.push(opcode);
      const width = opcode === 0xe9 || opcode === 0xe8 ? 2 : 1;
      patches.push({ at: bytes.length, name, width });
      bytes.push(...Array<number>(width).fill(0));
    },
    finish() {
      for (const p of patches) {
        const delta = labels.get(p.name)! - (origin + p.at + p.width);
        if (p.width === 1 && (delta < -128 || delta > 127)) throw new Error("Synthetic branch is out of range");
        bytes[p.at] = delta & 255;
        if (p.width === 2) bytes[p.at + 1] = (delta >> 8) & 255;
      }
      return bytes;
    },
  };
}

function fixture(
  options: {
    shared?: boolean;
    store?: number;
    bypassExclusion?: boolean;
    unbalanced?: boolean;
    constantMasks?: boolean;
    constantHead?: boolean;
    coordinateRewrite?: boolean;
    bypassMask?: boolean;
    bodyCoordinateRewrite?: boolean;
  } = {},
) {
  const head = assembly(0x200),
    next = assembly(0x280),
    query = assembly(0);
  head.emit(0x55, 0x8b, 0xec, 0x8b, 0x56, 6);
  for (const [n, mask] of [
    [0, 0x2000],
    [1, 0x1000],
    [2, 0x800],
  ]) {
    head.label(`head${n}`);
    head.emit(0x83, 0x3e, n! * 2, 5, 0);
    head.jump(n === 2 ? "zero" : `head${n! + 1}`, 0x74);
    head.emit(0xf7, 0xc2, mask! & 255, mask! >> 8);
    head.jump(n === 2 ? "zero" : `head${n! + 1}`, 0x74);
    head.emit(0xa1, n! * 2, 5);
    if (n === 0) head.label("bridge");
    head.jump(options.shared && n !== 0 ? "bridge" : "done");
  }
  head.label("zero");
  head.emit(0x33, 0xc0);
  if (options.shared) head.jump("bridge");
  head.label("done");
  head.emit(0x5d, 0xcb);

  next.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8, 0x83, 0x3c, 0);
  next.jump("tail", 0x74);
  next.emit(0x8b, 4);
  next.label("bridge");
  next.jump("done");
  next.label("tail");
  next.emit(0xf7, 0x44, 6, 0, 0x20);
  next.jump("second", 0x74);
  next.emit(0x57, 0x0e, 0xe8);
  const relative = 0x200 - (0x280 + next.bytes.length + 2);
  next.emit(relative & 255, (relative >> 8) & 255, 0x59);
  next.jump(options.shared ? "bridge" : "done");
  next.label("second");
  next.emit(0xf7, 0x44, 6, 0, 0x10);
  next.jump("zero", 0x74);
  next.emit(0xf7, 0xc7, 0, 8);
  next.jump("zero", 0x74);
  next.emit(0xa1, 4, 5);
  next.jump(options.shared ? "bridge" : "done");
  next.label("zero");
  next.emit(0x33, 0xc0);
  if (options.shared) next.jump("bridge");
  next.label("done");
  next.emit(0x5f, 0x5e, 0x5d, 0xcb);

  query.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x57, 0x8b, 0x7e, 6);
  query.label("clear");
  query.emit(0xc7, 0x45, 0x60, 0, 0);
  if (options.coordinateRewrite) query.emit(0x8b, 0x45, 0x1e, 0x01, 0x46, 8);
  query.label("headMask");
  if (options.constantMasks || options.constantHead) query.emit(0xb8, 0, 0x30, 0x50);
  else query.emit(0xff, 0x76, 8);
  query.emit(0x90, 0x0e, 0xe8);
  let displacement = 0x200 - (query.bytes.length + 2);
  query.emit(displacement & 255, (displacement >> 8) & 255, 0x59);
  query.jump("gateway");
  query.label("body");
  if (options.bypassExclusion) {
    query.emit(0x83, 0xf8, 0);
    query.jump("insert", 0x74);
  }
  if (options.bypassMask) {
    query.emit(0x83, 0xf8, 0);
    query.jump("maskPush", 0x74);
  }
  query.emit(0x3b, 0xfe);
  query.label("exclude");
  query.jump("advance", 0x74);
  query.label("insert");
  query.emit(0x8b, 0x45, 0x60, 0x89, 0x44, 0x60, 0x89, 0x75, 0x60);
  if (options.store !== undefined) query.emit(0x89, 0x44, options.store);
  if (options.unbalanced) query.emit(0x50);
  if (options.bodyCoordinateRewrite) query.emit(0x01, 0x46, 8);
  query.label("advance");
  if (options.constantMasks) query.emit(0xb8, 0, 0x10);
  else query.emit(0x8b, 0x46, 8, 0x25, 0, 0x10);
  query.label("maskPush");
  query.emit(0x50, 0x56, 0x90, 0x0e, 0xe8);
  displacement = 0x280 - (query.bytes.length + 2);
  query.emit(displacement & 255, (displacement >> 8) & 255, 0x59, 0x59);
  query.label("gateway");
  query.emit(0x8b, 0xf0, 0x0b, 0xf6);
  query.jump("body", 0x75);
  query.emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  const image = new Uint8Array(0x600).fill(0x66);
  image.set(query.finish());
  image.set(head.finish(), 0x200);
  image.set(next.finish(), 0x280);
  const codes = new Map(
    [0, 0x200, 0x280].map((address) => [address, readRoutineCode(image, { address, segment: 0, offset: address }, 0)]),
  );
  const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
  const summary: EngineSummary = {
    ...fact,
    address: 0,
    kind: "overlap-list",
    purpose: "Builds a selected list.",
    argumentOffset: 6,
    argumentKind: "object",
    writes: [],
    returns: [],
    calls: [0x200, 0x280],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
    },
    list: { ...fact, headField: 0x60, nextField: 0x60, excludesArgument: false },
  };
  for (const code of codes.values()) expect(code.status).toBe("complete");
  return { code: codes.get(0)!, codes, summary, labels: query.labels };
}

describe("normal-return overlap producer certificates", () => {
  it.each([false, true])("proves prepend shape with shared enumerator returns %s", (shared) => {
    const { code, codes, summary } = fixture({ shared, store: 0x62 });
    expect(proveOverlapProducer(code, codes, summary)).toMatchObject({
      ownerArgument: 6,
      headField: 0x60,
      nextField: 0x60,
      sourceNextField: 0,
      classFlagsField: 6,
      globalHeads: [0x500, 0x502, 0x504],
      conditionalOnNormalReturn: true,
      finite: true,
      acyclic: true,
      excludesOwner: true,
    });
    const result = proveOverlapProducer(code, codes, summary)!;
    expect(result.assumptions.some((s) => s.includes("Distinct parts occupy disjoint storage"))).toBe(true);
    expect(result.assumptions.some((s) => s.includes("not a termination claim"))).toBe(true);
    expect(result.evidence.length).toBe(
      code.instructions.length + codes.get(0x200)!.instructions.length + codes.get(0x280)!.instructions.length,
    );
  });

  it.each([0, 6, 0x60])("rejects an extra candidate store into source or result field %i", (store) => {
    const { code, codes, summary } = fixture({ store });
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("requires exclusion to dominate insertion rather than trusting list metadata", () => {
    const { code, codes, summary } = fixture({ bypassExclusion: true });
    summary.list!.excludesArgument = true;
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("rejects an initial head which is not cleared", () => {
    const { code, codes, summary, labels } = fixture();
    const clear = code.instructions.find((i) => i.address === labels.get("clear"))!;
    if (clear.operands[1]?.kind === "immediate") clear.operands[1].value = 1;
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("rejects changed equality exclusion", () => {
    const { code, codes, summary, labels } = fixture();
    const branch = code.instructions.find((i) => i.address === labels.get("exclude"))!;
    branch.mnemonic = "jne";
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("rejects unbalanced per-candidate stack effects", () => {
    const { code, codes, summary } = fixture({ unbalanced: true });
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("requires the complete read-only enumerator graph", () => {
    const { code, codes, summary } = fixture();
    const head = codes.get(0x200)!;
    const read = head.instructions.find(
      (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "memory" && i.operands[1].segment === "ds",
    )!;
    read.operands.reverse();
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("rejects an extra CFG edge skipping advancement", () => {
    const { code, codes, summary, labels } = fixture();
    code.edges.push({ from: labels.get("insert")!, to: labels.get("gateway")!, kind: "next" });
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
});

it.each([-2, 3])("rejects an invalid private frame size %i", (size) => {
  const { code, codes, summary } = fixture();
  const reserve = code.instructions.find(
    (i) => i.mnemonic === "sub" && i.operands[0]?.kind === "register" && i.operands[0].name === "sp",
  )!;
  const value = reserve.operands[1];
  if (value?.kind !== "immediate") throw new Error("Synthetic private frame is missing.");
  value.value = size;
  expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
});

describe("constant enumeration mask bridges", () => {
  it("proves constant masks with rewritten coordinate arguments and no termination assumption", () => {
    const { code, codes, summary } = fixture({
      constantMasks: true,
      coordinateRewrite: true,
      bodyCoordinateRewrite: true,
    });
    const proof = proveOverlapProducer(code, codes, summary);
    expect(proof).toMatchObject({ finite: true, acyclic: true, excludesOwner: true, conditionalOnNormalReturn: true });
    expect(proof!.assumptions.join(" ")).toContain(
      "constant-mask variants may instead use that argument for coordinate arithmetic",
    );
    expect(proof!.assumptions.join(" ")).toContain("not a termination claim");
  });
  it.each([{ constantHead: true, coordinateRewrite: true }, { bodyCoordinateRewrite: true }])(
    "keeps argument eight stable when a mask reads it: %o",
    (options) => {
      const { code, codes, summary } = fixture(options);
      expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
    },
  );
  it("rejects a path entering after constant mask setup", () => {
    const { code, codes, summary } = fixture({ constantMasks: true, bypassMask: true });
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it.each(["headMask", "advance"])("rejects a register-derived mask at %s", (label) => {
    const { code, codes, summary, labels } = fixture({ constantMasks: true });
    const definition = code.instructions.find((i) => i.address === labels.get(label))!;
    definition.operands[1] = { kind: "register", name: "dx", width: 16 };
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("rejects rewriting the owner argument even when masks are constant", () => {
    const { code, codes, summary } = fixture({ constantMasks: true, coordinateRewrite: true });
    const write = code.instructions.find(
      (i) => i.mnemonic === "add" && i.operands[0]?.kind === "memory" && i.operands[0].segment === "ss",
    )!;
    if (write.operands[0]?.kind === "memory") write.operands[0].displacement = 6;
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it.each([0, 6, 0x60])("retains source and output store restrictions at %i", (store) => {
    const { code, codes, summary } = fixture({ constantMasks: true, store });
    expect(proveOverlapProducer(code, codes, summary)).toBeUndefined();
  });
  it("retains private frame and stack-balance checks", () => {
    const a = fixture({ constantMasks: true, unbalanced: true });
    expect(proveOverlapProducer(a.code, a.codes, a.summary)).toBeUndefined();
    const b = fixture({ constantMasks: true });
    const allocation = b.code.instructions.find(
      (i) => i.mnemonic === "sub" && i.operands[0]?.kind === "register" && i.operands[0].name === "sp",
    )!;
    allocation.operands[1] = { kind: "immediate", value: 1, width: 16 };
    expect(proveOverlapProducer(b.code, b.codes, b.summary)).toBeUndefined();
  });
});
