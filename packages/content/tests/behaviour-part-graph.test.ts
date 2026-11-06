import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { analyseRoutine, type Expression, type Predicate } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = {
  confidence: "inferred" as const,
  evidence: [{ address: 0x100, bytes: [0xcb], text: "Synthetic summary contract." }],
  assumptions: ["The connection graph is finite and contains complete part bases, including possible self-links."],
};
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
function helper(advance = false): EngineSummary {
  const sum: Expression = { kind: "binary", operator: "+", left: field(12), right: field(18), width: 16 };
  const compare = (operator: string, value: number): Predicate => ({
    kind: "compare",
    operator,
    left: sum,
    right: constant(value),
    signed: false,
  });
  return {
    ...fact,
    address: 0x100,
    kind: "synthetic-part-graph",
    purpose: "Applies a bounded part-field contract.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    writes: advance
      ? [
          {
            ...fact,
            root: "argument",
            argumentOffset: 6,
            path: [],
            offset: 18,
            width: 16,
            value: constant(0),
            condition: { kind: "true" },
          },
        ]
      : [],
    partGraph: {
      ...fact,
      objectArguments: [6],
      fields: advance
        ? [
            { offset: 12, width: 16 },
            { offset: 18, width: 16 },
          ]
        : [{ offset: 0x60, width: 16 }],
      recursiveCalls: [0x100],
      links: [0x30, 0x32],
      peer: { routine: 0x110, connectionField: 0x20, endpointFields: [0, 2] },
      ...(advance
        ? {
            stateCases: [
              { condition: compare("==", 65535), value: constant(3) },
              { condition: compare("==", 4), value: constant(0) },
              { condition: { kind: "and" as const, terms: [compare("!=", 65535), compare("!=", 4)] }, value: sum },
            ],
          }
        : {}),
    },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: !advance,
      unknownEffects: [],
    },
  };
}
const prefix = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6],
  suffix = [0x5e, 0x5d, 0xcb];
