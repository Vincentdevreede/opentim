import { describe, expect, it } from "vitest";
import { addGearSummaries } from "../src/read/behaviour-gear.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

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

/** These images contain only relocated synthetic instruction shapes; no runtime part graph is supplied. */
function fixture() {
  const propagation = assembly(0x100),
    advancement = assembly(0x300),
    peer = assembly(0x500);
  const p = propagation;
  p.label("entry");
  p.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 6, 0x56, 0x57, 0x8b, 0x7e, 6, 0x8b, 0x76, 8);
  p.emit(0x83, 0x7c, 0x26, 0);
  p.jump("assign", 0x74);
  p.emit(0x83, 0x7e, 10, 1);
  p.jump("modeTwo", 0x75);
  p.emit(0x8b, 0x44, 0x26, 0x3b, 0x45, 0x26);
  p.jump("modeTwo", 0x74);
  p.emit(0xc7, 0x46, 12, 1, 0);
  p.jump("expand");
  p.label("modeTwo");
  p.emit(0x83, 0x7e, 10, 2);
  p.jump("expand", 0x75);
  p.emit(0x8b, 0x44, 0x26, 0x3b, 0x45, 0x26);
  p.jump("expand", 0x75);
  p.emit(0xc7, 0x46, 12, 1, 0);
  p.jump("expand");
  p.label("assign");
  p.emit(0x83, 0x7e, 10, 1);
  p.jump("negate", 0x75);
  p.emit(0x8b, 0x45, 0x26);
  p.jump("store");
  p.label("negate");
  p.emit(0x33, 0xc0, 0x2b, 0x45, 0x26);
  p.label("store");
  p.emit(0x89, 0x44, 0x26);
  p.label("expand");
  p.emit(0x83, 0x7c, 0x34, 14);
  p.jump("finish", 0x75);
  p.emit(0xf7, 0x44, 0x30, 64, 0);
  p.jump("finish", 0x75);
  p.emit(0x83, 0x4c, 0x30, 64, 0xc7, 0x46, 0xfe, 0, 0);
  p.jump("header");
  p.label("body");
  p.emit(0x83, 0x7e, 0xfe, 4);
  p.jump("slot", 0x75);
  p.emit(0x56, 0x9a, 0, 5, 0, 0, 0x59, 0x89, 0x46, 0xfa, 0xc7, 0x46, 0xfc, 1, 0);
  p.jump("candidate");
  p.label("slot");
  p.emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x40, 0x60, 0x89, 0x46, 0xfa, 0xc7, 0x46, 0xfc, 2, 0);
  p.label("candidate");
  p.emit(0x83, 0x7e, 0xfa, 0);
  p.jump("update", 0x74);
  p.emit(0x8b, 0x5e, 0xfa, 0xf7, 0x47, 0x30, 0, 8);
  p.jump("update", 0x75);
  p.emit(0xff, 0x76, 12, 0xff, 0x76, 0xfc, 0x53, 0x56, 0x0e);
  p.jump("entry", 0xe8);
  p.emit(0x83, 0xc4, 8, 0x89, 0x46, 12);
  p.label("update");
  p.emit(0xff, 0x46, 0xfe);
  p.label("header");
  p.emit(0x83, 0x7e, 0xfe, 5);
  p.jump("body", 0x7c);
  p.label("finish");
  p.emit(0x8b, 0x46, 12, 0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);

  const a = advancement;
  a.label("entry");
  a.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x44, 0x26, 0x01, 0x44, 0x20);
  a.emit(0x83, 0x7c, 0x20, 0xff);
  a.jump("upper", 0x75);
  a.emit(0xc7, 0x44, 0x20, 3, 0);
  a.jump("clear");
  a.label("upper");
  a.emit(0x83, 0x7c, 0x20, 4);
  a.jump("clear", 0x75);
  a.emit(0xc7, 0x44, 0x20, 0, 0);
  a.label("clear");
  a.emit(0xc7, 0x44, 0x26, 0, 0, 0xc7, 0x46, 0xfe, 0, 0);
  a.jump("header");
  a.label("body");
  a.emit(0x83, 0x7e, 0xfe, 4);
  a.jump("slot", 0x75);
  a.emit(0x56, 0x9a, 0, 5, 0, 0, 0x59, 0x8b, 0xf8);
  a.jump("candidate");
  a.label("slot");
  a.emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x78, 0x60);
  a.label("candidate");
  a.emit(0x0b, 0xff);
  a.jump("update", 0x74);
  a.emit(0x83, 0x7d, 0x26, 0);
  a.jump("update", 0x74);
  a.emit(0xf7, 0x45, 0x30, 0, 8);
  a.jump("update", 0x75);
  a.emit(0x83, 0x7e, 8, 0);
  a.jump("type", 0x74);
  a.emit(0xc7, 0x45, 0x26, 0, 0);
  a.label("type");
  a.emit(0x83, 0x7d, 0x34, 14);
  a.jump("update", 0x75);
  a.emit(0xff, 0x76, 8, 0x57, 0x0e);
  a.jump("entry", 0xe8);
  a.emit(0x59, 0x59);
  a.label("update");
  a.emit(0xff, 0x46, 0xfe);
  a.label("header");
  a.emit(0x83, 0x7e, 0xfe, 5);
  a.jump("body", 0x7c);
  a.emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);

  const q = peer;
  q.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0x8b, 0x45, 0x58, 0x8b, 0xf0, 0x0b, 0xc0);
  q.jump("zero", 0x74);
  q.emit(0x39, 0x7c, 8);
  q.jump("first", 0x75);
  q.emit(0x8b, 0x44, 10);
  q.jump("done");
  q.label("first");
  q.emit(0x8b, 0x44, 8);
  q.jump("done");
  q.label("zero");
  q.emit(0x33, 0xc0);
  q.label("done");
  q.emit(0x5f, 0x5e, 0x5d, 0xcb);
  const image = new Uint8Array(0x600).fill(0x66);
  image.set(p.finish(), 0x100);
  image.set(a.finish(), 0x300);
  image.set(q.finish(), 0x500);
  const codes = new Map(
    [0x100, 0x300, 0x500].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
  for (const code of codes.values()) expect(code.status).toBe("complete");
  const fact = { confidence: "checked" as const, evidence: [], assumptions: [] };
  const layout: BehaviourLayout = {
    objectArgument: fact,
    callbacks: [],
    diagnostics: [],
    fields: [
      { ...fact, name: "state", offset: 0x20 },
      { ...fact, name: "stateDelta", offset: 0x26 },
      { ...fact, name: "drawingFlags", offset: 0x30 },
      { ...fact, name: "type", offset: 0x34 },
    ],
  };
  const summaries = new Map<number, EngineSummary>();
  const discover = () => {
    summaries.clear();
    addGearSummaries(codes, summaries, layout);
    return summaries;
  };
  return { codes, summaries, discover };
}

