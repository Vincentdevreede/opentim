import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { findCreatedParts } from "../src/read/behaviour-created-parts.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = {
  confidence: "inferred" as const,
  assumptions: ["Synthetic factory"],
  evidence: [{ address: 0x90, bytes: [0x89, 0x7c, 0x04], text: "mov word [si+0x04], di" }],
};
const factory: EngineSummary = {
  ...fact,
  address: 0x80,
  argumentOffset: 6,
  argumentKind: "scalar",
  kind: "part-factory",
  purpose: "Creates a part.",
  calls: [],
  // The factory stores its argument as the new part's type.
  writes: [
    {
      ...fact,
      root: "unknown",
      path: [],
      offset: 4,
      width: 16,
      value: { kind: "field", object: "argument", offset: 6, width: 16 },
      condition: { kind: "true" },
    },
  ],
  returns: [],
  returnPointerClass: "nullable-fresh",
  returnConvention: { kind: "far", stackBytes: 0 },
  footprint: {
    complete: false,
    preservesArgumentMemory: false,
    preservesPartState: false,
    unknownEffects: ["The selected constructor is unresolved."],
    unknownPartEffects: [],
    unknownGlobalEffects: [],
  },
  factory: {
    typeArgument: 6,
    constructorTable: { segment: 0, offset: 0x90, stride: 8, typeCount: 64 },
    noConstructorTypes: [],
    noConstructor: {
      ...fact,
      purpose: "Creates a part without invoking a constructor.",
      freshFieldsOnly: true,
      writes: [],
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
        unknownPartEffects: [],
        unknownGlobalEffects: [],
      },
    },
  },
};
/** A run that makes a part with the factory at 0x80 after loading its argument with `load`. */
function routine(load: number[]) {
  const image = new Uint8Array(0x100).fill(0x90);
  // push bp; mov bp, sp; push si; mov si, [bp+6]; <load>; push ax; call far 0000:0080; pop cx; pop si; pop bp; retf
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...load, 0x50, 0x9a, 0x80, 0, 0, 0, 0x59, 0x5e, 0x5d, 0xcb]);
  image[0x80] = 0xcb;
  return analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { engineSummaries: new Map([[0x80, factory]]) });
}

describe("parts a routine makes with the part factory", () => {
  it("takes the type from the number pushed right before the call, like the gun's bullet", () => {
    // mov ax, 0x0014
    const created = findCreatedParts([routine([0xb8, 0x14, 0x00])], [factory], 4);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ routine: 0, call: 11, type: 20 });
    expect(created[0]!.evidence.map((item) => item.text)).toEqual([
      "mov ax, 0x0014",
      "push ax",
      "call 0x0000:0x0080",
      "mov word [si+0x04], di",
    ]);
  });

  it("gives the evidence of the factory's type store only, not another instruction at the same displacement", () => {
    const compare = { address: 0x88, bytes: [0x83, 0x7f, 0x04, 0x14], text: "cmp word [bx+0x04], 0x14" };
    const busy = { ...factory, evidence: [compare, ...fact.evidence] };
    const created = findCreatedParts([routine([0xb8, 0x14, 0x00])], [busy], 4);
    expect(created[0]!.evidence.map((item) => item.text)).toEqual([
      "mov ax, 0x0014",
      "push ax",
      "call 0x0000:0x0080",
      "mov word [si+0x04], di",
    ]);
  });

  it("claims no type when the pushed word is not a number", () => {
    // mov ax, word [si+0x0c]
    expect(findCreatedParts([routine([0x8b, 0x44, 0x0c])], [factory], 4)).toEqual([]);
  });

  it("claims no type for a factory without the proved type store", () => {
    expect(findCreatedParts([routine([0xb8, 0x14, 0x00])], [{ ...factory, writes: [] }], 4)).toEqual([]);
  });
});