const call = [0x56, 0x9a, 0, 1, 0, 0, 0x59];
function analyse(body: number[], summary = helper(), additional?: EngineSummary) {
  const image = new Uint8Array(0x120);
  image.set([...prefix, ...body, ...suffix]);
  image[0x100] = 0xcb;
  return analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    {
      engineSummaries: new Map([
        [0x100, summary],
        ...(additional ? [[additional.address, additional] as [number, EngineSummary]] : []),
      ]),
    },
  );
}
describe("complete part-graph footprints", () => {
  it("lets a broader state-preserving helper supersede a prior scoped field version", () => {
    const broad: EngineSummary = {
      ...helper(),
      address: 0x110,
      partGraph: undefined,
      footprint: {
        complete: false,
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: ["Non-state part effects remain unresolved."],
      },
    };
    const later = [0x56, 0x9a, 0x10, 1, 0, 0, 0x59];
    const result = analyse(
      [...call, 0x83, 0x7c, 0x60, 2, 0x75, 13, ...later, 0x8b, 0x44, 0x60, 0x89, 0x44, 12],
      helper(),
      broad,
    );
    expect(result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved)).toBe(true);
    expect(
      result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 2 && t.confidence === "inferred"),
    ).toBe(false);
  });
  it("does not reuse an old word guard after a partial store", () => {
    const result = analyse([
      ...call,
      0x83,
      0x7c,
      0x60,
      2,
      0x75,
      10,
      0xc6,
      0x44,
      0x61,
      1,
      0x8b,
      0x44,
      0x60,
      0x89,
      0x44,
      12,
    ]);
    expect(result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved)).toBe(true);
    expect(
      result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 2 && t.confidence === "inferred"),
    ).toBe(false);
  });

  it("proves a counted connection argument and rejects an out-of-range slot", () => {
    const summary = helper();
    summary.partGraph!.objectArguments = [6, 8];
    const bytes = [
      0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 12, 2, 0, 0xc7, 0x46, 0xfe, 0, 0, 0xeb, 0,
    ];
    const jump = bytes.length - 1,
      body = bytes.length;
    bytes.push(
      0x8b,
      0x5e,
      0xfe,
      0xd1,
      0xe3,
      0x8b,
      0x40,
      0x30,
      0x89,
      0x46,
      0xfc,
      0xff,
      0x76,
      0xfc,
      0x56,
      0x9a,
      0,
      1,
      0,
      0,
      0x59,
      0x59,
      0xff,
      0x46,
      0xfe,
    );
    const header = bytes.length;
    bytes[jump] = header - jump - 1;
    bytes.push(0x83, 0x7e, 0xfe, 2, 0x7c, (body - header - 6) & 255, 0xff, 0x44, 12, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
    const image = new Uint8Array(0x120);
    image.set(bytes);
    image[0x100] = 0xcb;
    const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
    const options = { engineSummaries: new Map([[0x100, summary]]), code };
    const result = analyseRoutine(image, code, options);
    expect(result.loops).toHaveLength(1);
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "constant", value: 3 });
    code.edges.push({ from: body, to: body + 8, kind: "taken" });
    expect(analyseRoutine(image, code, options).loops).toHaveLength(0);
    code.edges.pop();
    const source = code.instructions.find((i) => i.address === body + 5)!.operands[1]!;
    if (source.kind === "memory") source.displacement = 0x34;
    expect(analyseRoutine(image, code, options).loops).toHaveLength(0);
  });

  it.each([
    [3, 1, 0],
    [0, 65535, 3],
    [1, 1, 2],
    [0, 0, 0],
  ])("applies the owner's state relation once for state %i and movement %i", (state, delta, expected) => {
    const result = analyse([0xc7, 0x44, 12, state, 0, 0xc7, 0x44, 18, delta & 255, delta >>> 8, ...call], helper(true));
    expect(result.uncertainties).toEqual([]);
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "constant", value: expected });
    expect(result.writes.some((w) => w.object === "a connected part" && w.offset === 12)).toBe(true);
    expect(result.outcomes!.some((o) => o.fields.some((f) => f.object === "a connected part"))).toBe(true);
  });
  it("clears owner movement before the next invocation without claiming exact related-object values", () => {
    const result = analyse([0xc7, 0x44, 12, 3, 0, 0xc7, 0x44, 18, 1, 0, ...call, ...call], helper(true));
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "constant", value: 0 });
    expect(result.writes.find((w) => w.object === "a connected part")!.value).toMatchObject({
      kind: "field",
      unresolved: true,
    });
    expect((result.writes.find((w) => w.object === "a connected part")!.value as { object: string }).object).toMatch(
      /^value the call at 0x[0-9a-f]+ writes to a selected part$/,
    );
  });
  it("invalidates an uncached overlapping read, including partial words", () => {
    const result = analyse([...call, 0x8b, 0x44, 0x5f, 0x89, 0x44, 12]);
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "field", unresolved: true, offset: 0x5f });
  });
  it("keeps an earlier field version when a later traversal preserves the owner's current value", () => {
    const summary = helper();
    summary.partGraph!.preservesNonzeroOwnerField = 0x60;
    const result = analyse(
      [...call, 0xc6, 0x44, 0x61, 1, 0x83, 0x7c, 0x60, 0, 0x74, 13, ...call, 0x8b, 0x44, 0x5f, 0x89, 0x44, 12],
      summary,
    );
    expect(
      result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved && t.to.object.includes("0x8")),
    ).toBe(true);
  });
  it("preserves fields outside the graph footprint", () => {
    const result = analyse([0xc7, 0x44, 12, 2, 0, ...call, 0xff, 0x44, 12]);
    expect(result.transitions.at(-1)!.to).toMatchObject({ kind: "constant", value: 3 });
    expect(result.transitions.at(-1)!.confidence).toBe("inferred");
  });
  it("does not reuse a guard on the input field after that field is changed", () => {
    const result = analyse([0x83, 0x7c, 0x60, 2, 0x75, 13, ...call, 0x8b, 0x44, 0x60, 0x89, 0x44, 12]);
    expect(result.transitions.some((t) => t.to.kind === "field" && t.to.unresolved)).toBe(true);
  });
  it("rejects an interior pointer supplied as the owner", () => {
    const result = analyse([0x83, 0xc6, 2, ...call, 0xff, 0x44, 12]);
    expect(result.uncertainties.some((s) => s.startsWith("Effects of call"))).toBe(true);
  });
});