describe("declarative connected-gear relations", () => {
  it("records arbitrary-word assignment, exact conflict comparisons and ordered propagation", () => {
    const { discover } = fixture();
    const relation = discover().get(0x100)!.partGraph!.propagation!;
    expect(relation).toMatchObject({
      wordWidth: 16,
      fields: { movement: 0x26, type: 0x34, flags: 0x30 },
      arguments: { source: 6, target: 8, mode: 10, accumulator: 12 },
      local: {
        zeroTarget: { modeOne: "copySource", otherModes: "negateSource", conflict: false },
        nonzeroTarget: {
          retainMovement: true,
          modeOneConflict: "differentMovement",
          modeTwoConflict: "equalMovement",
          otherModesConflict: false,
        },
      },
      expansion: {
        order: "slotsThenPeer",
        markBeforeChildren: true,
        initiallyVisited: "checkIncomingEdgeWithoutExpansion",
        slots: { fields: [0x60, 0x62, 0x64, 0x66], mode: 2 },
        peer: { routine: 0x500, connectionField: 0x58, endpointFields: [8, 10], mode: 1 },
        skipBlocked: true,
      },
      result: { conflict: 1, otherwise: "incomingAccumulator", nonzeroIncomingStaysNonzero: true },
    });
    expect(relation.localConflicts[0]).toMatchObject({
      kind: "and",
      terms: [
        expect.anything(),
        expect.anything(),
        { operator: "!=", left: { object: "target" }, right: { object: "source" } },
      ],
    });
    expect(relation.localConflicts[1]).toMatchObject({
      kind: "and",
      terms: [expect.anything(), expect.anything(), { operator: "==" }],
    });
    expect(relation.zeroTargetAssignments[1]!.value).toMatchObject({
      kind: "binary",
      operator: "-",
      left: { kind: "constant", value: 0 },
      right: { object: "source", offset: 0x26 },
      width: 16,
    });
  });

  it("keeps the signed-domain theorem conditional and the general numeric result unspecified", () => {
    const { discover } = fixture();
    const summary = discover().get(0x100)!;
    expect(summary.partGraph!.propagation!.nonzeroSource).toMatchObject({
      labelOrder: "depthFirstFirstEncounter",
      initiallyNonzero: "retainInputMovement",
      assignedEdges: "doNotReportLocalConflict",
      modeTwoIsNotAnExactNegationTest: true,
      signedDomain: {
        requiresCommonMagnitude: true,
        requiresDistinctNegation: true,
        requiresModesOneOrTwo: true,
        conflict: "inconsistentEqualityAndOppositionConstraints",
      },
    });
    expect(summary.returns[0]!.value).toMatchObject({ kind: "constant", value: 1 });
    expect(summary.returns[1]!.value.kind).toBe("unknown");
    expect(summary.assumptions.some((s) => s.includes("equal references may alias"))).toBe(true);
  });

  it("distinguishes root advancement from suppressed descendants and clearing other parts", () => {
    const { discover } = fixture();
    const summary = discover().get(0x300)!;
    expect(summary.partGraph!.advancement).toMatchObject({
      fields: { state: 0x20, movement: 0x26, type: 0x34, flags: 0x30 },
      owner: {
        addMovement: true,
        normalise: [
          { from: 65535, to: 3 },
          { from: 4, to: 0 },
        ],
        clearMovementBeforeChildren: true,
      },
      expansion: { skipZeroMovement: true, skipBlocked: true, suppressBeforeTypeCheck: true, recurseGearOnly: true },
      postcondition: {
        closure: "unblockedNonzeroInputMovementGears",
        rootAlwaysProcessed: true,
        clearReachedGears: true,
        clearReachedNonGears: "onlyWhenSuppressed",
        rootStateUsesInputMovement: true,
        otherGearStateUses: "inputMovementUnlessSuppressed",
        outsideReachedPartsUnchanged: true,
      },
    });
    expect(summary.partGraph!.fields.map((f) => f.offset)).toEqual([0x20, 0x26]);
    expect(summary.partGraph!.stateCases).toHaveLength(3);
  });

  it("rejects a changed mode-two comparison instead of generalising it to exact opposition", () => {
    const { codes, discover } = fixture();
    const code = codes.get(0x100)!;
    const comparisons = code.instructions.filter(
      (i) => i.mnemonic === "cmp" && i.operands[0]?.kind === "register" && i.operands[0].name === "ax",
    );
    const compare = comparisons[1]!,
      branch = code.instructions.find((i) => i.address === compare.address + compare.size)!;
    branch.mnemonic = "je";
    expect(discover().has(0x100)).toBe(false);
  });

  it("rejects a branch that bypasses the visited mark", () => {
    const { codes, discover } = fixture();
    const code = codes.get(0x100)!;
    const mark = code.instructions.find((i) => i.mnemonic === "or" && i.operands[0]?.kind === "memory")!;
    code.edges.push({ from: code.address, to: mark.address + mark.size, kind: "jump" });
    expect(discover().has(0x100)).toBe(false);
  });

  it("rejects a suppression store that no longer clears the target movement", () => {
    const { codes, discover } = fixture();
    const code = codes.get(0x300)!;
    const store = code.instructions.find(
      (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].base.join() === "di",
    )!;
    if (store.operands[0]?.kind === "memory") store.operands[0].displacement += 2;
    expect(discover().has(0x300)).toBe(false);
  });

  it("rejects invalid, overlapping peer endpoint fields", () => {
    const { codes, discover } = fixture();
    const peer = codes.get(0x500)!;
    for (const i of peer.instructions)
      for (const operand of i.operands)
        if (operand.kind === "memory" && operand.base.join() === "si" && operand.displacement === 10)
          operand.displacement = 8;
    expect(discover().size).toBe(0);
  });

  it("retains original instruction evidence for both recursive traversals and the query", () => {
    const { codes, discover } = fixture();
    const summaries = discover();
    for (const address of [0x100, 0x300]) {
      const summary = summaries.get(address)!;
      expect(summary.evidence).toHaveLength(
        codes.get(address)!.instructions.length + codes.get(0x500)!.instructions.length,
      );
      expect(summary.evidence.every((e) => e.bytes.length > 0 && e.text.length > 0)).toBe(true);
    }
  });
});
