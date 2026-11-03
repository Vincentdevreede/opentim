import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverContactBounds } from "../src/read/behaviour-contact-bounds.ts";
import { proveContactFootprint } from "../src/read/behaviour-contact-effects.ts";
import { discoverContactScalar } from "../src/read/behaviour-contact-scalars.ts";
import { discoverEmptyContactReturn } from "../src/read/behaviour-contact-empty.ts";
import { discoverContactArithmetic } from "../src/read/behaviour-contact-arithmetic.ts";
import { analyseRoutine, type Expression } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function imageCode(body: number[], origin = 0x80) {
  const image = new Uint8Array(origin + body.length);
  image.set(body, origin);
  const entry = { address: origin, segment: 0, offset: origin };
  return { image, entry, code: readRoutineCode(image, entry, 0) };
}
function assembly() {
  const body: number[] = [],
    labels = new Map<string, number>(),
    fixups: { at: number; name: string }[] = [];
  return {
    emit: (...bytes: number[]) => body.push(...bytes),
    label: (name: string) => labels.set(name, body.length),
    branch: (opcode: number, name: string) => {
      body.push(opcode, 0);
      fixups.push({ at: body.length - 1, name });
    },
    finish: () => {
      for (const { at, name } of fixups) {
        const delta = labels.get(name)! - at - 1;
        if (delta < -128 || delta > 127) throw Error("Invalid synthetic branch");
        body[at] = delta & 255;
      }
      return body;
    },
  };
}
function rangeFixture(origin = 0x80) {
  const a = assembly();
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x8b, 0x5e, 8, 0x8b, 0x4e, 10, 0x3b, 0xd9);
  a.branch(0x7e, "ordered");
  a.emit(0x8b, 0xc6, 0x2b, 0xc1, 0x8b, 0xd3, 0x2b, 0xd1, 0x3b, 0xc2);
  a.branch(0x77, "bridge");
  a.label("one");
  a.emit(0xb8, 1, 0);
  a.branch(0xeb, "done");
  a.label("bridge");
  a.branch(0xeb, "zero");
  a.label("ordered");
  a.emit(0x8b, 0xc6, 0x2b, 0xc3, 0x8b, 0xd1, 0x2b, 0xd3, 0x3b, 0xc2);
  a.branch(0x77, "zero");
  a.branch(0xeb, "one");
  a.label("zero");
  a.emit(0x33, 0xc0);
  a.label("done");
  a.emit(0x5e, 0x5d, 0xcb);
  return imageCode(a.finish(), origin);
}
function emptyFixture() {
  const a = assembly();
  a.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x46, 6, 0xa3, 0, 3, 0x8b, 0x1e, 0, 3, 0x83, 0xbf, 0x82, 0, 0);
  a.branch(0x75, "nonempty");
  a.emit(0x33, 0xc0);
  a.branch(0xeb, "done");
  a.label("nonempty");
  a.emit(0xc7, 0x47, 0x1e, 1, 0);
  a.label("done");
  a.emit(0x5f, 0x5e, 0x5d, 0xcb);
  return imageCode(a.finish(), 0x200);
}
function divisionFixture(bridge = false) {
  const a = assembly();
  if (bridge) a.emit(0x59, 0x0e, 0x51);
  a.emit(0x33, 0xc9);
  a.branch(0xeb, "frame");
  a.label("frame");
  a.emit(
    0x55,
    0x56,
    0x57,
    0x8b,
    0xec,
    0x8b,
    0xf9,
    0x8b,
    0x46,
    10,
    0x8b,
    0x56,
    12,
    0x8b,
    0x5e,
    14,
    0x8b,
    0x4e,
    16,
    0x0b,
    0xc9,
  );
  a.branch(0x75, "sign");
  a.emit(0x0b, 0xd2);
  a.branch(0x74, "fast");
  a.emit(0x0b, 0xdb);
  a.branch(0x74, "fast");
  a.label("sign");
  a.emit(0xf7, 0xc7, 1, 0);
  a.branch(0x75, "normal");
  a.emit(0x0b, 0xd2);
  a.branch(0x79, "positiveNumerator");
  a.emit(0xf7, 0xda, 0xf7, 0xd8, 0x83, 0xda, 0, 0x83, 0xcf, 12);
  a.label("positiveNumerator");
  a.emit(0x0b, 0xc9);
  a.branch(0x79, "normal");
  a.emit(0xf7, 0xd9, 0xf7, 0xdb, 0x83, 0xd9, 0, 0x83, 0xf7, 4);
  a.label("normal");
  a.emit(0x8b, 0xe9, 0xb9, 32, 0, 0x57, 0x33, 0xff, 0x33, 0xf6);
  a.label("loop");
  a.emit(0xd1, 0xe0, 0xd1, 0xd2, 0xd1, 0xd6, 0xd1, 0xd7, 0x3b, 0xfd);
  a.branch(0x72, "next");
  a.branch(0x77, "subtract");
  a.emit(0x3b, 0xf3);
  a.branch(0x72, "next");
  a.label("subtract");
  a.emit(0x2b, 0xf3, 0x1b, 0xfd, 0x40);
  a.label("next");
  a.branch(0xe2, "loop");
  a.emit(0x5b, 0xf7, 0xc3, 2, 0);
  a.branch(0x74, "quotientSign");
  a.emit(0x8b, 0xc6, 0x8b, 0xd7, 0xd1, 0xeb);
  a.label("quotientSign");
  a.emit(0xf7, 0xc3, 4, 0);
  a.branch(0x74, "done");
  a.emit(0xf7, 0xda, 0xf7, 0xd8, 0x83, 0xda, 0);
  a.label("done");
  a.emit(0x5f, 0x5e, 0x5d, 0xca, 8, 0);
  a.label("fast");
  a.emit(0xf7, 0xf3, 0xf7, 0xc7, 2, 0);
  a.branch(0x74, "zeroHigh");
  a.emit(0x92);
  a.label("zeroHigh");
  a.emit(0x33, 0xd2);
  a.branch(0xeb, "done");
  return imageCode(a.finish(), 0x400);
}
function typeFixture() {
  const a = assembly();
  a.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x8b, 0x56, 6, 0x8b, 0x5e, 8, 0x3b, 0xd3);
  a.branch(0x7e, "first");
  a.emit(0x89, 0x56, 0xfe, 0x8b, 0xd3, 0x8b, 0x5e, 0xfe);
  for (const [n, [x, y]] of [
    [12, 42],
    [42, 52],
    [54, 58],
    [54, 54],
  ]
    .map((pair) => pair as [number, number])
    .entries()) {
    a.label(n === 0 ? "first" : `pair${n}`);
    a.emit(0x83, 0xfa, x);
    a.branch(0x75, n === 3 ? "zero" : `pair${n + 1}`);
    a.emit(0x83, 0xfb, y);
    a.branch(0x75, n === 3 ? "zero" : `pair${n + 1}`);
    if (n === 0) {
      a.label("one");
      a.emit(0xb8, 1, 0);
      a.branch(0xeb, "done");
    } else a.branch(0xeb, "one");
  }
  a.label("zero");
  a.emit(0x33, 0xc0);
  a.label("done");
  a.emit(0x8b, 0xe5, 0x5d, 0xcb);
  return imageCode(a.finish());
}
/** Checks the extracted report algebra, without interpreting any machine instruction. */
function evaluate(e: Expression, args: number[]): number {
  if (e.kind === "constant") return e.value;
  if (e.kind === "field" && e.object === "argument") return args[(e.offset - 6) / 2]!;
  if (e.kind !== "binary") throw Error("Expected closed scalar algebra");
  const a = evaluate(e.left, args),
    b = evaluate(e.right, args);
  switch (e.operator) {
    case "-":
      return (a - b) & 65535;
    case "^":
      return a ^ b;
    case "|":
      return a | b;
    case "*":
      return (a * b) & 65535;
    case "==":
      return Number(a === b);
    case "<=":
      return Number(a <= b);
    default:
      throw Error(`Unexpected operator ${e.operator}`);
  }
}
const signed = (n: number) => (n >= 32768 ? n - 65536 : n);

