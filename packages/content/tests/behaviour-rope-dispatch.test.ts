import { describe, expect, it } from "vitest";
import type { FieldWrite, RoutineAnalysis } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { ROPE_ASSUMPTIONS, ropeCallbackWrites, ropeDispatchSummary } from "../src/read/behaviour-rope-dispatch.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const write = (object: string, offset: number): FieldWrite => ({
  ...fact,
  object,
  offset,
  width: 16,
  value: { kind: "unknown", reason: "x", width: 16 },
  condition: { kind: "true" },
  routine: 0,
});
const analysis = (writes: FieldWrite[], complete = true): RoutineAnalysis =>
  ({
    address: 0,
    segment: 0,
    offset: 0,
    instructions: [{ address: 0, bytes: [0xcb], text: "retf" }],
    writes,
    outcomes: [{ ...fact, effectsComplete: complete, condition: { kind: "true" }, fields: [] }],
    uncertainEffects: !complete,
  }) as unknown as RoutineAnalysis;

describe("the rope connection query", () => {
  it("accepts callbacks that write their own part, its records, an indexed rope and parts a nested query reached", () => {
    const writes = ropeCallbackWrites([
      analysis([write("part", 0x0c), write("referenced-by(part+0x66)", 0x0e)]),
      analysis([
        write('pointer loaded from table 0x2fe1+0x66 indexed by {"kind":"field","object":"address of part"}', 0x0e),
        write("a part reached through a rope, belt or pulley at 0x1d5ef", 0x12),
        write("data", 0x4a6d),
      ]),
    ]);
    expect(writes?.partFields.map((field) => field.offset)).toEqual([0x0c, 0x12]);
    expect(writes?.ownFields.map((field) => field.offset)).toEqual([0x0c]);
    expect(writes?.recordFields.map((field) => field.offset)).toEqual([0x0e]);
    expect(writes?.globals).toBe(true);
  });

  it("refuses callbacks that write anything else or have unfinished effects", () => {
    expect(ropeCallbackWrites([analysis([write("argument at 6", 0x0c)])])).toBeUndefined();
    expect(ropeCallbackWrites([analysis([write("part", 0x0c)], false)])).toBeUndefined();
  });

  it("names the asking argument and the fields a question that comes back can change on it", () => {
    const query = {
      ...fact,
      address: 0x100,
      kind: "connection-query",
      purpose: "q",
      argumentOffset: 6,
      argumentKind: "object",
      writes: [],
      returns: [],
      calls: [],
      footprint: {
        complete: false,
        partMemoryComplete: false,
        preservesArgumentMemory: false,
        preservesPartState: false,
        unknownEffects: ["x"],
      },
    } as EngineSummary;
    const summary = ropeDispatchSummary(
      query,
      {
        partFields: [
          { offset: 0x0c, width: 16 },
          { offset: 0x12, width: 16 },
        ],
        recordFields: [{ offset: 0x0e, width: 16 }],
        globals: false,
      },
      [],
      8,
      [{ offset: 0x12, width: 16 }],
    );
    expect(summary.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: true, complete: true });
    expect(summary.connected).toMatchObject({
      exceptArgument: 8,
      partFields: [
        { offset: 0x0c, width: 16 },
        { offset: 0x12, width: 16 },
      ],
      askingFields: [{ offset: 0x12, width: 16 }],
    });
    expect(summary.assumptions).toEqual(expect.arrayContaining(ROPE_ASSUMPTIONS));
  });

  it("lets every named part field change on the part that asks when no asking fields are given", () => {
    const query = {
      ...fact,
      address: 0x100,
      kind: "connection-query",
      writes: [],
      footprint: {},
    } as unknown as EngineSummary;
    const fields = { partFields: [{ offset: 0x0c, width: 16 }], recordFields: [], globals: false };
    expect(ropeDispatchSummary(query, fields, [], 8).connected?.askingFields).toEqual(fields.partFields);
  });
});
