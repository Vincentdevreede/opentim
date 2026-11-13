import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const call = (from: number, to: number) => {
  const relative = (to - (from + 3)) & 0xffff;
  return [0xe8, relative & 255, relative >> 8];
};
/**
 * Reads a near helper at 0x80 first, then the far callback at 0 that calls it, as the read of a build does. A far
 * routine at 0x60 only returns, for a helper that calls a service.
 */
function callerWith(caller: number[], helper: number[], engineSummaries?: Map<number, EngineSummary>) {
  const image = new Uint8Array(0x100);
  image.set(caller);
  image.set(helper, 0x80);
  image[0x60] = 0xcb;
  const summary = analyseRoutine(
    image,
    { address: 0x80, segment: 0, offset: 0x80 },
    { argumentOffset: 4, engineSummaries },
  );
  return analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    { stateCount: 4, summaries: new Map([[0x80, summary]]) },
  );
}

describe("effects of a called routine", () => {
  it("forgets a local the helper may have stored to through its address", () => {
    // The caller sets a local to 0, passes its address and the part, and copies the local to the state.
    const caller = [0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0, 0x8d, 0x46, 0xfe];
    caller.push(0x50, 0x56, ...call(caller.length + 2, 0x80));
    caller.push(0x83, 0xc4, 4, 0x8b, 0x46, 0xfe, 0x89, 0x44, 0x0c, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
    // The helper stores 7 through its second argument and 1 in the part's field 0x20.
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0x8b, 0x5e, 6, 0xc7, 0x07, 7, 0, 0xc7, 0x44, 0x20, 1, 0];
    helper.push(0x5e, 0x5d, 0xc3);
    const routine = callerWith(caller, helper);
    expect(routine.transitions.map((t) => [t.to.kind, t.confidence])).toEqual([["unknown", "unresolved"]]);
  });

  it("reads a global after the call as the helper left it", () => {
    // The caller sets the global at 0x300 to 1, calls the helper with the part and copies the global to field 0x20.
    const caller = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x06, 0, 3, 1, 0, 0x56];
    caller.push(...call(caller.length, 0x80), 0x59, 0xa1, 0, 3, 0x89, 0x44, 0x20, 0x5e, 0x5d, 0xcb);
    // The helper sets the global to 2 and the state to 3.
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0xc7, 0x06, 0, 3, 2, 0, 0xc7, 0x44, 0x0c, 3, 0];
    helper.push(0x5e, 0x5d, 0xc3);
    const routine = callerWith(caller, helper);
    expect(routine.transitions).toHaveLength(1);
    const update = routine.transitions[0]!.updates?.find((u) => u.object === "part" && u.offset === 0x20);
    expect(update?.value).toEqual({ kind: "constant", value: 2, width: 16 });
  });

  it("forgets a local whose address the caller passes as the helper's part", () => {
    // The caller sets a local to 0, passes only its address and copies the local to the state.
    const caller = [0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0, 0x8d, 0x46, 0xfe];
    caller.push(0x50, ...call(caller.length + 1, 0x80));
    caller.push(0x59, 0x8b, 0x46, 0xfe, 0x89, 0x44, 0x0c, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
    // The helper stores 7 through its first argument.
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0xc7, 0x04, 7, 0, 0x5e, 0x5d, 0xc3];
    const routine = callerWith(caller, helper);
    expect(routine.transitions.map((t) => [t.to.kind, t.confidence])).toEqual([["unknown", "unresolved"]]);
  });

  it("stores through the part's address that the helper left in a global", () => {
    // The helper keeps its part's address in the global at 0x300.
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0x89, 0x36, 0, 3, 0x5e, 0x5d, 0xc3];
    // The caller passes the part, reads the global back into BX and sets the state to 3 through it.
    const caller = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x56];
    caller.push(...call(caller.length, 0x80), 0x59, 0x8b, 0x1e, 0, 3, 0xc7, 0x47, 0x0c, 3, 0, 0x5e, 0x5d, 0xcb);
    const routine = callerWith(caller, helper);
    expect(routine.transitions.map((t) => t.to)).toEqual([{ kind: "constant", value: 3, width: 16 }]);
  });

  // The caller sets the global at 0x300 to 1, calls the helper with the part, or with the word at field 0x10, and
  // copies the global to field 0x20.
  it.each([
    ["the part", [0x56]],
    ["another word", [0xff, 0x74, 0x10]],
  ])("forgets the globals a helper's call to a service may have changed, given %s", (_, push) => {
    const caller = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x06, 0, 3, 1, 0, ...push];
    caller.push(...call(caller.length, 0x80), 0x59, 0xa1, 0, 3, 0x89, 0x44, 0x20, 0x5e, 0x5d, 0xcb);
    // The helper asks the far service at 0x60 for resource 3, which may change any global.
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0xb8, 3, 0, 0x50, 0x9a, 0x60, 0, 0, 0, 0x59];
    helper.push(0x5e, 0x5d, 0xc3);
    const service: EngineSummary = {
      confidence: "inferred",
      assumptions: [],
      evidence: [],
      address: 0x60,
      kind: "scalar-resource-service",
      purpose: "Requests a resource by identifier.",
      argumentOffset: 6,
      argumentKind: "scalar",
      writes: [],
      returns: [],
      calls: [],
      footprint: {
        complete: false,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: ["The service has effects of its own."],
        unknownPartEffects: [],
        unknownGlobalEffects: ["The service may change globals."],
      },
    };
    const routine = callerWith(caller, helper, new Map([[0x60, service]]));
    const updates = routine.transitions.map((t) => t.updates?.find((u) => u.object === "part" && u.offset === 0x20));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.value).not.toEqual({ kind: "constant", value: 1, width: 16 });
  });

  it("keeps two reads through addresses an unresolved call left apart", () => {
    // Each call leaves BX unknown. A path where the first word read through it is nonzero and the second is zero
    // reaches the state 3.
    const bytes = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
    bytes.push(...call(bytes.length, 0x80), 0x8b, 0x07, 0x0b, 0xc0, 0x74, 14);
    bytes.push(...call(bytes.length, 0x80), 0x8b, 0x07, 0x0b, 0xc0, 0x75, 5, 0xc7, 0x44, 0x0c, 3, 0, 0x5e, 0x5d, 0xcb);
    const image = new Uint8Array(0x100);
    image.set(bytes);
    image.set([0xc3], 0x80);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { stateCount: 4 });
    expect(routine.transitions.some((t) => t.to.kind === "constant" && t.to.value === 3)).toBe(true);
  });
});