describe("contact scalar relations", () => {
  it.each([false, true])("proves the complete signed division helper with return bridge %s", (bridge) => {
    const { code } = divisionFixture(bridge);
    expect(code.status).toBe("complete");
    expect(discoverContactArithmetic(code)).toMatchObject({
      operation: "signedLongQuotient",
      rounding: "towardsZero",
      overflow: "wrap32",
      zeroDivisor: "noNormalReturn",
    });
  });
  it.each(["counter", "mode", "carry", "subtract", "return"])("rejects a changed division %s", (change) => {
    const { code } = divisionFixture();
    if (change === "counter")
      code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          i.operands[0]?.kind === "register" &&
          i.operands[0].name === "cx" &&
          i.operands[1]?.kind === "immediate",
      )!.operands[1] = { kind: "immediate", value: 31, width: 16 };
    if (change === "mode") code.instructions[0]!.mnemonic = "or";
    if (change === "carry") code.instructions.find((i) => i.mnemonic === "rcl")!.mnemonic = "shl";
    if (change === "subtract") code.instructions.find((i) => i.mnemonic === "sub")!.mnemonic = "add";
    if (change === "return") code.instructions.find((i) => i.mnemonic === "retf")!.operands = [];
    expect(discoverContactArithmetic(code)).toBeUndefined();
  });
  it("proves the full signed word product and rejects a changed input offset", () => {
    const { code } = imageCode([0x8b, 0xdc, 0x8b, 0x47, 4, 0xf7, 0x6f, 6, 0xcb]);
    expect(discoverContactArithmetic(code)).toMatchObject({
      operation: "signedWordProduct",
      inputWidth: 16,
      outputWidth: 32,
    });
    const source = code.instructions[1]!.operands[1];
    if (source?.kind === "memory") source.displacement += 2;
    expect(discoverContactArithmetic(code)).toBeUndefined();
  });
  it.each([0x80, 0x400])(
    "recognises a relocated endpoint range at %i",
    (origin) => {
      const { code } = rangeFixture(origin);
      expect(code.status).toBe("complete");
      const summary = discoverContactScalar(code)!;
      expect(summary.kind).toBe("contact-coordinate-range");
      expect(summary.evidence).toHaveLength(code.instructions.length);
      for (const endpoints of [
        [0, 0],
        [10, 20],
        [20, 10],
        [65535, 1],
        [32768, 32767],
        [32768, 32768],
        [65534, 65535],
      ]) {
        const low = Math.min(...endpoints.map(signed)),
          high = Math.max(...endpoints.map(signed));
        for (let input = 0; input < 65536; input++)
          expect(evaluate(summary.returns[0]!.value, [input, ...endpoints])).toBe(
            Number(signed(input) >= low && signed(input) <= high),
          );
      }
      // Every 16-bit input for each range takes a few seconds, more when all packages test at once.
    },
    30_000,
  );
  it("recognises exactly the symmetric excluded type pairs", () => {
    const summary = discoverContactScalar(typeFixture().code)!;
    expect(summary.kind).toBe("contact-type-filter");
    const pairs = new Set(["12:42", "42:12", "42:52", "52:42", "54:58", "58:54", "54:54"]);
    for (const a of [0, 12, 42, 52, 54, 58, 32768, 65535])
      for (const b of [0, 12, 42, 52, 54, 58, 32768, 65535])
        expect(evaluate(summary.returns[0]!.value, [a, b])).toBe(Number(pairs.has(`${a}:${b}`)));
  });
  it.each(["branch", "store", "edge"])("rejects a changed range %s", (change) => {
    const { code } = rangeFixture();
    if (change === "branch") code.instructions.find((i) => i.mnemonic === "ja")!.mnemonic = "jg";
    if (change === "store") code.instructions[5]!.operands.reverse();
    if (change === "edge") code.edges.pop();
    expect(discoverContactScalar(code)).toBeUndefined();
  });
});

