import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverListLoops } from "../src/read/behaviour-list-loops.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
const entry = { address: 0, segment: 0, offset: 0 };
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
function fixture(
  options: {
    ownerWrite?: boolean;
    linkWrite?: boolean;
    missingProgress?: boolean;
    unknownCall?: boolean;
    helperCall?: boolean;
    alternativeQueries?: boolean;
    skipAlternative?: boolean;
    volatileOwner?: boolean;
    field?: number;
  } = {},
) {
  const field = options.field ?? 0x70;
  const image = new Uint8Array(0x140).fill(0x66);
  const bytes = [0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, options.volatileOwner ? 0x5e : 0x76, 6];
  const pushOwner = options.volatileOwner ? [0xff, 0x76, 6] : [0x56];
  if (options.alternativeQueries) {
    bytes.push(0x85, 0xc0, 0x74, 0);
    const condition = bytes.length - 1;
    bytes.push(...pushOwner, 0x9a, 0, 1, 0, 0, 0x59, 0xeb, 0);
    const firstExit = bytes.length - 1,
      second = bytes.length;
    if (!options.skipAlternative) bytes.push(...pushOwner, 0x9a, 0, 1, 0, 0, 0x59);
    bytes[condition] = second - condition - 1;
    bytes[firstExit] = bytes.length - firstExit - 1;
  } else bytes.push(...pushOwner, 0x9a, 0, 1, 0, 0, 0x59);
  bytes.push(0x8b, options.volatileOwner ? 0x7f : 0x7c, field, 0xeb, 0);
  const firstJump = bytes.length - 1,
    body = bytes.length;
  bytes.push(...(options.ownerWrite ? [0xc7, 0x44, 12, 1, 0] : [0xc7, 0x45, 12, 1, 0]));
  if (options.linkWrite) bytes.push(0xc7, 0x45, field, 0, 0);
  if (options.helperCall) bytes.push(0x57, 0x9a, 0x10, 1, 0, 0, 0x59);
  if (options.unknownCall) bytes.push(0x9a, 0x10, 1, 0, 0);
  if (!options.missingProgress) bytes.push(0x8b, 0x7d, field);
  const header = bytes.length;
  bytes[firstJump] = header - firstJump - 1;
  bytes.push(
    0x0b,
    0xff,
    0x75,
    (body - header - 4) & 255,
    ...(options.volatileOwner ? [0x8b, 0x5e, 6] : []),
    0xff,
    options.volatileOwner ? 0x47 : 0x44,
    12,
    0x5f,
    0x5e,
    0x5d,
    0xcb,
  );
  image.set(bytes);
  image[0x100] = 0xcb;
  image[0x110] = 0xcb;
  const query: EngineSummary = {
    ...fact,
    address: 0x100,
    argumentOffset: 6,
    argumentKind: "object",
    kind: "overlap-list",
    purpose: "Builds an overlap list.",
    writes: [],
    returns: [],
    calls: [],
    footprint: { complete: true, preservesArgumentMemory: false, preservesPartState: true, unknownEffects: [] },
    list: { ...fact, headField: field, nextField: field, excludesArgument: true },
  };
  const helpers = new Map([[query.address, query]]);
  return { image, helpers, query, header, body };
}

describe("overlap-list invariants", () => {
  it.each([0x70, 0x74])("preserves the owner's state while other parts are changed through link %s", (field) => {
    const { image, helpers, header, body } = fixture({ field });
    const loops = discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ header, bodyEntry: body, nextField: field, nodeRegister: "di" });
    expect(loops[0]!.possibleFields).toContainEqual(expect.objectContaining({ object: "other", offset: 12 }));
    expect(loops[0]!.assumptions.join(" ")).toContain("acyclic");
  });

  it("retains member writes without using one member to decide the owner's outcome", () => {
    const { image, helpers } = fixture();
    const result = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(result.listLoops).toHaveLength(1);
    expect(result.transitions.every((transition) => transition.to.kind === "binary")).toBe(true);
    expect(result.writes).toContainEqual(
      expect.objectContaining({ offset: 12, value: { kind: "constant", value: 1, width: 16 } }),
    );
    expect(result.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(false);
  });

  it("requires the overlap query to exclude its owner", () => {
    const { image, helpers, query } = fixture();
    query.list!.excludesArgument = false;
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toEqual([]);
  });

  it.each([{ ownerWrite: true }, { linkWrite: true }, { missingProgress: true }, { unknownCall: true }])(
    "rejects an unproved loop footprint %s",
    (options) => {
      const { image, helpers } = fixture(options);
      expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toEqual([]);
    },
  );
});

