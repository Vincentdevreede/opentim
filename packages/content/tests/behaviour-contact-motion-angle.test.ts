import { describe, expect, it } from "vitest";
import { addContactMotionAngleSummaries, type ContactMotionAngle } from "../src/read/behaviour-contact-motion-angle.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function assembly() {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; name: string }[] = [];
  return {
    emit: (...values: number[]) => bytes.push(...values),
    label: (name: string) => labels.set(name, bytes.length),
    branch(opcode: number, name: string) {
      bytes.push(opcode, 0);
      patches.push({ at: bytes.length - 1, name });
    },
    finish() {
      for (const p of patches) {
        const delta = labels.get(p.name)! - p.at - 1;
        if (delta < -128 || delta > 127) throw new Error("Synthetic branch is out of range");
        bytes[p.at] = delta & 255;
      }
      return bytes;
    },
  };
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
  return a.finish();
}

/** Decodes relocated synthetic numerical helper shapes; no part or runtime graph is constructed. */
function fixture(bridge = false) {
  const a = assembly(),
    far = (address: number) => a.emit(0x9a, address & 255, address >> 8, 0, 0);
  a.emit(0x55, 0x8b, 0xec, 0x4c, 0x4c, 0x56, 0x83, 0x7e, 8, 0);
  a.branch(0x7f, "xpositive");
  a.branch(0x7c, "xnegative");
  a.emit(0x83, 0x7e, 6, 0);
  a.branch(0x73, "xpositive");
  a.label("xnegative");
  a.emit(0xb8, 1, 0);
  a.branch(0xeb, "xflag");
  a.label("xpositive");
  a.emit(0x33, 0xc0);
  a.label("xflag");
  a.emit(0x88, 0x46, 0xff, 0x0a, 0xc0);
  a.branch(0x74, "ysign");
  a.emit(0x8b, 0x46, 8, 0x8b, 0x56, 6, 0xf7, 0xd8, 0xf7, 0xda, 0x83, 0xd8, 0, 0x89, 0x56, 6, 0x89, 0x46, 8);
  a.label("ysign");
  a.emit(0x83, 0x7e, 12, 0);
  a.branch(0x7f, "ypositive");
  a.branch(0x7c, "ynegative");
  a.emit(0x83, 0x7e, 10, 0);
  a.branch(0x73, "ypositive");
  a.label("ynegative");
  a.emit(0xb8, 1, 0);
  a.branch(0xeb, "yflag");
  a.label("ypositive");
  a.emit(0x33, 0xc0);
  a.label("yflag");
  a.emit(0x88, 0x46, 0xfe, 0x0a, 0xc0);
  a.branch(0x74, "compare");
  a.emit(0x8b, 0x46, 12, 0x8b, 0x56, 10, 0xf7, 0xd8, 0xf7, 0xda, 0x83, 0xd8, 0, 0x89, 0x56, 10, 0x89, 0x46, 12);
  a.label("compare");
  a.emit(0x8b, 0x46, 8, 0x8b, 0x56, 6, 0x3b, 0x46, 12);
  a.branch(0x7f, "greater");
  a.branch(0x7c, "smallx");
  a.emit(0x3b, 0x56, 10);
  a.branch(0x73, "greater");
  a.label("smallx");
  a.emit(0xff, 0x76, 12, 0xff, 0x76, 10, 0x8b, 0x56, 8, 0x8b, 0x46, 6, 0xb1, 9);
  far(0x500);
  a.emit(0x52, 0x50);
  far(0x600);
  a.emit(0x50);
  far(0x900);
  a.emit(0x59, 0xba, 0, 4, 0x2b, 0xd0, 0x8b, 0xf2);
  a.branch(0xeb, "foldx");
  a.label("greater");
  a.emit(0x8b, 0x46, 8, 0x8b, 0x56, 6, 0x3b, 0x46, 12);
  a.branch(0x7c, "equal");
  a.branch(0x7f, "smally");
  a.emit(0x3b, 0x56, 10);
  a.branch(0x76, "equal");
  a.label("smally");
  a.emit(0xff, 0x76, 8, 0xff, 0x76, 6, 0x8b, 0x56, 12, 0x8b, 0x46, 10, 0xb1, 9);
  far(0x500);
  a.emit(0x52, 0x50);
  far(0x600);
  a.emit(0x50);
  far(0x900);
  a.emit(0x59, 0x8b, 0xf0);
  a.branch(0xeb, "foldx");
  a.label("equal");
  a.emit(0x8b, 0x46, 6, 0x0b, 0x46, 8);
  a.branch(0x75, "nonzerox");
  a.emit(0xbe, 0, 4);
  a.branch(0xeb, "foldx");
  a.label("nonzerox");
  a.emit(0x8b, 0x46, 10, 0x0b, 0x46, 12);
  a.branch(0x75, "diagonal");
  a.emit(0x33, 0xf6);
  a.branch(0xeb, "foldx");
  a.label("diagonal");
  a.emit(0xbe, 0, 2);
  a.label("foldx");
  a.emit(0x80, 0x7e, 0xff, 0);
  a.branch(0x74, "foldy");
  a.emit(0xb8, 0, 8, 0x2b, 0xc6, 0x8b, 0xf0);
  a.label("foldy");
  a.emit(0x80, 0x7e, 0xfe, 0);
  a.branch(0x74, "output");
  a.emit(0xb8, 0, 16, 0x2b, 0xc6, 0x8b, 0xf0);
  a.label("output");
  a.emit(0x8b, 0xc6, 5, 0, 0xfc, 0x8b, 0xf0, 0x8b, 0xc6, 0xb1, 4, 0xd3, 0xe0);
  a.branch(0xeb, "done");
  a.label("done");
  a.emit(0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  const shift = assembly();
  shift.emit(0x80, 0xf9, 16);
  shift.branch(0x73, "large");
  shift.emit(0x8b, 0xd8, 0xd3, 0xe0, 0xd3, 0xe2, 0xf6, 0xd9, 0x80, 0xc1, 16, 0xd3, 0xeb, 0x0b, 0xd3, 0xcb);
  shift.label("large");
  shift.emit(0x80, 0xe9, 16, 0x92, 0x33, 0xc0, 0xd3, 0xe2, 0xcb);
  const wrapper = [
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    0x8b,
    0x44,
    0x32,
    0x2b,
    0x44,
    0x36,
    0x99,
    0x52,
    0x50,
    0x8b,
    0x44,
    0x34,
    0x2b,
    0x44,
    0x30,
    0x99,
    0x52,
    0x50,
    0x9a,
    0,
    1,
    0,
    0,
    0x83,
    0xc4,
    8,
    ...(bridge ? [0xeb, 0] : []),
    0x5e,
    0x5d,
    0xcb,
  ];
  const image = new Uint8Array(0x1600).fill(0x66);
  image.set(wrapper, 0x40);
  image.set(a.finish(), 0x100);
  image.set(shift.finish(), 0x500);
  image.set(divisionFixture(), 0x600);
  image.set([0x55, 0x8b, 0xec, 0x8b, 0x5e, 6, 0xd1, 0xe3, 0x2e, 0x8b, 0x87, 0, 0x10, 0x5d, 0xcb], 0x900);
  // Deliberately not an arctangent table: metadata must retain the actual loaded words, and zero motion must not read them.
  for (let n = 0; n < 512; n++) {
    const word = n ^ 0x1234;
    image[0x1000 + n * 2] = word & 255;
    image[0x1001 + n * 2] = word >> 8;
  }
  const codes = new Map(
    [0x40, 0x100, 0x500, 0x600, 0x900].map((address) => [
      address,
      readRoutineCode(image, { address, offset: address, segment: 0 }, 0),
    ]),
  );
  for (const code of codes.values()) expect(code.status).toBe("complete");
  const summaries = new Map<number, EngineSummary>();
  const discover = (snapshot?: Uint8Array) => {
    summaries.clear();
    addContactMotionAngleSummaries(codes, summaries, undefined, 0, snapshot);
    return summaries;
  };
  return { image, codes, discover };
}
const relationOf = (s: EngineSummary) =>
  (s as EngineSummary & { contactMotionAngle: ContactMotionAngle }).contactMotionAngle;

describe("movement angle relations", () => {
  it.each([false, true])("certifies the complete backend and wrapper with return bridge %s", (bridge) => {
    const { codes, discover } = fixture(bridge),
      summary = discover().get(0x40)!;
    expect(summary).toMatchObject({
      kind: "contact-motion-angle",
      argumentKind: "object",
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: { complete: true, preservesArgumentMemory: true },
    });
    expect(relationOf(summary)).toMatchObject({
      backend: 0x100,
      lookup: { routine: 0x900, segment: 0, offset: 0x1000, entriesRequired: 512 },
      wrapper: {
        fields: { positionX: 0x30, previousX: 0x34, positionY: 0x32, previousY: 0x36 },
        x: "previousMinusCurrent",
        y: "currentMinusPrevious",
      },
      folds: { subtract: 1024, leftShift: 4, outputWidth: 16 },
    });
    expect(summary.returns).toHaveLength(2);
    expect(summary.returns[0]!.value).toMatchObject({ kind: "constant", value: 0 });
    expect(summary.returns[1]!.value.kind).toBe("unknown");
    expect(summary.evidence).toHaveLength([...codes.values()].reduce((n, code) => n + code.instructions.length, 0));
  });

  it("records loaded table bytes without replacing them with a host angle function", () => {
    const { image, discover } = fixture(),
      table = relationOf(discover(image).get(0x40)!).lookup;
    expect(table.snapshot).toBe("loadedImage");
    expect(table.initialImageWords).toHaveLength(512);
    expect(table.initialImageWords![0]).toBe(0x1234);
    expect(table.initialImageWords![511]).toBe(511 ^ 0x1234);
    expect(table.initialImageBytes).toEqual(Array.from(image.slice(0x1000, 0x1400)));
    const missing = relationOf(discover(image.slice(0, 0x1100)).get(0x40)!).lookup;
    expect(missing.initialImageWords).toBeUndefined();
    expect(missing.initialImageIssue).toContain("512");
  });

  it("retains the wrapper-domain proof and does not extend it to arbitrary signed longs", () => {
    const { discover } = fixture(),
      relation = relationOf(discover().get(0x40)!);
    expect(relation.wrapperDomain).toMatchObject({
      maximumMagnitude: 32768,
      ratioIndex: [0, 511],
      equalMagnitudes: { bothZero: 1024, otherwise: 512 },
    });
    expect(relation.genericBackend).toMatchObject({
      comparison: "signedHighThenUnsignedLow",
      shiftedNumerator: "wrap32",
      quotientIndex: "lowWord",
      boundedLookupNotClaimed: true,
      argumentCopiesMayChange: true,
    });
    expect(relation.assumptions.some((s) => s.includes("INT_MIN"))).toBe(true);
    // Bounds on the public integer relation, not execution of the numerical helper.
    for (const [minor, major] of [
      [0, 1],
      [1, 32768],
      [32767, 32768],
      [32766, 32767],
    ]) {
      const index = Math.floor((minor! * 2 ** relation.shift.count) / major!);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(511);
    }
  });

  it.each(["shift", "division", "lookup", "wrapper", "edge"])("rejects changed %s evidence", (change) => {
    const { codes, discover } = fixture();
    if (change === "shift") {
      const move = codes
        .get(0x100)!
        .instructions.find(
          (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "register" && i.operands[0].name === "cl",
        )!;
      if (move.operands[1]?.kind === "immediate") move.operands[1].value = 10;
    }
    if (change === "division") {
      const count = codes
        .get(0x600)!
        .instructions.find(
          (i) =>
            i.mnemonic === "mov" &&
            i.operands[0]?.kind === "register" &&
            i.operands[0].name === "cx" &&
            i.operands[1]?.kind === "immediate",
        )!;
      if (count.operands[1]?.kind === "immediate") count.operands[1].value = 31;
    }
    if (change === "lookup") {
      const read = codes
        .get(0x900)!
        .instructions.find((i) => i.operands[1]?.kind === "memory" && i.operands[1].segment === "cs")!;
      if (read.operands[1]?.kind === "memory") read.operands[1].displacement = 0xff00;
    }
    if (change === "wrapper") codes.get(0x40)!.instructions.find((i) => i.mnemonic === "cwd")!.mnemonic = "cbw";
    if (change === "edge")
      codes.get(0x100)!.edges.push({ from: 0x100, to: codes.get(0x100)!.instructions.at(-1)!.address, kind: "jump" });
    expect(discover().has(0x40)).toBe(false);
  });

  it("uses zero motion as an ordinary exact return while retaining evidence", () => {
    const { image, discover } = fixture(),
      summary = discover(image).get(0x40)!;
    const caller = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
    for (const offset of [0x30, 0x34, 0x32, 0x36]) caller.push(0xc7, 0x44, offset, 7, 0);
    caller.push(0x56, 0x9a, 0x40, 0, 0, 0, 0x59, 0x89, 0x44, 12, 0x5e, 0x5d, 0xcb);
    image.set(caller, 0xa00);
    const result = analyseRoutine(
      image,
      { address: 0xa00, offset: 0xa00, segment: 0 },
      { engineSummaries: new Map([[summary.address, summary]]) },
    );
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "constant", value: 0 });
    expect(result.transitions.at(-1)!.confidence).toBe("inferred");
    expect(result.outcomes![0]!.evidence.some((e) => e.address === 0x100)).toBe(true);
  });
});