describe("contact pointer footprints", () => {
  it("retains a global origin through a register copy and an interior pointer", () => {
    const { code } = imageCode([
      0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3, 0x8b, 0xf3, 0x81, 0xc6, 0x40, 0, 0xc7, 0x44, 2, 1, 0, 0x5d, 0xcb,
    ]);
    expect(proveContactFootprint(code, new Map())?.objectWrites).toMatchObject([
      { root: "global", id: 0x300, offset: 0x42, width: 16 },
    ]);
  });
  it("maps an argument stored in a global back to the argument", () => {
    const { code } = imageCode([
      0x55, 0x8b, 0xec, 0x8b, 0x46, 6, 0xa3, 0, 3, 0x8b, 0x1e, 0, 3, 0xc7, 0x47, 0x20, 1, 0, 0x5d, 0xcb,
    ]);
    expect(proveContactFootprint(code, new Map())?.objectWrites).toMatchObject([
      { root: "argument", id: 6, offset: 0x20 },
    ]);
  });
  it.each([false, true])("joins all branch origins, with conflicting origins %s", (different) => {
    const a = assembly();
    a.emit(0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3, 0x0b, 0xc0);
    a.branch(0x74, "store");
    a.emit(0x8b, 0x1e, different ? 2 : 0, 3);
    a.label("store");
    a.emit(0xc7, 0x47, 0x20, 1, 0, 0x5d, 0xcb);
    const scope = proveContactFootprint(imageCode(a.finish()).code, new Map());
    if (different) expect(scope).toBeUndefined();
    else expect(scope!.objectWrites[0]!.id).toBe(0x300);
  });
  it("closes a loop invariant without unrolling the counter", () => {
    const a = assembly();
    a.emit(0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3);
    a.label("loop");
    a.emit(0xc7, 0x47, 0x20, 1, 0, 0x49);
    a.branch(0x75, "loop");
    a.emit(0x5d, 0xcb);
    expect(proveContactFootprint(imageCode(a.finish()).code, new Map())?.objectWrites).toHaveLength(1);
  });
  it.each(["lost", "byte", "missingEdge", "implicit", "frame"])("rejects unsafe %s provenance", (change) => {
    const body = [
      0x55,
      0x8b,
      0xec,
      0x8b,
      0x1e,
      0,
      3,
      ...(change === "lost"
        ? [0x8b, 0xd8]
        : change === "byte"
          ? [0xb3, 0]
          : change === "implicit"
            ? [0xab]
            : change === "frame"
              ? [0x8b, 0xe8]
              : []),
      0xc7,
      0x47,
      0x20,
      1,
      0,
      0x5d,
      0xcb,
    ];
    const { code } = imageCode(body);
    if (change === "missingEdge") code.edges.pop();
    expect(proveContactFootprint(code, new Map())).toBeUndefined();
  });
  it("retains state but invalidates fields of a globally selected contact subject", () => {
    const origin = 0x80,
      target = 0x200;
    const { image, entry } = imageCode(
      [
        0x55,
        0x8b,
        0xec,
        0x56,
        0x8b,
        0x76,
        6,
        0x8b,
        0x44,
        0x20,
        0x89,
        0x44,
        0x22,
        0x33,
        0xc0,
        0x50,
        0x9a,
        target & 255,
        target >> 8,
        0,
        0,
        0x59,
        0x8b,
        0x44,
        0x20,
        0x89,
        0x44,
        0x0c,
        0x5e,
        0x5d,
        0xcb,
      ],
      origin,
    );
    const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
    const summary: EngineSummary = {
      ...fact,
      address: target,
      kind: "contact-search",
      purpose: "Adjusts contact geometry",
      argumentOffset: 6,
      argumentKind: "scalar",
      writes: [],
      returns: [],
      calls: [],
      globalObjectWrites: [{ ...fact, objectGlobal: 0x300, offset: 0x20, width: 16 }],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      },
    };
    const result = analyseRoutine(image, readRoutineCode(image, entry, 0), {
      stateOffset: 12,
      engineSummaries: new Map([[target, summary]]),
    });
    expect(result.engineCalls).toHaveLength(1);
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)).toMatchObject({
      confidence: "unresolved",
      value: { kind: "field", offset: 0x20, unresolved: true },
    });
  });
});

