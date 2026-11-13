import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { addBufferEffectSummaries, privateStackOutputs } from "../src/read/behaviour-buffer-effects.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverEngineSummaries } from "../src/read/behaviour-helpers.ts";

const leaf = 0x100,
  wrapper = 0x180,
  caller = 0x220;
function fixture(
  options: { output?: number; frame?: number; unsafeLoad?: boolean; foreignCall?: boolean; global?: boolean } = {},
) {
  const image = new Uint8Array(0x500);
  const load = options.unsafeLoad ? [0x75, 3, 0x8b, 0x5e, 10] : [0x8b, 0x5e, 10];
  image.set(
    [0x55, 0x8b, 0xec, ...load, 0x89, 7, 0x89, 0x47, 2, ...(options.global ? [0xa3, 0, 4] : []), 0x5d, 0xcb],
    leaf,
  );
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x83,
    0xec,
    options.frame ?? 12,
    0x8d,
    0x46,
    (options.output ?? -12) & 255,
    0x50,
    0x8d,
    0x46,
    0xf8,
    0x50,
    0x8d,
    0x46,
    0xfc,
    0x50,
    0x0e,
  ];
  const target = options.foreignCall ? 0x400 : leaf;
  const delta = (target - (wrapper + bytes.length + 3)) & 0xffff;
  bytes.push(0xe8, delta & 255, delta >> 8, 0x83, 0xc4, 6, 0x8b, 0xe5, 0x5d, 0xcb);
  image.set(bytes, wrapper);
  const d = (wrapper - (caller + 7)) & 0xffff;
  image.set([0x55, 0x8b, 0xec, 0x0e, 0xe8, d & 255, d >> 8, 0x5d, 0xcb], caller);
  const codes = new Map(
    [leaf, wrapper, caller].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
  return discoverEngineSummaries(image, codes);
}

describe("private output-buffer footprints", () => {
  it("finds a separately supplied output argument and retains every store address", () => {
    const result = fixture().find((s) => s.address === leaf)!;
    expect(result.kind).toBe("argument-buffer-update");
    expect(result.footprint.preservesPartState).toBe(false);
    expect(result.writes.map((w) => [w.argumentOffset, w.offset, w.width])).toEqual([
      [10, 0, 16],
      [10, 2, 16],
    ]);
    expect(result.writes.every((w) => w.evidence.length > 0)).toBe(true);
    expect(result.returns).toEqual([]);
  });
  it("composes a private-frame buffer query into its outer read-only caller", () => {
    const summaries = fixture();
    for (const address of [wrapper, caller])
      expect(summaries.find((s) => s.address === address)).toMatchObject({
        kind: "private-buffer-query",
        footprint: { complete: true, preservesArgumentMemory: true, preservesPartState: true },
        writes: [],
      });
  });
  it.each([{ output: -2 }, { frame: 8 }, { foreignCall: true }, { global: true }])(
    "rejects a private-frame claim when an output or callee is unbounded",
    (options) => {
      expect(fixture(options).find((s) => s.address === wrapper)?.footprint.complete).not.toBe(true);
    },
  );
  it.each([
    // mov ax, [bp+6]; mov dx, 58; imul dx; mov bx, ax; mov word [bx+0x1234], 5
    [0x8b, 0x46, 6, 0xba, 58, 0, 0xf7, 0xea, 0x8b, 0xd8, 0xc7, 0x87, 0x34, 0x12, 5, 0],
    // mov dx, [bp+6]; mov ax, [bp+8]; cwd; mov bx, dx; mov [bx+4], ax
    [0x8b, 0x56, 6, 0x8b, 0x46, 8, 0x99, 0x8b, 0xda, 0x89, 0x47, 4],
  ])("forgets an argument pointer that a multiply or a sign extension replaces", (...body) => {
    const image = new Uint8Array(0x200);
    image.set([0x55, 0x8b, 0xec, ...body, 0x5d, 0xcb], 0x100);
    const summaries = new Map();
    addBufferEffectSummaries(
      new Map([[0x100, readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0)]]),
      summaries,
    );
    expect(summaries.get(0x100)?.kind).not.toBe("argument-buffer-update");
  });
  it("requires the argument pointer load on every incoming path to a store", () => {
    expect(fixture({ unsafeLoad: true }).find((s) => s.address === leaf)?.kind).not.toBe("argument-buffer-update");
    expect(fixture({ unsafeLoad: true }).find((s) => s.address === wrapper)?.footprint.complete).not.toBe(true);
  });
});

describe("private outputs following read-only object arguments", () => {
  function outputsFixture(offset = -2, bypass = false) {
    const image = new Uint8Array(0x300);
    image.set([0x55, 0x8b, 0xec, 0x8b, 0x5e, 10, 0x89, 7, 0x5d, 0xcb], 0x100);
    const bytes = [
      0x55,
      0x8b,
      0xec,
      0x83,
      0xec,
      2,
      0x8d,
      0x46,
      offset & 255,
      0x50,
      0x57,
      0x56,
      0x9a,
      0,
      1,
      0,
      0,
      0x83,
      0xc4,
      6,
      0x8b,
      0xe5,
      0x5d,
      0xcb,
    ];
    image.set(bytes);
    const codes = new Map(
      [0, 0x100].map((address) => [address, readRoutineCode(image, { address, segment: 0, offset: address }, 0)]),
    );
    const summaries = discoverEngineSummaries(image, codes);
    const code = codes.get(0)!;
    if (bypass) code.edges.push({ from: 0x200, to: 9, kind: "jump" });
    return { image, code, callee: summaries.find((s) => s.address === 0x100)!, summaries };
  }
  it("maps the output after two object inputs without requiring those inputs to be private", () => {
    const { code, callee } = outputsFixture();
    const result = privateStackOutputs(code, code.calls[0]!, callee);
    expect(result?.outputs).toEqual([{ offset: -2, width: 16 }]);
    expect(result?.evidence.some((item) => item.text.startsWith("lea"))).toBe(true);
  });
  it("applies a bounded private output without invalidating part state or inventing its numeric value", () => {
    const { image, callee } = outputsFixture();
    image.set([
      0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0xc7, 0x46, 0xfe, 7, 0, 0x8d, 0x46, 0xfe, 0x50, 0x57, 0x56, 0x9a, 0, 1, 0, 0,
      0x83, 0xc4, 6, 0x8b, 0x46, 0xfe, 0x8b, 0xe5, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(
      image,
      { address: 0, segment: 0, offset: 0 },
      { engineSummaries: new Map([[callee.address, callee]]) },
    );
    expect(routine.uncertainties).toEqual([]);
    expect(routine.transitions[0]?.to).toMatchObject({ kind: "field", object: "part", offset: 12 });
    expect(routine.outcomes?.[0]?.returnValue.kind).toBe("unknown");
    expect(routine.outcomes?.[0]?.effectsComplete).toBe(true);
  });
  it.each([{ offset: -1 }, { offset: -4 }, { bypass: true }])(
    "rejects a crossed bound or bypassed setup %s",
    (options) => {
      const { code, callee } = outputsFixture(options.offset, options.bypass);
      expect(privateStackOutputs(code, code.calls[0]!, callee)).toBeUndefined();
    },
  );
});
