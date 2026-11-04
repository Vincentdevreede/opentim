import { describe, expect, it } from "vitest";
import { discoverGearRun } from "../src/read/behaviour-gear-run.ts";
import { gearFixture as fixture, gearFields } from "./fixtures/gear.ts";
const { state, delta, flags, links } = gearFields;

describe("root gear connection pass", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("matches exact relocated root calls: far %s, NOP %s", (far, nop) => {
    const f = fixture({ shift: 0x1000, far, nop }),
      result = discoverGearRun(f.code, f.codes, f.summaries, f.layout);
    expect(result).toMatchObject({
      argumentOffset: 6,
      stateField: state,
      deltaField: delta,
      flagsField: flags,
      visitedMask: 64,
      propagation: f.propAddress,
      advance: f.advanceAddress,
      links: [links, links + 2, links + 4, links + 6],
      pass: { count: 4, mode: 2, initialConflict: 0, skipNull: true, skipDisabled: false },
      result: { name: "connectionConflict", width: 16, values: [0, 1] },
      scan: {
        accumulatorRegister: "di",
        counter: { displacement: -2, width: 16 },
        pointerSlot: { displacement: -4, width: 16 },
      },
    });
    expect(result!.fields.map((f) => f.offset).sort()).toEqual([state, delta, flags]);
    expect(result!.evidence.some((e) => e.address === f.peerAddress)).toBe(true);
    expect(result!.assumptions.join(" ")).toContain("still normalizes raw state");
  });
  it.each(["mode", "count", "accumulator", "flags", "owner", "clear"])("rejects a changed root %s", (change) => {
    const f = fixture();
    let i;
    if (change === "mode")
      i = f.code.instructions.find(
        (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 2,
      );
    if (change === "count")
      i = f.code.instructions.find(
        (i) => i.mnemonic === "cmp" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 4,
      );
    if (change === "accumulator")
      i = f.code.instructions.find(
        (i) => i.mnemonic === "xor" && i.operands[0]?.kind === "register" && i.operands[0].name === "di",
      );
    if (change === "flags")
      i = f.code.instructions.find((i) => i.mnemonic === "or" && i.operands[0]?.kind === "memory");
    if (change === "owner")
      i = f.code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          i.operands[1]?.kind === "memory" &&
          i.operands[1].segment === "ss" &&
          i.operands[1].displacement === 6,
      );
    if (change === "clear")
      i = f.code.instructions.find(
        (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].segment === "ds",
      );
    if (change === "owner" && i!.operands[1]?.kind === "memory") i!.operands[1].displacement += 2;
    else if (change === "accumulator") i!.mnemonic = "or";
    else i!.operands[1] = { kind: "immediate", value: 7, width: 16 };
    expect(discoverGearRun(f.code, f.codes, f.summaries, f.layout)).toBeUndefined();
  });
  it("rejects skipped root and callee CFG paths even with a saved certificate", () => {
    const f = fixture();
    f.code.edges.push({ from: f.code.address, to: f.code.instructions.at(-5)!.address, kind: "jump" });
    expect(discoverGearRun(f.code, f.codes, f.summaries, f.layout)).toBeUndefined();
    const g = fixture();
    const p = g.codes.get(g.propAddress)!;
    p.edges.push({ from: p.address, to: p.instructions.at(-1)!.address, kind: "jump" });
    expect(discoverGearRun(g.code, g.codes, g.summaries, g.layout)).toBeUndefined();
  });
  it("returns independently checked relation metadata instead of trusting supplied relation objects", () => {
    const f = fixture();
    const suppliedPropagation = f.summaries.get(f.propAddress)!.partGraph!.propagation!;
    const suppliedAdvance = f.summaries.get(f.advanceAddress)!.partGraph!.advancement!;
    suppliedPropagation.gearType = 99;
    suppliedAdvance.blockedMask = 0;
    const contract = discoverGearRun(f.code, f.codes, f.summaries, f.layout)!;
    expect(contract.propagationRelation.gearType).toBe(14);
    expect(contract.advancementRelation.blockedMask).toBe(2048);
    expect(contract.propagationRelation).not.toBe(suppliedPropagation);
    expect(contract.advancementRelation).not.toBe(suppliedAdvance);
  });
  it("requires agreeing full propagation, advance and peer certificates", () => {
    const f = fixture();
    f.summaries.get(f.propAddress)!.partGraph!.links[0]! += 2;
    expect(discoverGearRun(f.code, f.codes, f.summaries, f.layout)).toBeUndefined();
    const g = fixture();
    g.codes.delete(g.peerAddress);
    expect(discoverGearRun(g.code, g.codes, g.summaries, g.layout)).toBeUndefined();
    const h = fixture();
    h.codes.get(h.advanceAddress)!.instructions.find((i) => i.mnemonic === "add")!.mnemonic = "sub";
    expect(discoverGearRun(h.code, h.codes, h.summaries, h.layout)).toBeUndefined();
  });
});
