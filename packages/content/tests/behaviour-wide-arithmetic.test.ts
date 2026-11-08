import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode, type RoutineCode } from "../src/read/behaviour-code.ts";
import { discoverEngineSummaries, type EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

/** The signed multiply and the 32-bit division as every build has them. */
const MULTIPLY = [0x8b, 0xdc, 0x8b, 0x47, 0x04, 0xf7, 0x6f, 0x06, 0xcb];
const DIVIDE = Uint8Array.from(
  (
    "5556578bec8bf98b460a8b560c8b5e0e8b4e100bc975080bd274690bdb7465f7c70100751c0bd2790af7daf7d883da0083cf0c0bc9790af7d9" +
    "f7db83d90083f7048be9b920005733ff33f6d1e0d1d2d1d6d1d73bfd720b77043bf372052bf31bfd40e2e75bf7c3020074068bc68bd7d1ebf7" +
    "c304007407f7daf7d883da005f5e5dca0800f7f3f7c7020074019233d2ebed"
  )
    .match(/../g)!
    .map((h) => parseInt(h, 16)),
);
const layout = { callbacks: [], fields: [], diagnostics: [], objectArgument: undefined } as unknown as BehaviourLayout;
const codes = (image: Uint8Array, ...addresses: number[]) =>
  new Map<number, RoutineCode>(
    addresses.map((address) => [address, readRoutineCode(image, { address, segment: 0, offset: address }, 0x40)]),
  );

describe("32-bit arithmetic helpers", () => {
  it("knows the multiply and each entry of the division by their code", () => {
    const image = new Uint8Array(0x800);
    image.set(MULTIPLY, 0x100);
    image.set(DIVIDE, 0x300);
    // xor cx, cx; jmp body (the signed quotient) and mov cx, 2; jmp body (the signed remainder).
    image.set([0x33, 0xc9, 0xe9, ...le(0x300 - 0x205)], 0x200);
    image.set([0xb9, 2, 0, 0xe9, ...le(0x300 - 0x286)], 0x280);
    const summaries = discoverEngineSummaries(image, codes(image, 0x100, 0x200, 0x280), layout);
    const of = (address: number) => summaries.find((s) => s.address === address);
    expect(of(0x100)).toMatchObject({ kind: "wide-integer-arithmetic", arithmetic: { operation: "multiply16" } });
    expect(of(0x200)?.arithmetic).toEqual({ operation: "divide32", signed: true, remainder: false, stackBytes: 8 });
    expect(of(0x280)?.arithmetic).toEqual({ operation: "divide32", signed: true, remainder: true, stackBytes: 8 });
    // One byte different is not the helper.
    image[0x300 + 40]! ^= 1;
    expect(discoverEngineSummaries(image, codes(image, 0x200), layout)[0]?.arithmetic).toBeUndefined();
  });

  const entry = { address: 0, segment: 0, offset: 0 };
  const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
  const epilogue = [0x5e, 0x5d, 0xcb];
  const helper = (arithmetic: EngineSummary["arithmetic"]): EngineSummary =>
    ({
      address: 0x80,
      kind: "wide-integer-arithmetic",
      purpose: "",
      confidence: "checked",
      evidence: [],
      assumptions: [],
      argumentKind: "unknown",
      writes: [],
      returns: [],
      calls: [],
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      },
      returnConvention: { kind: "far", stackBytes: arithmetic!.stackBytes },
      arithmetic,
    }) as unknown as EngineSummary;
  /** mov ax, word; push ax, for each word from the first pushed. */
  const pushes = (...words: number[]) => words.flatMap((w) => [0xb8, ...le(w), 0x50]);
  const store = [0x89, 0x44, 0x60, 0x89, 0x54, 0x62]; // mov [si+0x60], ax; mov [si+0x62], dx
  const run = (code: number[], arithmetic: EngineSummary["arithmetic"]) => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([...prologue, ...code, ...store, ...epilogue]);
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, helper(arithmetic)]]) });
    const word = (offset: number) => result.writes.find((w) => w.offset === offset)?.value;
    return [word(0x60), word(0x62)];
  };

  it("multiplies two signed words into DX:AX", () => {
    // -2 × 3 = -6; the caller pops its two words.
    const [low, high] = run([...pushes(3, 0xfffe), 0x9a, 0x80, 0, 0, 0, 0x83, 0xc4, 4], {
      operation: "multiply16",
      stackBytes: 0,
    });
    expect(low).toMatchObject({ kind: "constant", value: 0xfffa });
    expect(high).toMatchObject({ kind: "constant", value: 0xffff });
  });

  it.each([
    [false, 0xfffc, 0xffff], // -33 / 7 = -4, toward zero
    [true, 0xfffb, 0xffff], // -33 % 7 = -5, with the dividend's sign
  ])("divides a signed 32-bit value, giving the remainder: %s", (remainder, low, high) => {
    // The divisor's high word is pushed first, the dividend's low word last; the helper pops all four.
    const [l, h] = run([...pushes(0, 7, 0xffff, 0xffdf), 0x9a, 0x80, 0, 0, 0], {
      operation: "divide32",
      signed: true,
      remainder,
      stackBytes: 8,
    });
    expect(l).toMatchObject({ kind: "constant", value: low });
    expect(h).toMatchObject({ kind: "constant", value: high });
  });

  it("keeps a 32-bit value passed from one helper to the next as it is", () => {
    // (field 0x10 × 16) / 4: the divisor is pushed first, then the product's high and low words.
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      ...pushes(0, 4),
      0xff,
      0x74,
      0x10, // push word [si+0x10]
      ...pushes(16),
      0x9a,
      0x80,
      0,
      0,
      0, // the multiply
      0x83,
      0xc4,
      4, // add sp, 4
      0x52,
      0x50, // push dx; push ax
      0x9a,
      0x90,
      0,
      0,
      0, // the division, which pops all four
      ...store,
      ...epilogue,
    ]);
    const summaries = new Map([
      [0x80, helper({ operation: "multiply16", stackBytes: 0 })],
      [0x90, { ...helper({ operation: "divide32", signed: true, remainder: false, stackBytes: 8 }), address: 0x90 }],
    ]);
    const result = analyseRoutine(image, entry, { engineSummaries: summaries });
    const low = JSON.stringify(result.writes.find((w) => w.offset === 0x60)?.value);
    expect(low).toContain('"operator":"s/"');
    expect(low).toContain('"operator":"*"');
    // The product isn't split into its words and joined again on the way.
    expect(low).not.toContain('"operator":"|"');
    expect(low).not.toContain('"kind":"unknown"');
  });
});

function le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
