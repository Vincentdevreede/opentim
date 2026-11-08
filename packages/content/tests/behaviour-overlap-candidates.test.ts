import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
function query(): EngineSummary {
  return {
    ...fact,
    address: 0x100,
    kind: "overlap-list",
    purpose: "Selects candidates and builds an overlap list.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    list: { ...fact, headField: 0x60, nextField: 0x60, excludesArgument: false },
    writes: [
      {
        ...fact,
        root: "argument",
        path: [],
        offset: 0x60,
        width: 16,
        value: { kind: "unknown", reason: "The final selected head is unresolved.", width: 16 },
        condition: { kind: "true" },
      },
      {
        ...fact,
        root: "unknown",
        selection: "overlap-candidate",
        path: [],
        offset: 0x60,
        width: 16,
        value: { kind: "unknown", reason: "A selected candidate receives the previously built head.", width: 16 },
        condition: { kind: "unknown", reason: "The candidate passes the query's coordinate and exclusion gates." },
      },
    ],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}
const call = [0x56, 0x9a, 0, 1, 0, 0, 0x59];
function analyse(body: number[], summary = query()) {
  const image = new Uint8Array(0x120);
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...body, 0x5e, 0x5d, 0xcb]);
  image[0x100] = 0xcb;
  return analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { engineSummaries: new Map([[0x100, summary]]) });
}

describe("selected overlap candidates", () => {
  it("does not dereference an incoming null head and retains conditional candidate writes", () => {
    const result = analyse([0xc7, 0x44, 0x60, 0, 0, ...call, 0xc7, 0x44, 12, 1, 0]);
    expect(result.uncertainties.some((s) => s.includes("pointer is lost"))).toBe(false);
    const effects = result.writes.filter((w) => w.object.includes("candidate selected by the overlap query"));
    expect(effects.length).toBeGreaterThan(0);
    expect(
      effects.every(
        (w) => w.confidence === "unresolved" && JSON.stringify(w.condition).includes("coordinate and exclusion gates"),
      ),
    ).toBe(true);
    expect(result.uncertainEffects).toBe(false);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 1)).toBe(true);
  });
  it("does not keep cached unrelated nonstate fields from an incomplete footprint", () => {
    const summary = query();
    summary.footprint.partMemoryComplete = false;
    const result = analyse([0xc7, 0x44, 0x70, 7, 0, ...call, 0x8b, 0x44, 0x70, 0x89, 0x44, 12], summary);
    expect(result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved)).toBe(true);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(false);
  });
  it("retains fields outside a complete selected-candidate footprint", () => {
    const result = analyse([0xc7, 0x44, 0x70, 7, 0, ...call, 0x8b, 0x44, 0x70, 0x89, 0x44, 12]);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(true);
  });
  it("invalidates overlapping cached and uncached candidate fields after each query", () => {
    const result = analyse([0xc7, 0x44, 0x60, 7, 0, ...call, 0x8a, 0x44, 0x61, 0x30, 0xe4, 0x89, 0x44, 12]);
    expect(result.transitions.every((t) => t.confidence === "unresolved")).toBe(true);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 0)).toBe(false);
  });
  it("keeps an actual dereference of a null argument link unresolved", () => {
    const summary = query();
    summary.writes[1] = { ...summary.writes[1]!, selection: undefined, root: "argument", path: [0x60] };
    // Only the old incoming head is read by this ordinary path; it is not a selected-candidate contract.
    summary.writes = [summary.writes[1]!];
    const result = analyse([0xc7, 0x44, 0x60, 0, 0, ...call], summary);
    expect(result.uncertainties.some((s) => s.includes("pointer is lost"))).toBe(true);
  });
  it("names the found list a checked query leaves and what it writes in the parts it finds", () => {
    const named = (excludesArgument: boolean) => {
      const summary = query();
      summary.list = { ...summary.list!, excludesArgument, confidence: "checked" };
      summary.writes = [
        { ...summary.writes[0]!, value: { kind: "constant", value: 0, width: 16 } },
        { ...summary.writes[0]!, condition: { kind: "unknown", reason: "A part passes the gates." } },
        summary.writes[1]!,
        { ...summary.writes[1]!, offset: 0x7a },
      ];
      const result = analyse(call, summary);
      const owner = result.outcomes![0]!.fields.find((f) => f.object === "part" && f.offset === 0x60)!.value;
      const found = (offset: number) =>
        result.writes.find((w) => w.object.startsWith("a candidate selected") && w.offset === offset)!.value;
      return { owner, next: found(0x60), value: found(0x7a) };
    };
    for (const excludesArgument of [true, false]) {
      // The head is the part found last, or 0, whether or not the query may list the part that asks.
      const { owner, next, value } = named(excludesArgument);
      expect(owner).toMatchObject({ kind: "field", object: "found list after the query at 0x8", unresolved: true });
      expect(next).toMatchObject({ kind: "field", object: "next in the found list of the query at 0x8", offset: 0x60 });
      expect(value).toMatchObject({
        kind: "field",
        object: "value the query at 0x8 writes to a found part",
        offset: 0x7a,
      });
    }
  });
  it("names the overlap the query stores in a found part, when the routine reads it from that part", () => {
    const summary = query();
    summary.list = { ...summary.list!, excludesArgument: true, confidence: "checked" };
    summary.writes = [...summary.writes, { ...summary.writes[1]!, offset: 0x7a }];
    // After the query: take the first part found and copy its field 0x7a to the owner's 0x12.
    const result = analyse([...call, 0x8b, 0x7c, 0x60, 0x8b, 0x45, 0x7a, 0x89, 0x44, 0x12], summary);
    const copied = result.writes.find((w) => w.object === "part" && w.offset === 0x12)!.value;
    expect(copied).toMatchObject({ kind: "field", offset: 0x7a, unresolved: true });
    expect((copied as { object: string }).object).toMatch(/^overlap the query at 0x8 found for /);
  });

  it("keeps the owner's fields when the query skips the part that asks", () => {
    const skipping = (excludesArgument: boolean) => {
      const summary = query();
      summary.list = { ...summary.list!, excludesArgument };
      summary.writes.push({ ...summary.writes[1]!, offset: 0x7a });
      return summary;
    };
    // The owner writes 7 to its own field 0x7a, asks, then copies that field to its state.
    const body = [0xc7, 0x44, 0x7a, 7, 0, ...call, 0x8b, 0x44, 0x7a, 0x89, 0x44, 12];
    const kept = analyse(body, skipping(true));
    expect(kept.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(true);
    expect(kept.transitions.every((t) => t.confidence !== "unresolved")).toBe(true);
    const aliased = analyse(body, skipping(false));
    expect(aliased.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(false);
    // Another part asking may select the owner, so the owner's field is forgotten.
    const other = analyse(
      [0xc7, 0x44, 0x7a, 7, 0, 0x8b, 0x7c, 0x50, 0x57, 0x9a, 0, 1, 0, 0, 0x59, 0x8b, 0x44, 0x7a, 0x89, 0x44, 12],
      skipping(true),
    );
    expect(other.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(false);
  });
});
