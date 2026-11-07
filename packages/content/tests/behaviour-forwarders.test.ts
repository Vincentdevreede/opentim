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
    /** A number the wrapper passes after the part, by `mov ax, number; push ax`. */
    passes?: number;
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
    ...(options.passes === undefined ? [] : [0xb8, options.passes & 255, options.passes >> 8, 0x50]),
    0x56,
    0x0e,
    0xe8,
    0,
    0,
    0x59,
    ...(options.passes === undefined ? [] : [0x59]),
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
  it("carries a helper's exact write with the number the wrapper passes it", () => {
    const { code, summaries, helper } = fixture({ passes: 1 });
    complete(helper);
    helper.writes[0] = {
      ...helper.writes[0]!,
      exact: true,
      condition: {
        kind: "compare",
        operator: "!=",
        left: { kind: "field", object: "part", offset: 4, width: 16 },
        right: { kind: "constant", value: 49, width: 16 },
        signed: false,
      },
    };
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    const owner = summaries.get(0)!.writes.find((write) => write.root === "argument")!;
    expect(owner).toMatchObject({ offset: 0x14, exact: true, value: { kind: "constant", value: 1, width: 8 } });
    expect(owner.condition).toMatchObject({ kind: "compare", operator: "!=" });
    // Without the number the value stays the helper's own argument, so it doesn't carry over.
    const plain = fixture();
    complete(plain.helper);
    plain.helper.writes[0] = { ...plain.helper.writes[0]!, exact: true };
    addStatePreservingForwarders(new Map([[0, plain.code]]), plain.summaries);
    expect(plain.summaries.get(0)!.writes.find((write) => write.root === "argument")!.value.kind).toBe("unknown");
  });
  /**
   * A wrapper `push bp; mov bp, sp; push si; mov si, [bp+6]; ...; pop si; pop bp; retf` around the given body. Each
   * `call` entry is `push cs; call` to the given helper, with the part and an optional number pushed before it.
   */
  const wrapper = (body: (number[] | { call: number; passes?: number })[]) => {
    const image = new Uint8Array(0x200);
    const bytes = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
    for (const item of body) {
      if (Array.isArray(item)) {
        bytes.push(...item);
        continue;
      }
      if (item.passes !== undefined) bytes.push(0xb8, item.passes & 255, item.passes >> 8, 0x50);
      bytes.push(0x56, 0x0e, 0xe8);
      const delta = item.call - (bytes.length + 2);
      bytes.push(delta & 255, (delta >> 8) & 255, 0x59, ...(item.passes === undefined ? [] : [0x59]));
    }
    image.set([...bytes, 0x5e, 0x5d, 0xcb]);
    return readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  };
  /** The helper's write of 1 to `0x14`, exactly when the part's type isn't 49. */
  const exactWrite = (helper: EngineSummary) => {
    complete(helper);
    helper.writes[0] = {
      ...helper.writes[0]!,
      exact: true,
      condition: {
        kind: "compare",
        operator: "!=",
        left: { kind: "field", object: "part", offset: 4, width: 16 },
        right: { kind: "constant", value: 49, width: 16 },
        signed: false,
      },
    };
  };
  const ownerWrite = (summaries: Map<number, EngineSummary>) =>
    summaries.get(0)!.writes.find((write) => write.root === "argument" && write.offset === 0x14)!;
  it("carries an exact write only from a call made on every way to the return", () => {
    // `if (part->flags & 0x10) helper(part, 1)`: the helper's test alone would drop the wrapper's own.
    const { summaries, helper } = fixture();
    exactWrite(helper);
    const skipped = { call: 0x100, passes: 1 };
    const code = wrapper([[0xf6, 0x44, 0x10, 0x10, 0x74, 11], skipped]);
    addStatePreservingForwarders(new Map([[0, code]]), summaries);
    expect(summaries.get(0)?.kind).toBe("state-preserving-forwarder");
    const owner = ownerWrite(summaries);
    expect(owner.exact).toBeUndefined();
    expect(owner.value.kind).toBe("unknown");
    expect(owner.condition.kind).toBe("unknown");
    // The same call made on every way carries over.
    const always = fixture();
    exactWrite(always.helper);
    addStatePreservingForwarders(new Map([[0, wrapper([skipped])]]), always.summaries);
    expect(ownerWrite(always.summaries)).toMatchObject({ exact: true, value: { kind: "constant", value: 1 } });
  });
  it("carries no exact write whose test reads a field an earlier call may write", () => {
    const { summaries, helper } = fixture();
    exactWrite(helper);
    // An earlier helper writes the part's type, which the later helper's test reads.
    const earlier: EngineSummary = structuredClone(helper);
    earlier.address = 0x140;
    earlier.writes = [{ ...helper.writes[1]!, root: "argument", argumentOffset: 6, offset: 4, width: 16 }];
    delete earlier.connected;
    summaries.set(earlier.address, earlier);
    addStatePreservingForwarders(new Map([[0, wrapper([{ call: 0x140 }, { call: 0x100, passes: 1 }])]]), summaries);
    expect(summaries.get(0)?.footprint.partMemoryComplete).toBe(true);
    expect(ownerWrite(summaries).value.kind).toBe("unknown");
    // Called after the exact one, the type write doesn't change what the test read.
    const later = fixture();
    exactWrite(later.helper);
    later.summaries.set(earlier.address, earlier);
    addStatePreservingForwarders(
      new Map([[0, wrapper([{ call: 0x100, passes: 1 }, { call: 0x140 }])]]),
      later.summaries,
    );
    expect(ownerWrite(later.summaries)).toMatchObject({ exact: true, value: { kind: "constant", value: 1 } });
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
  it("composes again when a helper's reached fields change but its writes stay the same", () => {
    const { code, summaries, helper } = fixture();
    const codes = new Map([[0, code]]);
    complete(helper);
    addStatePreservingForwarders(codes, summaries);
    // The same field, now reached as a record field through other links.
    helper.connected = { ...helper.connected!, partFields: [], recordFields: [{ offset: 0x9c, width: 16 }] };
    helper.connected.recordLinks = [0x54];
    addStatePreservingForwarders(codes, summaries, true);
    expect(summaries.get(0)?.connected).toMatchObject({
      partFields: [],
      recordFields: [{ offset: 0x9c, width: 16 }],
      recordLinks: [0x54],
    });
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
