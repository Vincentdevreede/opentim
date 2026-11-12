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
});