describe("complete member-helper footprints", () => {
  function helperFixture() {
    const fixtureData = fixture({ helperCall: true });
    const setter: EngineSummary = {
      ...fact,
      address: 0x110,
      argumentOffset: 6,
      argumentKind: "object",
      kind: "owner-field-update",
      purpose: "Sets the argument's state.",
      calls: [],
      returns: [],
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: false,
        preservesPartState: false,
        unknownEffects: [],
      },
      writes: [
        {
          ...fact,
          root: "argument",
          argumentOffset: 6,
          path: [],
          offset: 12,
          width: 16,
          value: { kind: "constant", value: 2, width: 16 },
          condition: { kind: "true" },
        },
      ],
    };
    fixtureData.helpers.set(setter.address, setter);
    return { ...fixtureData, setter };
  }

  it("permits a complete helper to change a disjoint member's state", () => {
    const { image, helpers } = helperFixture();
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toHaveLength(1);
  });

  it("rejects effects on an unmapped second object argument", () => {
    const { image, helpers, setter } = helperFixture();
    setter.writes[0]!.argumentOffset = 8;
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toHaveLength(0);
  });

  it("rejects a helper that can change a next link through an alias", () => {
    const { image, helpers, setter } = helperFixture();
    setter.writes[0]!.path = [0x84];
    setter.writes[0]!.offset = 0x70;
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toHaveLength(0);
  });
});

describe("alternative overlap queries", () => {
  it("accepts mutually exclusive queries when their union dominates the head load", () => {
    const { image, helpers } = fixture({ alternativeQueries: true });
    const loops = discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.queries).toHaveLength(2);
  });

  it("rejects a path that can reach the head without an owner-excluding query", () => {
    const { image, helpers } = fixture({ alternativeQueries: true, skipAlternative: true });
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toHaveLength(0);
  });
});

describe("reloaded owner arguments", () => {
  it("tracks a volatile owner register loaded from the actual object argument", () => {
    const { image, helpers } = fixture({ volatileOwner: true });
    const loops = discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.ownerRegister).toBe("bx");
  });
});

describe("discovered global part lists", () => {
  function globalFixture(
    options: { memberWrite?: boolean; ownerLink?: boolean; ownerState?: boolean; nextField?: number } = {},
  ) {
    const image = new Uint8Array(0x100).fill(0x66);
    const nextField = options.nextField ?? 0;
    const bytes = [0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x3e, 0x80, 0, 0xeb, 0];
    const jump = bytes.length - 1;
    const body = bytes.length;
    bytes.push(0xc7, options.memberWrite ? 0x45 : 0x44, options.ownerLink ? 0 : options.ownerState ? 12 : 0x5a, 1, 0);
    bytes.push(0x8b, 0x7d, nextField);
    const header = bytes.length;
    bytes[jump] = header - jump - 1;
    bytes.push(0x0b, 0xff, 0x75, (body - header - 4) & 255, 0xff, 0x44, 12, 0x5f, 0x5e, 0x5d, 0xcb);
    image.set(bytes);
    const head: EngineSummary = {
      ...fact,
      address: 0xa0,
      argumentOffset: 6,
      argumentKind: "scalar",
      kind: "list-head",
      purpose: "Returns a global part-list head.",
      writes: [],
      calls: [],
      footprint: { complete: true, preservesArgumentMemory: true, preservesPartState: true, unknownEffects: [] },
      returns: [
        {
          ...fact,
          register: "ax",
          value: { kind: "field", object: "data", offset: 0x80, width: 16 },
          condition: { kind: "true" },
          pointer: { kind: "global", segment: 0, offset: 0x80, path: [] },
        },
      ],
    };
    const next: EngineSummary = {
      ...head,
      address: 0xb0,
      kind: "list-next",
      returns: [
        {
          ...fact,
          register: "ax",
          value: { kind: "field", object: "part", offset: 0, width: 16 },
          condition: { kind: "true" },
          pointer: { kind: "argument", argument: 6, path: [0] },
        },
      ],
    };
    return {
      image,
      helpers: new Map([
        [head.address, head],
        [next.address, next],
      ]),
      head,
      header,
    };
  }

  it("preserves state while populating owner connections without excluding the owner from the list", () => {
    const { image, helpers, header } = globalFixture();
    const loops = discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ source: "global-list", globalHead: 0x80, header, nextField: 0, queries: [] });
    expect(loops[0]!.assumptions.join(" ")).toContain("may contain the owner");
    const analysed = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(analysed.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(false);
    expect(analysed.iterationOutcomes).toHaveLength(0);
    expect(analysed.transitions.some((transition) => transition.to.kind === "binary")).toBe(true);
  });

  it.each([{ memberWrite: true }, { ownerLink: true }, { ownerState: true }, { nextField: 2 }])(
    "rejects unproved global-list mutations or links %s",
    (options) => {
      const { image, helpers } = globalFixture(options);
      expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toEqual([]);
    },
  );

  it("requires a head independently identified by the list selector", () => {
    const { image, helpers, head } = globalFixture();
    helpers.delete(head.address);
    expect(discoverListLoops(readRoutineCode(image, entry, 0), helpers, 12)).toEqual([]);
  });
});

