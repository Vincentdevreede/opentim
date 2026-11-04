import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverGearConnections } from "../src/read/behaviour-gear-connections.ts";
import { discoverGearRun } from "../src/read/behaviour-gear-run.ts";
import { gearFixture, gearFields } from "./fixtures/gear.ts";

function fixture(
  options: {
    shift?: number;
    far?: boolean;
    nop?: boolean;
    shared?: boolean;
    wordNegativeX?: boolean;
    wordNegativeY?: boolean;
  } = {},
) {
  const f = gearFixture({ shift: options.shift }),
    origin = 0xa00 + (options.shift ?? 0),
    common = 0xc00 + (options.shift ?? 0),
    x = 0x70,
    y = 0x72,
    sourceNext = 0x10;
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; label: string; width: number }[] = [];
  const emit = (...b: number[]) => bytes.push(...b),
    label = (name: string) => labels.set(name, origin + bytes.length),
    jump = (name: string, op = 0xe9) => {
      emit(op);
      const width = op === 0xe9 ? 2 : 1;
      patches.push({ at: bytes.length, label: name, width });
      emit(...Array<number>(width).fill(0));
    };
  const compareNegative = (offset: number, word = false) =>
    emit(word ? 0x81 : 0x83, 0x7e, offset, 0xe0, ...(word ? [0xff] : []));
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 6, 0x56, 0x57, 0x8b, 0x76, 6, 0x56);
  if (options.nop) emit(0x90);
  label("call");
  if (options.far) emit(0x9a, common & 255, common >> 8, 0, 0);
  else {
    emit(0x0e);
    const d = common - (origin + bytes.length + 3);
    emit(0xe8, d & 255, (d >> 8) & 255);
  }
  emit(0x59, 0xc7, 0x46, 0xfa, 0, 0);
  jump("clearGuard");
  label("clearBody");
  emit(0x8b, 0x5e, 0xfa, 0xd1, 0xe3, 0xc7, 0x40, gearFields.links, 0, 0, 0xff, 0x46, 0xfa);
  label("clearGuard");
  emit(0x83, 0x7e, 0xfa, 4);
  jump("clearBody", 0x7c);
  emit(0x8b, 0x3e, 0, 9);
  jump("memberGuard");
  label("body");
  emit(0x3b, 0xfe);
  jump("next", 0x74);
  emit(0x83, 0x7d, gearFields.type, 14);
  jump("next", 0x75);
  emit(
    0x8b,
    0x44,
    x,
    0x2b,
    0x45,
    x,
    0x89,
    0x46,
    0xfe,
    0x8b,
    0x44,
    y,
    0x2b,
    0x45,
    y,
    0x89,
    0x46,
    0xfc,
    0x83,
    0x7e,
    0xfc,
    0,
  );
  jump("vertical", 0x75);
  emit(0x83, 0x7e, 0xfe, 32);
  jump("right", 0x75);
  emit(0x89, 0x7c, gearFields.links);
  jump(options.shared ? "horizontalDone" : "next");
  label("right");
  compareNegative(0xfe, options.wordNegativeX);
  jump(options.shared ? "horizontalDone" : "next", 0x75);
  emit(0x89, 0x7c, gearFields.links + 2);
  label("horizontalDone");
  jump("next");
  label("vertical");
  emit(0x83, 0x7e, 0xfe, 0);
  jump("next", 0x75);
  emit(0x83, 0x7e, 0xfc, 32);
  jump("below", 0x75);
  emit(0x89, 0x7c, gearFields.links + 4);
  jump("next");
  label("below");
  compareNegative(0xfc, options.wordNegativeY);
  jump("next", 0x75);
  emit(0x89, 0x7c, gearFields.links + 6);
  label("next");
  emit(0x8b, 0x7d, sourceNext);
  label("memberGuard");
  emit(0x0b, 0xff);
  jump("body", 0x75);
  label("done");
  emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  for (const p of patches) {
    const d = labels.get(p.label)! - (origin + p.at + p.width);
    if (p.width === 1 && (d < -128 || d > 127)) throw new Error("Synthetic branch is out of range");
    bytes[p.at] = d & 255;
    if (p.width === 2) bytes[p.at + 1] = (d >> 8) & 255;
  }
  f.image.set(bytes, origin);
  // An otherwise unknown common C helper changes both a coordinate and state before the described snapshot.
  f.image.set(
    [0x55, 0x8b, 0xec, 0x8b, 0x5e, 6, 0xc7, 0x47, x, 42, 0, 0xc7, 0x47, gearFields.state, 3, 0, 0x5d, 0xcb],
    common,
  );
  const code = readRoutineCode(f.image, { address: origin, segment: 0, offset: origin }, 0);
  f.codes.set(origin, code);
  f.codes.set(common, readRoutineCode(f.image, { address: common, segment: 0, offset: common }, 0));
  f.layout.fields.push(
    { confidence: "inferred", evidence: [], assumptions: [], name: "savedPositionX", offset: x },
    { confidence: "inferred", evidence: [], assumptions: [], name: "savedPositionY", offset: y },
  );
  const run = discoverGearRun(f.code, f.codes, f.helpers, f.layout)!;
  expect(run).toBeDefined();
  expect(code.status).toBe("complete");
  return { ...f, code, run, x, y, common, labels, sourceNext };
}
describe("reset-built gear connections", () => {
  it.each([
    {},
    { nop: true },
    { far: true, shared: true },
    { far: true, nop: true, shared: true, wordNegativeX: true, wordNegativeY: true },
    { shared: true, wordNegativeX: true },
  ])("matches relocated compiler forms %o", (options) => {
    const f = fixture({ shift: 0x1000, ...options }),
      result = discoverGearConnections(f.code, f.codes, f.run, f.layout);
    expect(result).toMatchObject({
      run: f.run.address,
      snapshot: { kind: "afterCommonCall", helper: f.common },
      coordinates: { x: f.x, y: f.y, width: 16 },
      source: { headOffset: 0x900, nextField: f.sourceNext, type: 14, ignoreSelf: true },
      distance: 32,
      difference: "ownerMinusCandidate",
      unmatched: 0,
      lastMatchWins: true,
      conditionalOnNormalReturn: true,
      colouring: {
        kind: "coordinateBitParity",
        bit: 5,
        fields: [f.x, f.y],
        op: "xor",
        flipsEveryDirectConnection: true,
      },
    });
    expect(result!.evidence.some((e) => e.address === f.run.address)).toBe(true);
    expect(result!.meshOnlyCorollary).toMatchObject({
      requiresRetainedCoordinateMap: true,
      requiresNoCheckedPeerEdges: true,
      requiresOnlyRootInitiallyMoving: true,
      requiresDistinctNegation: true,
      conflict: 0,
      confidence: "inferred",
    });
    expect(result!.meshOnlyCorollary!.assumptions.join(" ")).toContain("neither zero nor 0x8000");
    expect(result!.slots).toEqual([
      { offset: gearFields.links, dx: 32, dy: 0 },
      { offset: gearFields.links + 2, dx: -32, dy: 0 },
      { offset: gearFields.links + 4, dx: 0, dy: 32 },
      { offset: gearFields.links + 6, dx: 0, dy: -32 },
    ]);
    expect(result!.assumptions.join(" ")).toContain("does not assert that the helper preserves state");
    expect(result!.assumptions.join(" ")).toContain("one common saved-coordinate map");
  });
  it("proves the word-colour lemma including every wrap boundary without executing instructions", () => {
    for (let word = 0; word < 65536; word++)
      for (const step of [-32, 32]) {
        const other = (word + step) & 0xffff;
        if ((((word >>> 5) ^ (other >>> 5)) & 1) !== 1) throw new Error(`Colour did not flip at ${word} by ${step}`);
      }
  });
  it.each(["self", "type", "distance", "lastMatch", "counter"])("rejects changed %s logic", (change) => {
    const f = fixture();
    if (change === "self") {
      const c = f.code.instructions.find(
        (i) => i.mnemonic === "cmp" && i.operands[0]?.kind === "register" && i.operands[0].name === "di",
      )!;
      c.operands[0] = { kind: "register", name: "si", width: 16 };
    }
    if (change === "type") {
      const c = f.code.instructions.find(
        (i) => i.mnemonic === "cmp" && i.operands[0]?.kind === "memory" && i.operands[0].segment === "ds",
      )!;
      c.operands[1] = { kind: "immediate", value: 15, width: 16 };
    }
    if (change === "distance") {
      const c = f.code.instructions.find(
        (i) => i.mnemonic === "cmp" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 32,
      )!;
      c.operands[1] = { kind: "immediate", value: 31, width: 16 };
    }
    if (change === "lastMatch") {
      const j = f.code.instructions.find((i) => i.flow === "jump" && i.target?.address === f.labels.get("next"))!;
      j.target = { address: f.labels.get("done")!, offset: f.labels.get("done")!, segment: 0 };
    }
    if (change === "counter") {
      const c = f.code.instructions.find(
        (i) => i.mnemonic === "cmp" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 4,
      )!;
      c.operands[1] = { kind: "immediate", value: 5, width: 16 };
    }
    expect(discoverGearConnections(f.code, f.codes, f.run, f.layout)).toBeUndefined();
  });
  it("rejects hidden entries that bypass the overwrite or advance", () => {
    const f = fixture();
    f.code.edges.push({ from: f.labels.get("body")!, to: f.labels.get("memberGuard")!, kind: "jump" });
    expect(discoverGearConnections(f.code, f.codes, f.run, f.layout)).toBeUndefined();
  });
  it("rejects aliased coordinates, output slots or source links", () => {
    const f = fixture();
    f.layout.fields.find((p) => p.name === "savedPositionY")!.offset = f.x;
    expect(discoverGearConnections(f.code, f.codes, f.run, f.layout)).toBeUndefined();
    const g = fixture();
    g.run.links[0] = g.x;
    expect(discoverGearConnections(g.code, g.codes, g.run, g.layout)).toBeUndefined();
    const h = fixture();
    const advance = h.code.instructions.find((i) => i.address === h.labels.get("next"))!;
    if (advance.operands[1]?.kind === "memory") advance.operands[1].displacement = gearFields.links;
    expect(discoverGearConnections(h.code, h.codes, h.run, h.layout)).toBeUndefined();
  });
});
