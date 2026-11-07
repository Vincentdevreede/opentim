import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };

/**
 * When the owner's field 0x40 is nonzero, the routine calls a helper that keeps the part's state but has no complete
 * footprint of its other fields; otherwise it stores 5 in field 0x30. Both ways keep the state.
 */
function analyse() {
  const image = new Uint8Array(0x100);
  // prettier-ignore
  image.set([
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; mov si,[bp+6]
    0x83, 0x7c, 0x40, 0, 0x74, 9, // cmp word [si+0x40],0; je store
    0x56, 0x9a, 0x80, 0, 0, 0, 0x59, 0xeb, 5, // push si; call far 0:0x80; pop cx; jmp end
    0xc7, 0x44, 0x30, 5, 0, // store: mov word [si+0x30],5
    0x5e, 0x5d, 0xcb, // end: pop si; pop bp; retf
  ]);
  image[0x80] = 0xcb;
  const helper: EngineSummary = {
    ...fact,
    address: 0x80,
    kind: "scoped-state-update",
    purpose: "Keeps the part's state; its other effects are not followed.",
    argumentOffset: 6,
    argumentKind: "object",
    returnConvention: { kind: "far", stackBytes: 0 },
    writes: [],
    returns: [],
    calls: [],
    footprint: {
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: ["Other part fields may change."],
      unknownPartEffects: ["Other part fields may change."],
    },
  };
  return analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    { engineSummaries: new Map([[0x80, helper]]), stateCount: 4 },
  );
}

describe("merging rules whose effects are incomplete", () => {
  it("keeps a rule apart when a field it leaves out may have changed on its path", () => {
    const routine = analyse();
    const kept = routine.transitions.filter((t) => t.to.kind === "field" && t.to.object === "part");
    // Merged, the rule would say field 0x30 keeps its old value when the helper ran, which the helper may change.
    expect(kept).toHaveLength(2);
    const helped = kept.find((t) => t.effectsIncomplete)!;
    expect(helped.updates?.some((u) => u.offset === 0x30)).toBe(false);
    const stored = kept.find((t) => !t.effectsIncomplete)!;
    expect(stored.updates?.find((u) => u.offset === 0x30)?.value).toMatchObject({ kind: "constant", value: 5 });
  });
});
