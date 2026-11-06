import { describe, expect, it } from "vitest";
import { analyseRoutine, type Finding } from "../src/read/behaviour.ts";
import { discoverEngineSummaries, type EngineSummary } from "../src/read/behaviour-helpers.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const fact: Finding = {
  confidence: "inferred",
  assumptions: ["The synthetic service owns separate storage."],
  evidence: [],
};
const entry = { address: 0, segment: 0, offset: 0 };
const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
function service(address: number): EngineSummary {
  return {
    ...fact,
    address,
    kind: "scalar-resource-service",
    purpose: "Requests a resource by identifier.",
    argumentOffset: 6,
    argumentKind: "scalar",
    writes: [],
    returns: [],
    calls: [],
    footprint: {
      complete: false,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: ["The backend has separate resource effects."],
      unknownPartEffects: [],
      unknownGlobalEffects: ["The backend has separate resource effects."],
    },
  };
}

describe("shared symbolic call summaries", () => {
  it("wraps negative pointer displacements with 16-bit effective addresses", () => {
    const image = Uint8Array.from([
      ...prologue,
      0x8b,
      0xfe,
      0x83,
      0xc7,
      0xfc,
      0xc7,
      0x45,
      0x10,
      1,
      0,
      0x5e,
      0x5d,
      0xcb,
    ]);
    const result = analyseRoutine(image, entry);
    expect(result.writes[0]).toMatchObject({ object: "part", offset: 12, value: { kind: "constant", value: 1 } });
  });

  it("invalidates a cached state after a store through an untracked pointer", () => {
    const result = analyseRoutine(
      Uint8Array.from([...prologue, 0xc7, 0x44, 0x0c, 1, 0, 0x8b, 0xf8, 0xc7, 0x45, 6, 2, 0, 0x5e, 0x5d, 0xcb]),
      entry,
    );
    expect(result.transitions[0]?.to.kind).toBe("unknown");
    expect(result.outcomes?.[0]?.effectsComplete).toBe(false);
  });

  it("rejects a scalar service contract when the caller passes an object pointer", () => {
    const image = new Uint8Array(0x80).fill(0x66);
    image.set([...prologue, 0x56, 0x9a, 0x60, 0, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
    image.set([0xcb], 0x60);
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x60, service(0x60)]]) });
    expect(result.transitions[0]?.confidence).toBe("unresolved");
    expect(result.engineCalls).toHaveLength(0);
  });

  it("preserves the state across a proved separate scalar service and retains its assumptions", () => {
    const image = new Uint8Array(0x80).fill(0x66);
    image.set([...prologue, 0xff, 0x44, 0x0c, 0xb8, 3, 0, 0x50, 0x9a, 0x60, 0, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
    image.set([0xcb], 0x60);
    const result = analyseRoutine(image, entry, { stateCount: 5, engineSummaries: new Map([[0x60, service(0x60)]]) });
    expect(result.transitions[0]?.to).toMatchObject({ kind: "binary", operator: "+" });
    expect(result.transitions[0]?.confidence).toBe("inferred");
    expect(result.transitions[0]?.assumptions).toContain("The synthetic service owns separate storage.");
    expect(result.engineCalls).toHaveLength(1);
    expect(result.uncertainties.some((value) => value.includes("Effects of call"))).toBe(false);
  });

  it("does not treat an unproved service as preserving the state", () => {
    const image = new Uint8Array(0x80).fill(0x66);
    image.set([...prologue, 0x9a, 0x60, 0, 0, 0, 0x5e, 0x5d, 0xcb]);
    image.set([0xcb], 0x60);
    const unknown = service(0x60);
    unknown.footprint.preservesArgumentMemory = false;
    unknown.footprint.preservesPartState = false;
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x60, unknown]]) });
    expect(result.transitions[0]?.confidence).toBe("unresolved");
    expect(result.transitions[0]?.to.kind).toBe("unknown");
  });

  it("tracks the callback owner through the collider's discovered contact link", () => {
    const result = analyseRoutine(
      Uint8Array.from([...prologue, 0x8b, 0x7c, 0x64, 0xc7, 0x45, 0x12, 1, 0, 0x5e, 0x5d, 0xcb]),
      entry,
      { objectArgument: "collider", ownerLink: 0x64 },
    );
    expect(result.writes.find((write) => write.offset === 0x12)).toMatchObject({
      object: "part",
      value: { kind: "constant", value: 1 },
    });
  });

  it("splits a bounce on the tests of a helper's exact stores to the part that touched it, like the gear's push", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    // push 0x1000; push si; call far 0x60; pop cx; pop cx
    image.set([...prologue, 0x68, 0, 0x10, 0x56, 0x9a, 0x60, 0, 0, 0, 0x59, 0x59, 0x5e, 0x5d, 0xcb]);
    // velocityX -= s; if (velocityX < s) velocityX = -s
    const push = [0x8b, 0x56, 8, 0x29, 0x54, 0x36, 0x8b, 0x44, 0x36, 0x3b, 0xc2, 0x7d, 7, 0x33, 0xc0, 0x2b, 0xc2];
    image.set([...prologue, ...push, 0x89, 0x44, 0x36, 0x5e, 0x5d, 0xcb], 0x60);
    const layout: BehaviourLayout = {
      callbacks: [],
      objectArgument: { offset: 6, confidence: "inferred", evidence: [], assumptions: [] },
      diagnostics: [],
      fields: [
        { name: "state", offset: 0x0c, confidence: "checked", evidence: [], assumptions: [] },
        { name: "type", offset: 4, confidence: "checked", evidence: [], assumptions: [] },
      ],
    };
    const code = readRoutineCode(image, { address: 0x60, segment: 0, offset: 0x60 }, 0x40);
    const summaries = discoverEngineSummaries(image, new Map([[0x60, code]]), layout);
    const result = analyseRoutine(image, entry, {
      objectArgument: "collider",
      ownerLink: 0x84,
      engineSummaries: new Map(summaries.map((summary) => [summary.address, summary])),
    });
    const velocity = { kind: "field", object: "collider", offset: 0x36, width: 16 };
    expect(
      result.outcomes
        ?.map((outcome) => outcome.fields.map((f) => [f.object, f.offset, f.value.kind, f.value]))
        .sort((a, b) => String(a[0]?.[2]).localeCompare(String(b[0]?.[2]))),
    ).toEqual([
      [["collider", 0x36, "binary", expect.objectContaining({ left: velocity })]],
      [["collider", 0x36, "constant", { kind: "constant", value: 0xf000, width: 16 }]],
    ]);
    expect(result.outcomes?.every((outcome) => outcome.effectsComplete)).toBe(true);
  });

  it("keeps a related pointer after displacement arithmetic", () => {
    const result = analyseRoutine(
      Uint8Array.from([...prologue, 0x8b, 0x7c, 0x54, 0x83, 0xc7, 4, 0xc7, 0x45, 2, 1, 0, 0x5e, 0x5d, 0xcb]),
      entry,
    );
    expect(result.writes[0]).toMatchObject({ object: "referenced-by(part+0x54)", offset: 6 });
    expect(result.uncertainties.some((value) => value.includes("pointer is lost"))).toBe(false);
  });

  it("composes a conditional callee's final state with the caller", () => {
    const image = new Uint8Array(0x90).fill(0x66);
    image.set([...prologue, 0x56, 0x9a, 0x40, 0, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
    image.set(
      [...prologue, 0xff, 0x44, 0x0c, 0x83, 0x7c, 0x0c, 4, 0x7c, 5, 0xc7, 0x44, 0x0c, 0, 0, 0x5e, 0x5d, 0xcb],
      0x40,
    );
    const callee = analyseRoutine(image, { address: 0x40, segment: 0, offset: 0x40 });
    const result = analyseRoutine(image, entry, { stateCount: 4, summaries: new Map([[0x40, callee]]) });
    expect(result.transitions.find((t) => t.to.kind === "constant" && t.to.value === 0)?.from).toEqual([3]);
    expect(result.transitions.find((t) => t.to.kind === "binary")?.from).toEqual([0, 1, 2]);
    expect(result.transitions.every((t) => t.confidence === "inferred")).toBe(true);
  });
});
