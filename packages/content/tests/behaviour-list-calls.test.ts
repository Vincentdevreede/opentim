import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverListConsumerCalls } from "../src/read/behaviour-list-calls.ts";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
function fixtures(
  options: {
    between?: number[];
    missingRoute?: boolean;
    related?: boolean;
    origin?: number;
    before?: number[];
    after?: number[];
  } = {},
) {
  const query: EngineSummary = {
    ...fact,
    address: 0x100,
    kind: "overlap-list",
    purpose: "Produces an owner-excluding list on normal return.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    writes: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
    list: { ...fact, headField: 0x70, nextField: 0x70, excludesArgument: true },
    overlapProducer: {
      ...fact,
      headField: 0x70,
      nextField: 0x70,
      ownerArgument: 6,
      sourceNextField: 0,
      classFlagsField: 6,
      globalHeads: [0x20, 0x22],
      conditionalOnNormalReturn: true,
      finite: true,
      acyclic: true,
      excludesOwner: true,
    },
  };
  const consumer: EngineSummary = {
    ...fact,
    address: 0x140,
    kind: "conditional-list-consumer",
    purpose: "Consumes a supplied list.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    writes: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: ["The incoming list is not proved."],
    },
    listConsumer: {
      ...fact,
      address: 0x140,
      argumentOffset: 6,
      headInstruction: 0x150,
      headField: 0x70,
      nextField: 0x70,
      returnConvention: { kind: "far", stackBytes: 0 },
      unknownGlobals: false,
      requires: { finite: true, acyclic: true, completeBases: true, excludesArgument: true },
      fields: [
        { root: "member", offset: 12, width: 16 },
        { root: "member", offset: 18, width: 16 },
        { root: "outline", offset: 8, width: 8 },
      ],
      loop: {
        ...fact,
        header: 0x160,
        bodyEntry: 0x158,
        body: [],
        exit: 0x170,
        nodeRegister: "di",
        nextField: 0x70,
        headField: 0x70,
        source: "external-list",
        ownerRegister: "si",
        queries: [],
        possibleFields: [],
        writtenRegisters: [],
        unknownGlobals: false,
        exitOnNullOnly: true,
      },
    },
  };
  const owner = options.related ? 0x57 : 0x56;
  const bytes = [0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, 0xc7, 0x44, 12, 2, 0];
  if (options.related) bytes.push(0x8b, 0x7c, 0x64);
  if (options.missingRoute) bytes.push(0x85, 0xc0, 0x74, 8);
  bytes.push(
    ...(options.before ?? []),
    owner,
    0x9a,
    0,
    1,
    0,
    0,
    0x59,
    ...(options.between ?? []),
    owner,
    0x9a,
    0x40,
    1,
    0,
    0,
    0x59,
    ...(options.after ?? [0xff, 0x44, 12]),
    0x5f,
    0x5e,
    0x5d,
    0xcb,
  );
  // The alternative path enters after the query's cleanup, rather than proving a fresh list.
  if (options.missingRoute) bytes[16] = 7;
  const image = new Uint8Array(0x200).fill(0x66),
    origin = options.origin ?? 0;
  image.set(bytes, origin);
  image[0x100] = 0xcb;
  image[0x140] = 0xcb;
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  return {
    image,
    code,
    query,
    consumer,
    helpers: new Map([
      [query.address, query],
      [consumer.address, consumer],
    ]),
  };
}
describe("fresh external-list call provenance", () => {
  it.each([0, 0x20])("discovers the fresh same-owner call at origin %i", (origin) => {
    const { code, helpers } = fixtures({ origin });
    expect(discoverListConsumerCalls(code, helpers)).toMatchObject([
      { consumer: 0x140, ownerRegister: "si", headField: 0x70 },
    ]);
  });
  it("preserves the owner state while retaining conditional member and outline writes", () => {
    const { image, code, helpers } = fixtures();
    const result = analyseRoutine(image, code, { code, engineSummaries: helpers });
    expect(result.uncertainties).toEqual([]);
    expect(result.engineCalls?.some((c) => c.listContext?.producers.length === 1)).toBe(true);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 3)).toBe(true);
    expect(
      result.writes.some(
        (w) => w.object.startsWith("a listed part") && w.offset === 12 && w.confidence === "unresolved",
      ),
    ).toBe(true);
    expect(result.writes.some((w) => w.object.startsWith("outline storage of a listed part") && w.offset === 8)).toBe(
      true,
    );
  });
  it("invalidates cached member aliases without invalidating the owner's fields", () => {
    const { image, code, helpers, consumer } = fixtures({
      before: [0x8b, 0x7c, 0x64, 0xc7, 0x45, 0x60, 9, 0],
      after: [0x8b, 0x45, 0x60, 0x89, 0x44, 12],
    });
    consumer.listConsumer!.fields.push({ root: "member", offset: 0x60, width: 16 });
    const result = analyseRoutine(image, code, { code, engineSummaries: helpers });
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 9)).toBe(false);
    expect(result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved)).toBe(true);
  });
  it("preserves an owner field even when the same offset changes on members", () => {
    const { image, code, helpers, consumer } = fixtures({
      before: [0xc7, 0x44, 0x60, 9, 0],
      after: [0x8b, 0x44, 0x60, 0x89, 0x44, 12],
    });
    consumer.listConsumer!.fields.push({ root: "member", offset: 0x60, width: 16 });
    const result = analyseRoutine(image, code, { code, engineSummaries: helpers });
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 9)).toBe(true);
  });
  it("does not exempt the analysed owner for a query on another part", () => {
    const { image, code, helpers } = fixtures({ related: true });
    expect(discoverListConsumerCalls(code, helpers)).toHaveLength(1);
    const result = analyseRoutine(image, code, { code, engineSummaries: helpers });
    expect(result.uncertainties.some((s) => s.startsWith("Effects of call"))).toBe(true);
  });
  it("requires every route to cross a matching producer", () => {
    const { code, helpers } = fixtures({ missingRoute: true });
    expect(code.status).toBe("complete");
    expect(discoverListConsumerCalls(code, helpers)).toEqual([]);
  });
  it.each([
    [0xc7, 0x44, 0x70, 0, 0],
    [0x88, 0x44, 0x71],
    [0x9a, 0x80, 1, 0, 0],
    [0x8b, 0xf0],
    [0x5e],
    [0xc5, 0x07],
    [0x96],
    [0x8b, 0xe0],
  ])("rejects an intervening mutation or unknown call %j", (...between) => {
    const { code, helpers } = fixtures({ between: between as number[] });
    expect(discoverListConsumerCalls(code, helpers)).toEqual([]);
  });
  it("rejects a branch into the call which bypasses its owner push", () => {
    const { code, helpers } = fixtures();
    const call = code.calls.at(-1)!;
    code.edges.push({ from: code.address, to: call.instruction, kind: "taken" });
    expect(discoverListConsumerCalls(code, helpers)).toEqual([]);
  });
  it("requires matching fields and the producer's normal-return certificate", () => {
    const { code, helpers, query, consumer } = fixtures();
    consumer.listConsumer!.nextField++;
    expect(discoverListConsumerCalls(code, helpers)).toEqual([]);
    consumer.listConsumer!.nextField--;
    query.overlapProducer = undefined;
    expect(discoverListConsumerCalls(code, helpers)).toEqual([]);
  });
});
