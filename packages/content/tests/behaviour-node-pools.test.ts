import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { addNodePoolSummaries } from "../src/read/behaviour-node-pools.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

function fixture(change: "none" | "outside" | "link-byte" | "no-clear" | "owner-link" = "none") {
  const image = new Uint8Array(0x800),
    initializer = 0x100,
    update = 0x200,
    allocate = 0x300;
  image.set(
    [
      0x55, 0x8b, 0xec, 0x33, 0xc0, 0xa3, 0, 6, 0xa3, 2, 6, 0xb8, 8, 0, 0x50, 0xb8, 1, 0, 0x50, 0x9a, 0, 3, 0, 0, 0x59,
      0x59, 0x8b, 0xf8, 0xa1, 0, 6, 0x89, 5, 0x89, 0x3e, 0, 6, 0x5d, 0xcb,
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
    expect(summary.evidence.some((i) => i.text.includes("0x0008"))).toBe(true);
    expect(summary.assumptions.join(" ")).toContain("initialization completed");
  });
  it.each(["outside", "link-byte", "no-clear", "owner-link"] as const)(
    "rejects %s instead of assuming pool ownership",
    (change) => {
      expect(fixture(change)).toBeUndefined();
    },
  );
});
