import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { addNodePoolSummaries } from "../src/read/behaviour-node-pools.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function fixture(change: "none" | "outside" | "link-byte" | "no-clear" | "owner-link" | "local" = "none") {
  const image = new Uint8Array(0x800),
    initializer = 0x100,
    update = 0x200,
    allocate = 0x300;
  // The new node goes on the free list through DI, or as TIM 1 compiles it, through a local and BX.
  const push =
    change === "local"
      ? [0x89, 0x46, 0xf0, 0x8b, 0x5e, 0xf0, 0xa1, 0, 6, 0x89, 7, 0x8b, 0x46, 0xf0, 0xa3, 0, 6]
      : [0x8b, 0xf8, 0xa1, 0, 6, 0x89, 5, 0x89, 0x3e, 0, 6];
  image.set(
    [
      0x55,
      0x8b,
      0xec,
      0x33,
      0xc0,
      0xa3,
      0,
      6,
      0xa3,
      2,
      6,
      0xb8,
      8,
      0,
      0x50,
      0xb8,
      1,
      0,
      0x50,
      0x9a,
      0,
      3,
      0,
      0,
      0x59,
      0x59,
      ...push,
      0x5d,
      0xcb,
    ],
    initializer,
  );
  const write =
    change === "outside"
      ? [0xc7, 0x44, 12, 1, 0]
      : change === "link-byte"
        ? [0xc6, 0x44, 1, 7]
        : change === "owner-link"
          ? [0x8b, 0x56, 6, 0x89, 0x14]
          : [0xc7, 0x44, 2, 1, 0];
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x36, 0, 6, ...write, 0x5e, 0x5d, 0xcb], update);
  if (change === "no-clear") image.set([0x90, 0x90, 0x90], initializer + 5);
  const codes = new Map(
    [initializer, update].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
  const allocator: EngineSummary = {
    address: allocate,
    kind: "nullable-allocation",
    purpose: "Synthetic allocator.",
    argumentOffset: 6,
    argumentKind: "scalar",
    returnPointerClass: "nullable-fresh",
    writes: [],
    returns: [],
    calls: [],
    confidence: "inferred",
    evidence: [],
    assumptions: ["Fresh payloads are separate from live objects."],
    footprint: {
      complete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: ["Heap metadata."],
    },
  };
  const summaries = new Map([[allocate, allocator]]);
  addNodePoolSummaries(codes, summaries);
  return summaries.get(update);
}
describe("separate linked-node pools", () => {
  it("links a pool write to its allocation size and initialized head slots", () => {
    const summary = fixture()!;
    expect(summary.kind).toBe("owned-node-pool-update");
    expect(summary.footprint).toMatchObject({
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: true,
    });
    expect(summary.returns).toEqual([]);
    expect(summary.nodePool).toEqual({ nodeSize: 8 });
    expect(summary.evidence.some((i) => i.text.includes("0x0008"))).toBe(true);
    expect(summary.assumptions.join(" ")).toContain("initialization completed");
  });
  it("finds the pool when its initializer keeps the new node in a local", () => {
    expect(fixture("local")).toMatchObject({ kind: "owned-node-pool-update", nodePool: { nodeSize: 8 } });
  });
  it.each(["outside", "link-byte", "no-clear", "owner-link"] as const)(
    "rejects %s instead of assuming pool ownership",
    (change) => {
      expect(fixture(change)).toBeUndefined();
    },
  );
});

/** Calls a pool update about the owner and goes to frame 2 when it answers 0; it may first write through a link. */
function caller(nodePool: boolean, writeThroughLink = false) {
  const image = new Uint8Array(0x140);
  // prettier-ignore
  image.set([
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; mov si,[bp+6]
    ...(writeThroughLink ? [0x8b, 0x5c, 0x20, 0xc7, 0x47, 2, 5, 0] : []), // mov bx,[si+0x20]; mov word [bx+2],5
    0x56, 0x9a, 0, 1, 0, 0, 0x59, // push si; call far 0:0x100; pop cx
    0x0b, 0xc0, 0x75, 5, // or ax,ax; jne done
    0xc7, 0x44, 12, 2, 0, // mov word [si+12],2
    0x5e, 0x5d, 0xcb, // done: pop si; pop bp; retf
  ]);
  image[0x100] = 0xcb;
  const update: EngineSummary = {
    address: 0x100,
    kind: "owned-node-pool-update",
    purpose: "Synthetic pool update.",
    argumentOffset: 6,
    argumentKind: "unknown",
    writes: [],
    returns: [],
    calls: [],
    ...(nodePool ? { nodePool: { nodeSize: 8 } } : {}),
    confidence: "inferred",
    evidence: [],
    assumptions: [],
    footprint: {
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: ["Pool nodes."],
      unknownGlobalEffects: ["Pool heads."],
    },
  };
  return analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    {
      engineSummaries: new Map([[update.address, update]]),
      stateCount: 4,
    },
  );
}
describe("callers of a pool update", () => {
  it("keep their own fields and name the update's answer as one value", () => {
    const routine = caller(true);
    expect(routine.uncertainEffects).toBe(false);
    expect(routine.outcomes?.every((outcome) => outcome.effectsComplete)).toBe(true);
    const conditions = routine.transitions.map((transition) => JSON.stringify(transition.condition));
    expect(conditions.length).toBeGreaterThan(1);
    expect(conditions.every((condition) => condition.includes("answer of the query at 0x"))).toBe(true);
  });
  it("lose them when the update's node size is unknown", () => {
    expect(caller(false).uncertainEffects).toBe(true);
  });
  it("lose them when they wrote a field a node could hold before the call", () => {
    expect(caller(true, true).outcomes?.some((outcome) => !outcome.effectsComplete)).toBe(true);
  });
});