describe("contact rectangle preparation", () => {
  it("keeps the different coordinate and half-dimension sources separate", () => {
    const body = [
      0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3, 0x8b, 0x47, 0x30, 0xa3, 2, 3, 0x8b, 0x47, 0x32, 0xa3, 4, 3, 0xa1, 2, 3, 0x03,
      0x47, 0x40, 0xa3, 6, 3, 0xa1, 4, 3, 0x03, 0x47, 0x42, 0xa3, 8, 3, 0x8b, 0x47, 0x50, 0xd1, 0xf8, 0x8b, 0x16, 2, 3,
      0x03, 0xd0, 0x89, 0x16, 10, 3, 0x8b, 0x47, 0x52, 0xd1, 0xf8, 0x8b, 0x16, 4, 3, 0x03, 0xd0, 0x89, 0x16, 12, 3,
      0x5d, 0xcb,
    ];
    const summary = discoverContactBounds(imageCode(body).code, new Map())!;
    expect(summary.contactBounds?.values).toMatchObject([
      { operation: "copy", inputs: [{ offset: 0x30 }] },
      { operation: "copy", inputs: [{ offset: 0x32 }] },
      { operation: "add", inputs: [{ offset: 0x30 }, { offset: 0x40 }] },
      { operation: "add", inputs: [{ offset: 0x32 }, { offset: 0x42 }] },
      { operation: "addSignedHalf", inputs: [{ offset: 0x30 }, { offset: 0x50 }] },
      { operation: "addSignedHalf", inputs: [{ offset: 0x32 }, { offset: 0x52 }] },
    ]);
  });
  it("binds relocated globals and arbitrary coordinate fields from instructions", () => {
    const body = [
      0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3, 0xa1, 2, 3, 0x2b, 0x47, 0x30, 0xa3, 6, 3, 0xa1, 4, 3, 0x2b, 0x47, 0x32, 0xa3,
      8, 3, 0x5d, 0xcb,
    ];
    const summary = discoverContactBounds(imageCode(body).code, new Map())!;
    expect(summary.contactBounds).toMatchObject({
      kind: "movement",
      objectGlobal: 0x300,
      values: [
        {
          global: 0x306,
          operation: "subtract",
          inputs: [
            { kind: "global", offset: 0x302 },
            { kind: "objectField", offset: 0x30 },
          ],
        },
        { global: 0x308, inputs: [{ offset: 0x304 }, { offset: 0x32 }] },
      ],
    });
    expect(summary.footprint.preservesArgumentMemory).toBe(true);
  });
  it("rejects overlapping scratch words", () => {
    const { code } = imageCode([
      0x55, 0x8b, 0xec, 0x8b, 0x1e, 0, 3, 0xa1, 1, 3, 0x2b, 0x47, 0x30, 0xa3, 6, 3, 0xa1, 4, 3, 0x2b, 0x47, 0x32, 0xa3,
      8, 3, 0x5d, 0xcb,
    ]);
    expect(discoverContactBounds(code, new Map())).toBeUndefined();
  });
});