describe("selected list-member locals", () => {
  function selectionFixture(
    options: {
      unknownInitial?: boolean;
      scalarOverwrite?: boolean;
      byteOverwrite?: boolean;
      privateOutput?: boolean;
    } = {},
  ) {
    const { image, helpers } = fixture();
    helpers.get(0x100)!.footprint.partMemoryComplete = true;
    const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, options.privateOutput ? 4 : 2, 0x56, 0x57, 0x8b, 0x76, 6];
    if (!options.unknownInitial) bytes.push(0xc7, 0x46, 0xfe, 0, 0);
    bytes.push(0x56, 0x9a, 0, 1, 0, 0, 0x59, 0x8b, 0x7c, 0x70, 0xeb, 0);
    const jump = bytes.length - 1,
      body = bytes.length;
    bytes.push(0x89, 0x7e, 0xfe);
    if (options.privateOutput) {
      bytes.push(0x8d, 0x46, 0xfc, 0x50, 0x57, 0x56, 0x9a, 0x10, 1, 0, 0, 0x83, 0xc4, 6);
      helpers.set(0x110, {
        ...fact,
        address: 0x110,
        argumentOffset: 6,
        argumentKind: "unknown",
        kind: "argument-buffer-update",
        purpose: "Writes a bounded output after two input arguments.",
        calls: [],
        returns: [],
        returnConvention: { kind: "far", stackBytes: 0 },
        footprint: {
          complete: true,
          partMemoryComplete: true,
          preservesPartState: false,
          preservesArgumentMemory: false,
          unknownEffects: [],
        },
        writes: [
          {
            ...fact,
            root: "argument",
            argumentOffset: 10,
            path: [],
            offset: 0,
            width: 16,
            value: { kind: "unknown", width: 16, reason: "The numeric output is unresolved." },
            condition: { kind: "true" },
          },
        ],
      });
    }
    if (options.scalarOverwrite) bytes.push(0xc7, 0x46, 0xfe, 2, 0);
    if (options.byteOverwrite) bytes.push(0xc6, 0x46, 0xff, 1);
    bytes.push(0x8b, 0x7d, 0x70);
    const header = bytes.length;
    bytes[jump] = header - jump - 1;
    bytes.push(
      0x0b,
      0xff,
      0x75,
      (body - header - 4) & 255,
      0x8b,
      0x5e,
      0xfe,
      0x0b,
      0xdb,
      0x74,
      4,
      0xff,
      0x87,
      0x96,
      0,
      0xff,
      0x44,
      12,
      0x5f,
      0x5e,
      0x8b,
      0xe5,
      0x5d,
      0xcb,
    );
    image.set(bytes);
    return { image, helpers };
  }
  it("retains a nullable complete member when the entry value is zero and every store copies a member pointer", () => {
    const { image, helpers } = selectionFixture();
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.listLoops).toHaveLength(1);
    expect(routine.listLoops![0]!.possibleFields.some((field) => field.nullableMember)).toBe(true);
    expect(routine.uncertainties.some((reason) => reason.includes("pointer is lost"))).toBe(false);
    expect(
      routine.writes.some((write) => write.object.startsWith("part selected by list scan") && write.offset === 0x96),
    ).toBe(true);
  });
  it("maps helper outputs to private locals without treating those words as a member's state", () => {
    const { image, helpers } = selectionFixture({ privateOutput: true });
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.listLoops).toHaveLength(1);
    expect(routine.listLoops![0]!.possibleFields).toContainEqual(
      expect.objectContaining({ object: "stack", offset: -4, width: 16 }),
    );
    expect(routine.uncertainties).toEqual([]);
    expect(routine.iterationOutcomes?.some((outcome) => outcome.effectsComplete)).toBe(true);
  });
  it.each([{ unknownInitial: true }, { scalarOverwrite: true }, { byteOverwrite: true }])(
    "does not promote an unproved pointer local %s",
    (options) => {
      const { image, helpers } = selectionFixture(options);
      const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
      expect(
        routine.writes.some((write) => write.object.startsWith("part selected by list scan") && write.offset === 0x96),
      ).toBe(false);
      expect(routine.uncertainties.some((reason) => reason.includes("pointer is lost"))).toBe(true);
    },
  );
});
