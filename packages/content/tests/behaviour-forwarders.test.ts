import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { addStatePreservingForwarders } from "../src/read/behaviour-forwarders.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function fixture(
  options: {
    changedOwner?: boolean;
    changedFrame?: boolean;
    wrongReturn?: boolean;
    unbalanced?: boolean;
    bypass?: boolean;
  } = {},
) {
  const image = new Uint8Array(0x200);
  image.set([
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    ...(options.changedOwner ? [0x46] : []),
    ...(options.changedFrame ? [0x45] : []),
    ...(options.unbalanced ? [0x58, 0x58, 0x58] : []),
    0x56,
    0x0e,
    0xe8,
    0,
    0,
    0x59,
    0x5e,
    0x5d,
    0xcb,
  ]);
  const call = image.indexOf(0xe8),
    delta = 0x100 - call - 3;
  image[call + 1] = delta & 255;
  image[call + 2] = delta >> 8;
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  if (options.bypass) code.edges.push({ from: 0, to: call - 2, kind: "jump" });
  const helper: EngineSummary = {
    address: 0x100,
    kind: "scoped-state-update",
    purpose: "Updates nonstate fields.",
    argumentOffset: options.wrongReturn ? 4 : 6,
    argumentKind: "object",
    returnConvention: { kind: options.wrongReturn ? "near" : "far", stackBytes: 0 },
    writes: [],
    returns: [],
    calls: [],
    confidence: "inferred",
    evidence: [],
    assumptions: ["The helper's graph nodes are complete parts."],
    footprint: {
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: ["Connected status storage remains unresolved."],
      unknownPartEffects: ["Connected storage may change."],
      unknownGlobalEffects: ["Resource globals may change."],
    },
  };
  return { code, helper, summaries: new Map([[helper.address, helper]]) };
}

describe("state-preserving forwarding wrappers", () => {
  it("composes the forwarded owner's state contract while retaining all other unknown effects", () => {
    const { code, summaries } = fixture();
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    const wrapper = summaries.get(0);
    expect(wrapper?.kind).toBe("state-preserving-forwarder");
    expect(wrapper?.footprint).toMatchObject({
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: true,
    });
    expect(wrapper?.footprint.unknownPartEffects?.length).toBeGreaterThan(0);
    expect(wrapper?.footprint.unknownGlobalEffects).toContain("Resource globals may change.");
    expect(wrapper?.returns).toEqual([]);
    expect(wrapper?.evidence.some((i) => i.text.startsWith("call"))).toBe(true);
  });
  it.each([
    { changedOwner: true },
    { changedFrame: true },
    { wrongReturn: true },
    { unbalanced: true },
    { bypass: true },
  ])("rejects an unproved forwarding identity or stack convention %s", (options) => {
    const { code, summaries } = fixture(options);
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    expect(summaries.has(0)).toBe(false);
  });
  it("invalidates globals even when the callee records its global writes precisely", () => {
    const { code, summaries, helper } = fixture();
    helper.footprint.unknownGlobalEffects = [];
    helper.writes.push({
      root: "global",
      path: [],
      offset: 0x20,
      width: 16,
      value: { kind: "constant", value: 1, width: 16 },
      condition: { kind: "true" },
      confidence: "checked",
      evidence: [],
      assumptions: [],
    });
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    expect(summaries.get(0)?.footprint.unknownGlobalEffects?.length).toBeGreaterThan(0);
  });
  it("does not assume that an unresolved callee preserves state", () => {
    const { code, summaries, helper } = fixture();
    helper.footprint.preservesPartState = false;
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    expect(summaries.has(0)).toBe(false);
  });

  const complete = (helper: EngineSummary) => {
    helper.footprint = {
      complete: false,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: ["A notification may queue rectangles."],
      unknownPartEffects: [],
      unknownGlobalEffects: ["A notification may queue rectangles."],
    };
    helper.writes = [
      {
        root: "argument",
        argumentOffset: 6,
        path: [],
        offset: 0x14,
        width: 8,
        value: { kind: "field", object: "argument", offset: 8, width: 8 },
        condition: { kind: "true" },
        confidence: "inferred",
        evidence: [],
        assumptions: [],
      },
      {
        root: "unknown",
        path: [],
        offset: 0x9c,
        width: 16,
        value: { kind: "unknown", reason: "A connected part.", width: 16 },
        condition: { kind: "true" },
        confidence: "inferred",
        evidence: [],
        assumptions: [],
      },
    ];
    helper.connected = {
      confidence: "inferred",
      evidence: [],
      assumptions: [],
      partFields: [{ offset: 0x9c, width: 16 }],
      recordFields: [],
      recordLinks: [0x54, 0x66, 0x68],
    };
  };
  it("writes the union of its helpers' footprints when each is complete", () => {
    const { code, summaries, helper } = fixture();
    complete(helper);
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    const wrapper = summaries.get(0)!;
    expect(wrapper.footprint).toMatchObject({
      partMemoryComplete: true,
      preservesPartState: true,
      unknownPartEffects: [],
    });
    expect(wrapper.footprint.unknownGlobalEffects).toContain("A notification may queue rectangles.");
    expect(wrapper.connected?.partFields).toEqual([{ offset: 0x9c, width: 16 }]);
    // The helper's byte comes from its own argument, not the wrapper's, so only where it writes carries over.
    const owner = wrapper.writes.find((write) => write.root === "argument")!;
    expect(owner).toMatchObject({ offset: 0x14, width: 8, argumentOffset: 6, path: [] });
    expect(owner.value.kind).toBe("unknown");
    expect(owner.condition.kind).toBe("unknown");
  });
  it("composes again once a later proof completes a helper's footprint", () => {
    const { code, summaries, helper } = fixture();
    const codes = new Map([[0, code]]);
    addStatePreservingForwarders(codes, summaries);
    expect(summaries.get(0)?.footprint.partMemoryComplete).toBe(false);
    complete(helper);
    addStatePreservingForwarders(codes, summaries, true);
    expect(summaries.get(0)?.footprint.partMemoryComplete).toBe(true);
  });
  it("proves no new wrapper when composing again", () => {
    const { code, summaries } = fixture();
    addStatePreservingForwarders(new Map([[0, code]]), summaries, true);
    expect(summaries.has(0)).toBe(false);
  });
  it.each([
    ["a write through another argument", (h: EngineSummary) => (h.writes[0]!.argumentOffset = 8)],
    ["a write to an unnamed object", (h: EngineSummary) => (h.connected!.partFields = [])],
    ["a selected object", (h: EngineSummary) => (h.writes[1]!.selection = "overlap-candidate")],
    ["a node pool", (h: EngineSummary) => (h.nodePool = { nodeSize: 4 })],
  ])("keeps the state-only contract for a helper with %s", (_, change) => {
    const { code, summaries, helper } = fixture();
    complete(helper);
    change(helper);
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    expect(summaries.get(0)?.footprint.partMemoryComplete).toBe(false);
    expect(summaries.get(0)?.writes).toEqual([]);
  });
});