describe("empty contact return", () => {
  it("retains the context store before the zero-outline return", () => {
    const empty = discoverEmptyContactReturn(emptyFixture().code)!;
    expect(empty).toMatchObject({ argumentOffset: 6, outlineField: 0x82, subjectGlobal: 0x300, returnValue: 0 });
    expect(empty.evidence.some((e) => e.text.includes("[0x300]"))).toBe(true);
  });
  it.each(["call", "result", "branch", "store"])("rejects a changed early-return %s", (change) => {
    const { code } = emptyFixture();
    if (change === "result")
      code.instructions.find((i) => i.mnemonic === "xor")!.operands[1] = { kind: "register", name: "bx", width: 16 };
    if (change === "branch") code.instructions.find((i) => i.mnemonic === "jne")!.mnemonic = "je";
    if (change === "store")
      code.instructions.find((i) => i.mnemonic === "mov" && i.operands[0]?.kind === "memory")!.operands.reverse();
    if (change === "call") code.instructions.find((i) => i.mnemonic === "pop")!.mnemonic = "call";
    expect(discoverEmptyContactReturn(code)).toBeUndefined();
  });
  it("uses the zero return without forgetting the engine context store", () => {
    const fixture = emptyFixture(),
      empty = discoverEmptyContactReturn(fixture.code)!;
    const caller = imageCode([
      0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x84, 0x82, 0, 0, 0, 0xc7, 0x44, 0x1e, 7, 0, 0x56, 0x9a, 0, 2, 0, 0,
      0x59, 0x89, 0x44, 0x0c, 0x8b, 0x44, 0x1e, 0x89, 0x84, 0x96, 0, 0x8b, 0x1e, 0, 3, 0xc7, 0x87, 0x98, 0, 9, 0, 0x5e,
      0x5d, 0xcb,
    ]);
    const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
    const summary: EngineSummary = {
      ...fact,
      address: 0x200,
      kind: "contact-search",
      purpose: "Searches contacts",
      argumentOffset: 6,
      argumentKind: "object",
      contactSearch: {
        ...fact,
        subjectGlobal: 0x300,
        candidateGlobal: 0x302,
        fields: [],
        preservesState: true,
        geometry: "unresolved",
        purpose: "Searches contacts",
        emptyReturn: empty,
      },
      writes: [],
      returns: [],
      calls: [],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: [],
      },
    };
    const result = analyseRoutine(caller.image, caller.code, {
      stateOffset: 12,
      engineSummaries: new Map([[0x200, summary]]),
    });
    expect(result.engineCalls?.[0]?.purpose).toContain("no outline pointer");
    expect(result.writes.find((w) => w.object === "part" && w.offset === 12)?.value).toMatchObject({
      kind: "constant",
      value: 0,
    });
    expect(result.writes.find((w) => w.object === "part" && w.offset === 0x96)?.value).toMatchObject({
      kind: "constant",
      value: 7,
    });
    expect(result.writes.find((w) => w.object === "part" && w.offset === 0x98)?.value).toMatchObject({
      kind: "constant",
      value: 9,
    });
  });
});
