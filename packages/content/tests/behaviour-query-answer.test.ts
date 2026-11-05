import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };

/** Asks a query about the owner, like whether its new spot is blocked, and goes to frame 2 when the answer is 0. */
function fixture(kind: EngineSummary["kind"]) {
  const image = new Uint8Array(0x140);
  // prettier-ignore
  image.set([
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; mov si,[bp+6]
    0x56, 0x9a, 0, 1, 0, 0, 0x59, // push si; call far 0:0x100; pop cx
    0x0b, 0xc0, 0x75, 5, // or ax,ax; jne done
    0xc7, 0x44, 12, 2, 0, // mov word [si+12],2
    0x5e, 0x5d, 0xcb, // done: pop si; pop bp; retf
  ]);
  image[0x100] = 0xcb;
  const query: EngineSummary = {
    ...fact,
    address: 0x100,
    argumentOffset: 6,
    argumentKind: "unknown",
    kind,
    purpose: "Reads inputs, with intermediate writes confined to its private stack frame.",
    writes: [],
    returns: [],
    calls: [],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
  return { image, helpers: new Map([[query.address, query]]) };
}

const text = (value: unknown) => JSON.stringify(value);

describe("query answers", () => {
  it("names the answer of a query that changes nothing but its own stack as one value", () => {
    const { image, helpers } = fixture("private-buffer-query");
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    const conditions = routine.transitions.map((transition) => text(transition.condition));
    expect(conditions.length).toBeGreaterThan(1);
    expect(conditions.every((condition) => condition.includes("answer of the query at 0x8"))).toBe(true);
    expect(conditions.some((condition) => condition.includes('"kind":"unknown"'))).toBe(false);
  });

  it("names the answer of the rope connection query as one value", () => {
    const { image, helpers } = fixture("connection-query");
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    const conditions = routine.transitions.map((transition) => text(transition.condition));
    expect(conditions.length).toBeGreaterThan(1);
    expect(conditions.every((condition) => condition.includes("answer of the query at 0x8"))).toBe(true);
    expect(conditions.some((condition) => condition.includes('"kind":"unknown"'))).toBe(false);
  });

  it("keeps the answer of another helper opaque", () => {
    const { image, helpers } = fixture("frame-position");
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.transitions.some((transition) => text(transition.condition).includes("answer of the query"))).toBe(
      false,
    );
  });
});
