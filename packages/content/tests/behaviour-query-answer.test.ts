import { describe, expect, it } from "vitest";
import { analyseRoutine, choiceOf, transitionCounts } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };

/** Asks a query about the owner, like whether its new spot is blocked, and goes to frame 2 when the answer is 0. */
function fixture(kind: EngineSummary["kind"], field = 12, before: number[] = []) {
  const image = new Uint8Array(0x140);
  // prettier-ignore
  image.set([
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; mov si,[bp+6]
    ...before,
    0x56, 0x9a, 0, 1, 0, 0, 0x59, // push si; call far 0:0x100; pop cx
    0x0b, 0xc0, 0x75, 5, // or ax,ax; jne done
    0xc7, 0x44, field, 2, 0, // mov word [si+field],2
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

  it("settles the state path when both answers lead to the same frame", () => {
    // The answer only decides a write to field 0x12; the frame stays the same either way.
    const { image, helpers } = fixture("private-buffer-query", 0x12);
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.transitions).toHaveLength(1);
    const [transition] = routine.transitions;
    expect(transition!.confidence).toBe("inferred");
    expect(text(transition!.condition)).not.toContain("answer of the query");
    // Field 0x12 is 2 when the answer is 0 and keeps its value otherwise: the answer picks one of the two.
    const write = transition!.updates?.find((update) => update.offset === 0x12);
    const choice = choiceOf(write!.value);
    expect(choice?.test).toMatchObject({ left: { object: "answer of the query at 0x8" }, right: { value: 0 } });
    const [zero, other] =
      choice!.test.operator === "==" ? [choice!.then, choice!.otherwise] : [choice!.otherwise, choice!.then];
    expect(choice!.test.operator).toMatch(/^[!=]=$/);
    expect(zero).toMatchObject({ kind: "constant", value: 2 });
    expect(other).toMatchObject({ kind: "field", object: "part", offset: 0x12 });
  });

  it("keeps the merged path unresolved when the routine lost track of an effect", () => {
    // AAA is not followed symbolically, so a path may have changed something the analysis can't see.
    const { image, helpers } = fixture("private-buffer-query", 0x12, [0x37]);
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.uncertainEffects).toBe(true);
    expect(routine.transitions.every((transition) => transition.confidence === "unresolved")).toBe(true);
  });

  it("counts a rule that tests only the answer as conditional", () => {
    const { image, helpers } = fixture("private-buffer-query");
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.transitions.length).toBeGreaterThan(1);
    // The walks still branch on the answer, so the rule keeps its confidence and names the value it tests.
    expect(routine.transitions.every((t) => t.confidence === "unresolved")).toBe(true);
    expect(routine.transitions.every((t) => text(t.runValues) === text(["answer of the query at 0x8"]))).toBe(true);
    expect(transitionCounts(routine.transitions)).toEqual({
      unresolved: 0,
      conditional: routine.transitions.length,
      unknownWrites: 0,
    });
  });

  it("keeps a rule unresolved when it tests an opaque value or its routine lost an effect", () => {
    const opaque = fixture("frame-position");
    const opaqueRoutine = analyseRoutine(opaque.image, entry, { engineSummaries: opaque.helpers, stateCount: 4 });
    expect(opaqueRoutine.transitions.some((t) => t.confidence === "unresolved")).toBe(true);
    expect(opaqueRoutine.transitions.some((t) => t.runValues)).toBe(false);
    const lost = fixture("private-buffer-query", 12, [0x37]);
    const lostRoutine = analyseRoutine(lost.image, entry, { engineSummaries: lost.helpers, stateCount: 4 });
    expect(lostRoutine.transitions.some((t) => t.runValues)).toBe(false);
    expect(transitionCounts(lostRoutine.transitions).unresolved).toBe(lostRoutine.transitions.length);
  });

  it("counts rules that write an unknown value apart, like a value the answer picks", () => {
    const { image, helpers } = fixture("private-buffer-query", 0x12);
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(transitionCounts(routine.transitions)).toEqual({ unresolved: 0, conditional: 0, unknownWrites: 1 });
  });
});
