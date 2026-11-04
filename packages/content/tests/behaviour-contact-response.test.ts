import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverContactResponse } from "../src/read/behaviour-contact-response.ts";
import { analyseRoutine, type Expression, type Predicate } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function assembly() {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; name: string }[] = [];
  return {
    emit: (...b: number[]) => bytes.push(...b),
    label: (name: string) => labels.set(name, bytes.length),
    branch(op: number, name: string) {
      bytes.push(op, 0);
      patches.push({ at: bytes.length - 1, name });
    },
    size: () => bytes.length,
    finish() {
      for (const p of patches) {
        const delta = labels.get(p.name)! - p.at - 1;
        if (delta < -128 || delta > 127) throw Error("Synthetic branch exceeds signed byte");
        bytes[p.at] = delta & 255;
      }
      return bytes;
    },
  };
}
const word = (n: number) => [n & 255, (n >>> 8) & 255];
function read(bytes: number[], origin = 0x100, dataSegment = 0) {
  const image = new Uint8Array(0x5000);
  image.set(bytes, origin);
  return { image, code: readRoutineCode(image, { address: origin, segment: 0, offset: origin }, dataSegment) };
}
function clamp(kind: "shared" | "duplicated" | "data" = "shared", origin = 0x100, table = 0x2000) {
  const a = assembly(),
    ds = kind === "data";
  if (ds) a.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0x8b, 0x45, 4);
  else a.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x8b, 0x76, 6, 0x8b, 0x44, 4);
  a.emit(0xba, 58, 0, 0xf7, 0xea, 0x05, ...word(ds ? table : table & 15));
  if (ds) a.emit(0x8b, 0xc8);
  else a.emit(0xc7, 0x46, 0xfe, ...word(table >>> 4), 0x89, 0x46, 0xfc);
  const load = () => a.emit(...(ds ? [0x8b, 0xd9] : [0xc4, 0x5e, 0xfc]));
  const upper = () => {
    load();
    a.emit(...(ds ? [] : [0x26]), 0x8b, 0x47, 10);
  };
  const lower = () => {
    load();
    a.emit(0x33, 0xc0, ...(ds ? [] : [0x26]), 0x2b, 0x47, 10);
  };
  for (const offset of [56, 54]) {
    if (ds) {
      a.emit(0x8b, 0x45, offset);
      load();
      a.emit(0x3b, 0x47, 10);
      a.branch(0x7e, "lower" + offset);
      upper();
      a.emit(0x89, 0x45, offset);
      a.branch(0xeb, "next" + offset);
      a.label("lower" + offset);
      lower();
      a.emit(0x39, 0x45, offset);
      a.branch(0x7d, "next" + offset);
      lower();
      a.emit(0x89, 0x45, offset);
    } else {
      upper();
      a.emit(0x3b, 0x44, offset);
      a.branch(0x7d, "lower" + offset);
      if (kind === "duplicated") {
        upper();
        a.emit(0x89, 0x44, offset);
        a.branch(0xeb, "next" + offset);
      } else a.branch(0xeb, "store" + offset);
      a.label("lower" + offset);
      lower();
      a.emit(0x3b, 0x44, offset);
      a.branch(0x7e, "next" + offset);
      if (kind === "duplicated") lower();
      else a.emit(0x33, 0xc0, 0x26, 0x2b, 0x47, 10);
      a.label("store" + offset);
      a.emit(0x89, 0x44, offset);
    }
    a.label("next" + offset);
  }
  a.emit(...(ds ? [0x5f, 0x5e, 0x5d, 0xcb] : [0x5e, 0x8b, 0xe5, 0x5d, 0xcb]));
  return read(a.finish(), origin);
}
const backend = (address = 0x800): EngineSummary => ({
  address,
  kind: "scalar-resource-service",
  purpose: "Checks a scalar resource request.",
  confidence: "inferred",
  evidence: [],
  assumptions: ["Resource storage has no hidden alias to an existing part."],
  argumentOffset: 6,
  argumentKind: "scalar",
  calls: [],
  writes: [],
  returns: [],
  returnConvention: { kind: "far", stackBytes: 0 },
  footprint: {
    complete: false,
    partMemoryComplete: true,
    preservesArgumentMemory: true,
    preservesPartState: true,
    unknownEffects: ["Driver effects are unresolved."],
    unknownGlobalEffects: ["Driver globals may change."],
  },
});
function resource(far = false, origin = 0x100, bridge = true) {
  const a = assembly();
  a.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x8b, 0x76, 6, 0x83, 0x7c, 4, 0);
  a.branch(0x75, "done");
  a.emit(
    0x8b,
    0x44,
    54,
    0x99,
    0x33,
    0xc2,
    0x2b,
    0xc2,
    0x50,
    0x8b,
    0x44,
    56,
    0x99,
    0x33,
    0xc2,
    0x2b,
    0xc2,
    0x5a,
    0x03,
    0xd0,
    0x89,
    0x56,
    0xfe,
    0x81,
    0x7e,
    0xfe,
    0,
    16,
  );
  a.branch(0x7e, "done");
  a.emit(0xb8, 20, 0, 0x50);
  if (far) a.emit(0x9a, 0, 8, 0, 0);
  else {
    a.emit(0x90, ...(bridge ? [0x0e] : []));
    // Relative displacement is fixed up after the prefix length is known.
    const count = a.size();
    a.emit(0xe8, ...word(0x800 - origin - count - 3));
  }
  a.emit(0x59);
  a.label("done");
  a.emit(0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  return read(a.finish(), origin);
}
function discover(f: ReturnType<typeof read>, summaries = new Map<number, EngineSummary>()) {
  return discoverContactResponse(f.code, summaries, 0x2000, 0, 3, f.image.length);
}
const signed = (n: number) => (n << 16) >> 16;
function value(e: Expression, fields: Record<number, number>, limit: number): number {
  if (e.kind === "constant") return e.value & 65535;
  if (e.kind === "field") return fields[e.offset]! & 65535;
  if (e.kind === "table") return limit & 65535;
  if (e.kind !== "binary") throw Error("Unresolved public formula");
  const a = value(e.left, fields, limit),
    b = value(e.right, fields, limit);
  switch (e.operator) {
    case "+":
      return (a + b) & 65535;
    case "-":
      return (a - b) & 65535;
    case "^":
      return a ^ b;
    case ">>":
      return (signed(a) >> b) & 65535;
    default:
      throw Error("Unsupported public formula");
  }
}
function predicate(p: Predicate, fields: Record<number, number>, limit = 0): boolean {
  if (p.kind === "and") return p.terms.every((t) => predicate(t, fields, limit));
  if (p.kind !== "compare") throw Error("Unresolved public predicate");
  let a = value(p.left, fields, limit),
    b = value(p.right, fields, limit);
  if (p.signed) {
    a = signed(a);
    b = signed(b);
  }
  switch (p.operator) {
    case "==":
      return a === b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    default:
      throw Error("Unsupported public predicate");
  }
}

