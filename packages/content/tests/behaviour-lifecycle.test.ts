import { describe, expect, it } from "vitest";
import { discoverBehaviourLifecycle, discoverLifecycleFieldRoles } from "../src/read/behaviour-lifecycle.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

function fixture(state = 0x28, saved = 0x72, mode: "plain" | "conditional" | "changedObject" = "plain") {
  const image = new Uint8Array(0x1000).fill(0x66);
  image.set([0xb8, 0, 1, 0x8e, 0xd8], 0);
  image.set([0x9a, 0, 1, 0, 0], 0x20);
  const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
  const restore = [0x8b, 0x44, saved, 0x89, 0x44, state];
  const dispatch = [
    0x56, 0x8b, 0x44, 4, 0xba, 58, 0, 0xf7, 0xea, 0xba, 0x80, 0, 0x8b, 0xd8, 0x8e, 0xc2, 0x26, 0xff, 0x9f, 0x2a, 0,
  ];
  image.set(
    [
      ...prologue,
      ...(mode === "conditional" ? [0x85, 0xc0, 0x74, restore.length] : []),
      ...restore,
      0x33,
      0xc0,
      0x89,
      0x84,
      0xa4,
      0,
      0x89,
      0x84,
      0xa6,
      0,
      ...(mode === "changedObject" ? [0x8b, 0xf7] : []),
      ...dispatch,
      0x5e,
      0x5d,
      0xcb,
    ],
    0x100,
  );
  image.set(
    [
      ...prologue,
      0x8b,
      0x44,
      state + 2,
      0x89,
      0x44,
      state + 4,
      0x8b,
      0x44,
      state,
      0x89,
      0x44,
      state + 2,
      0x5e,
      0x5d,
      0xcb,
    ],
    0x300,
  );
  const code = readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0x100);
  const history = readRoutineCode(image, { address: 0x300, segment: 0, offset: 0x300 }, 0x100);
  const site = code.instructions.find((instruction) => instruction.flow === "call")!.address;
  const fact = { confidence: "checked" as const, evidence: [], assumptions: [] };
  const layout: BehaviourLayout = {
    callbacks: [{ field: 0x2a, role: "reset", sites: [site], ...fact }],
    fields: [
      { name: "state", offset: state, ...fact },
      { name: "type", offset: 4, ...fact },
      { name: "contextCounter", offset: 0xa4, ...fact },
      {
        name: "previousState",
        offset: state + 2,
        ...fact,
        evidence: history.instructions
          .filter(
            (instruction) =>
              instruction.mnemonic === "mov" &&
              instruction.operands[1]?.kind === "memory" &&
              instruction.operands[1].displacement === state,
          )
          .map(({ address, bytes, text }) => ({ address, bytes, text })),
      },
    ],
    objectArgument: { offset: 6, ...fact },
    diagnostics: [],
  };
  return {
    image,
    code,
    history,
    layout,
    codes: new Map([
      [code.address, code],
      [history.address, history],
    ]),
  };
}

describe("engine lifecycle facts", () => {
  it.each([
    [0x28, 0x72],
    [0x3a, 0x6c],
  ])("derives stored-state restoration and counter clears at moved offsets %s", (state, saved) => {
    const { image, codes, layout } = fixture(state, saved);
    const lifecycle = discoverBehaviourLifecycle(image, codes, layout);
    expect(lifecycle.reset).toHaveLength(1);
    expect(lifecycle.reset[0]).toMatchObject({
      context: "level reset",
      stateSource: saved,
      condition: { kind: "unknown" },
    });
    expect(lifecycle.reset[0]!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offset: state, value: { kind: "field", object: "part", offset: saved, width: 16 } }),
        expect.objectContaining({ offset: 0xa4, value: { kind: "constant", value: 0, width: 16 } }),
        expect.objectContaining({ offset: 0xa6, value: { kind: "constant", value: 0, width: 16 } }),
      ]),
    );
    expect(lifecycle.reset[0]!.assumptions.join(" ")).toContain("not an assumed zero");
  });

  it("rejects a state restoration that does not dominate the reset dispatch", () => {
    const { image, codes, layout } = fixture(0x28, 0x72, "conditional");
    expect(discoverBehaviourLifecycle(image, codes, layout).reset).toEqual([]);
  });

  it("rejects writes to an object register reassigned before the reset dispatch", () => {
    const { image, codes, layout } = fixture(0x28, 0x72, "changedObject");
    expect(discoverBehaviourLifecycle(image, codes, layout).reset).toEqual([]);
  });

  it("retains unconditional paired state history writes without assigning them a cycle rate", () => {
    const { image, codes, layout } = fixture();
    const history = discoverBehaviourLifecycle(image, codes, layout).history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ routine: 0x300, context: "history update", condition: { kind: "true" } });
    expect(history[0]!.fields).toMatchObject([
      { offset: 0x2c, value: { kind: "field", offset: 0x2a } },
      { offset: 0x2a, value: { kind: "field", offset: 0x28 } },
    ]);
    expect(history[0]!.assumptions.join(" ")).toContain("frequency");
  });

  it("can discover an engine context absent from the callback call graph through a far reference", () => {
    const { image, history, layout } = fixture();
    const result = discoverBehaviourLifecycle(image, new Map([[history.address, history]]), layout);
    expect(result.reset[0]?.routine).toBe(0x100);
    expect(result.reset[0]?.stateSource).toBe(0x72);
  });
});

describe("saved level field names", () => {
  it.each([
    [0x28, 0x72],
    [0x3a, 0x6c],
  ])("names stored state at the discovered offset %s", (state, saved) => {
    const { image, codes, layout } = fixture(state, saved);
    const lifecycle = discoverBehaviourLifecycle(image, codes, layout);
    const roles = discoverLifecycleFieldRoles(lifecycle, layout);
    expect(roles).toContainEqual(
      expect.objectContaining({ name: "savedState", offset: saved, confidence: "inferred" }),
    );
    expect(roles[0]!.evidence.length).toBeGreaterThan(0);
    expect(roles[0]!.assumptions.join(" ")).toContain("not a numeric default");
  });

  it("keeps the state saved after the callback distinct from the restored input", () => {
    const { image, code, history, layout } = fixture();
    const dispatch = code.instructions.find((instruction) => instruction.flow === "call")!;
    image.set([0x8b, 0x44, 0x28, 0x89, 0x44, 0x72, 0x5e, 0x5d, 0xcb], dispatch.address + dispatch.size);
    const updated = readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0x100);
    const result = discoverBehaviourLifecycle(
      image,
      new Map([
        [updated.address, updated],
        [history.address, history],
      ]),
      layout,
    );
    expect(result.reset[0]!.writesAfterCallback).toMatchObject([
      { offset: 0x72, value: { kind: "field", offset: 0x28 } },
    ]);
  });

  it("does not name a stored field from a restoration on only one branch", () => {
    const { image, codes, layout } = fixture(0x28, 0x72, "conditional");
    expect(discoverLifecycleFieldRoles(discoverBehaviourLifecycle(image, codes, layout), layout)).toEqual([]);
  });
});
