import { describe, expect, it } from "vitest";
import { analyseRoutine, choiceOf, withOwnType, type Predicate } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = {
  confidence: "inferred" as const,
  assumptions: ["Rope, belt and pulley records are separate from parts."],
  evidence: [{ address: 0x80, bytes: [0xcb], text: "retf" }],
};

/** A routine that sets owner fields and a rope record field, then calls a helper with connected writes. */
function analyse(connected?: EngineSummary["connected"], writes: EngineSummary["writes"] = []) {
  const image = new Uint8Array(0x100);
  image.set([
    ...[0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6], // push bp; mov bp,sp; push si; mov si,[bp+6]
    ...[0xc7, 0x44, 0x30, 5, 0], // mov word [si+0x30],5
    ...[0xc7, 0x44, 0x12, 9, 0], // mov word [si+0x12],9
    ...[0xc7, 0x44, 0x0c, 1, 0], // mov word [si+0x0c],1
    ...[0x8b, 0x5c, 0x66], // mov bx,[si+0x66]
    ...[0xc7, 0x47, 0x14, 7, 0], // mov word [bx+0x14],7
    ...[0x56, 0x9a, 0x80, 0, 0, 0, 0x59], // push si; call far 0:0x80; pop cx
    ...[0x5e, 0x5d, 0xcb], // pop si; pop bp; retf
  ]);
  image[0x80] = 0xcb;
  const helper: EngineSummary = {
    ...fact,
    address: 0x80,
    kind: "read-only",
    purpose: "Synthetic helper with connected writes.",
    argumentOffset: 6,
    argumentKind: "object",
    writes,
    returns: [],
    calls: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
    ...(connected ? { connected } : {}),
  };
  const result = analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    { engineSummaries: new Map([[0x80, helper]]) },
  );
  const final = (object: string, offset: number) =>
    result.outcomes?.[0]?.fields.find((field) => field.object === object && field.offset === offset)?.value;
  return { result, final };
}
const typeIsNot49: Predicate = {
  kind: "compare",
  operator: "!=",
  left: { kind: "field", object: "part", offset: 4, width: 16 },
  right: { kind: "constant", value: 49, width: 16 },
  signed: false,
};

describe("writes through ropes, belts and pulleys", () => {
  it("gives a reached part the value the summary fixes, and names the others after the call", () => {
    const { result } = analyse({
      ...fact,
      partFields: [
        { offset: 0x14, width: 8 },
        { offset: 0x5a, width: 16 },
      ],
      recordFields: [],
      recordLinks: [0x66],
      values: [{ offset: 0x14, width: 8, value: { kind: "constant", value: 2, width: 8 } }],
    });
    const reached = (offset: number) =>
      result.writes.find((w) => w.object.startsWith("a part reached through") && w.offset === offset)!.value;
    expect(reached(0x14)).toMatchObject({ kind: "constant", value: 2 });
    expect(reached(0x5a)).toMatchObject({
      kind: "field",
      object: "value the call at 0x1f writes to a selected part",
      unresolved: true,
    });
  });

  it("keeps the old value where an exact owner write's test fails, and decides the test for the part's type", () => {
    const { final } = analyse(
      { ...fact, partFields: [{ offset: 0x30, width: 16 }], recordFields: [], recordLinks: [0x66] },
      [
        {
          ...fact,
          root: "argument",
          argumentOffset: 6,
          path: [],
          offset: 0x30,
          width: 16,
          value: { kind: "constant", value: 3, width: 16 },
          condition: typeIsNot49,
          exact: true,
        },
      ],
    );
    const value = final("part", 0x30)!;
    expect(choiceOf(value)?.test).toMatchObject({ operator: "!=", right: { value: 49 } });
    expect(withOwnType(value, 2, 4)).toMatchObject({ kind: "constant", value: 3 });
    // A part of type 49 keeps the field it had after the call, which a reached part may still change.
    expect(withOwnType(value, 49, 4)).toMatchObject({ kind: "field", object: "part after field effect at 0x1f" });
  });

  it("forgets the named fields on connected parts and records, and keeps every other owner field", () => {
    const { final } = analyse({
      ...fact,
      partFields: [{ offset: 0x30, width: 16 }],
      recordFields: [{ offset: 0x14, width: 16 }],
      recordLinks: [0x54, 0x66, 0x68],
    });
    // A part reached may be the owner: its field is one value of the run, named after the call.
    expect(final("part", 0x30)).toMatchObject({
      kind: "field",
      object: "part after field effect at 0x1f",
      unresolved: true,
    });
    expect(final("part", 0x12)).toMatchObject({ kind: "constant", value: 9 });
    expect(final("part", 0x0c)).toMatchObject({ kind: "constant", value: 1 });
    expect(final("referenced-by(part+0x66)", 0x14)?.kind).not.toBe("constant");
  });

  it("keeps the caller's own fields when it passed its own part as the asking argument", () => {
    const { final } = analyse({
      ...fact,
      partFields: [{ offset: 0x30, width: 16 }],
      recordFields: [],
      recordLinks: [0x66],
      exceptArgument: 6,
    });
    expect(final("part", 0x30)).toMatchObject({ kind: "constant", value: 5 });
  });

  it("names the asking fields on the caller's own part as values after the call, since a question can come back to it", () => {
    const { final } = analyse({
      ...fact,
      partFields: [
        { offset: 0x30, width: 16 },
        { offset: 0x12, width: 16 },
      ],
      recordFields: [],
      recordLinks: [0x66],
      exceptArgument: 6,
      askingFields: [{ offset: 0x12, width: 16 }],
    });
    expect(final("part", 0x30)).toMatchObject({ kind: "constant", value: 5 });
    expect(final("part", 0x12)).toMatchObject({ kind: "field", offset: 0x12, unresolved: true });
    expect((final("part", 0x12) as { object: string }).object).toMatch(/^part after the query at 0x/);
    expect(final("part", 0x0c)).toMatchObject({ kind: "constant", value: 1 });
  });

  it("keeps everything when the helper names no connected writes", () => {
    const { final } = analyse();
    expect(final("part", 0x30)).toMatchObject({ kind: "constant", value: 5 });
    expect(final("referenced-by(part+0x66)", 0x14)).toMatchObject({ kind: "constant", value: 7 });
  });
});