describe("Small contact response contracts", () => {
  it.each(["shared", "duplicated", "data"] as const)("checks the complete %s compiler form", (kind) => {
    const f = clamp(kind),
      summary = discover(f)!;
    expect(summary?.contactResponse?.kind).toBe("velocity-limit");
    expect(summary.writes).toHaveLength(4);
    expect(summary.footprint.preservesPartState).toBe(true);
    expect(summary.evidence).toHaveLength(f.code.instructions.length);
  });
  it("binds relocated code and the discovered table", () => {
    const f = clamp("shared", 0x300, 0x2400);
    expect(discoverContactResponse(f.code, new Map(), 0x2400, 0, 3, f.image.length)).toBeDefined();
    expect(discover(f)).toBeUndefined();
  });
  it("rejects a wrong record stride and a missing control-flow edge", () => {
    const f = clamp(),
      multiply = f.code.instructions.find(
        (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "register" && i.operands[0].name === "dx",
      )!;
    const bad = f.image.slice();
    bad[multiply.address + 1] = 57;
    expect(discover({ image: bad, code: readRoutineCode(bad, f.code, 0) })).toBeUndefined();
    expect(discover({ ...f, code: { ...f.code, edges: f.code.edges.slice(1) } })).toBeUndefined();
  });
  it("rejects a changed velocity store, branch or return convention", () => {
    const f = clamp();
    for (const i of f.code.instructions.filter(
      (i) =>
        i.mnemonic === "jge" ||
        i.mnemonic === "retf" ||
        (i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].segment === "ds"),
    )) {
      const image = f.image.slice();
      if (i.mnemonic === "jge") image[i.address] = 0x7f;
      else if (i.mnemonic === "retf") image[i.address] = 0xc3;
      else image[i.address + 2] = 12;
      expect(discover({ image, code: readRoutineCode(image, f.code, 0) })).toBeUndefined();
    }
  });
  it("rejects a table that wraps or exceeds the image", () => {
    const f = clamp();
    expect(discoverContactResponse(f.code, new Map(), 0x2000, 0, 2000, f.image.length)).toBeUndefined();
    expect(discoverContactResponse(f.code, new Map(), 0x2000, 0, 3, 0x2010)).toBeUndefined();
  });
  it("keeps upper-test priority for signed limits, including the negative boundary", () => {
    const relation = discover(clamp())!.contactResponse!;
    if (relation.kind !== "velocity-limit") throw Error("Wrong contract");
    for (const limit of [-32768, -100, -1, 0, 1, 100, 32767])
      for (const input of [-32768, -32767, -101, -100, -1, 0, 1, 99, 100, 101, 32767]) {
        const cases = relation.cases.filter((c) => c.field === 54 && predicate(c.condition, { 54: input }, limit));
        expect(cases.length).toBeLessThanOrEqual(1);
        const result = cases.length ? signed(value(cases[0]!.value, {}, limit)) : input;
        const expected = input > limit ? limit : input < signed(-limit) ? signed(-limit) : input;
        expect(result).toBe(expected);
      }
  });
  it.each([false, true])("retains the resource gate and unresolved globals with far=%s", (far) => {
    const f = resource(far),
      summary = discover(f, new Map([[0x800, backend()]]))!;
    expect(summary?.contactResponse?.kind).toBe("contact-resource-request");
    expect(summary.footprint.complete).toBe(false);
    expect(summary.footprint.preservesPartState).toBe(true);
    expect(summary.footprint.unknownGlobalEffects?.length).toBeGreaterThan(0);
  });
  it("does not install a resource contract without the backend's owner-memory proof", () => {
    const f = resource();
    expect(discover(f)).toBeUndefined();
    const b = backend();
    b.footprint.preservesPartState = false;
    expect(discover(f, new Map([[b.address, b]]))).toBeUndefined();
    expect(discover(resource(false, 0x100, false), new Map([[0x800, backend()]]))).toBeUndefined();
  });
  it("models wrapped absolute sums rather than unbounded mathematical speed", () => {
    const relation = discover(resource(), new Map([[0x800, backend()]]))!.contactResponse!;
    if (relation.kind !== "contact-resource-request") throw Error("Wrong contract");
    for (const [x, y, expected] of [
      [4096, 0, false],
      [4097, 0, true],
      [-4097, 0, true],
      [-32768, 0, false],
      [20000, 20000, false],
      [-32768, -32768, false],
      [0, 32767, true],
    ] as const)
      expect(predicate(relation.condition, { 4: 0, 54: x, 56: y })).toBe(expected);
    expect(predicate(relation.condition, { 4: 1, 54: 5000, 56: 0 })).toBe(false);
  });
  it("declines a caller that lacks the far return frame", () => {
    const f = resource(),
      summary = discover(f, new Map([[0x800, backend()]]))!;
    f.image.set(
      [0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x56, 0xe8, 0xf6, 0xfc, 0x59, 0xc7, 0x44, 12, 2, 0, 0x5d, 0xcb],
      0x400,
    );
    const code = readRoutineCode(f.image, { address: 0x400, segment: 0, offset: 0x400 }, 0);
    const result = analyseRoutine(f.image, code, {
      dataSegment: 0,
      stateOffset: 12,
      engineSummaries: new Map([[summary.address, summary]]),
    });
    expect(result.uncertainties.some((u) => u.includes("helper return frame"))).toBe(true);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 2)).toBe(false);
  });
  it("retains caller state across the resource wrapper with an established far frame", () => {
    const f = resource(),
      summary = discover(f, new Map([[0x800, backend()]]))!;
    f.image.set(
      [0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x56, 0x9a, 0, 1, 0, 0, 0x59, 0xc7, 0x44, 12, 2, 0, 0x5d, 0xcb],
      0x400,
    );
    const code = readRoutineCode(f.image, { address: 0x400, segment: 0, offset: 0x400 }, 0);
    const result = analyseRoutine(f.image, code, {
      dataSegment: 0,
      stateOffset: 12,
      engineSummaries: new Map([[summary.address, summary]]),
    });
    expect(
      result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 2 && t.confidence !== "unresolved"),
    ).toBe(true);
    expect(result.uncertainties.some((u) => u.startsWith("Effects of call"))).toBe(false);
  });
});
