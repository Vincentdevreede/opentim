import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";

const call = (from: number, to: number) => {
  const relative = (to - (from + 3)) & 0xffff;
  return [0xe8, relative & 255, relative >> 8];
};
/** Reads a near helper at 0x80 first, then the far callback at 0 that calls it, as the read of a build does. */
function callerWith(caller: number[], helper: number[]) {
  const image = new Uint8Array(0x100);
  image.set(caller);
  image.set(helper, 0x80);
  const summary = analyseRoutine(image, { address: 0x80, segment: 0, offset: 0x80 }, { argumentOffset: 4 });
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
