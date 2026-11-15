import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverFindFirstLoops } from "../src/read/behaviour-find-first-loops.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const HEADER = 38;

/**
 * Searches the parts that overlap the owner, then walks the found list: a part of type 5 makes the owner go to frame 2
 * and ends the walk; any other part is passed over. With `passWrite`, a passed part also changes the owner's state.
 */
function fixture(passWrite = false, pass: number[] = passWrite ? [0xc7, 0x44, 12, 3, 0] : []) {
  const image = new Uint8Array(0x140);
  // prettier-ignore
  const bytes = [
    0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; push di; mov si,[bp+6]
    0x56, 0x9a, 0, 1, 0, 0, 0x59, // push si; call far 0:0x100; pop cx
    0x8b, 0x7c, 0x70, 0xeb, 18, // mov di,[si+0x70]; jmp header
    0x83, 0x7d, 4, 5, 0x75, 9, // body: cmp word [di+4],5; jne next
    0xc7, 0x44, 12, 2, 0, 0x33, 0xff, 0xeb, 3, // mov word [si+12],2; xor di,di; jmp header
    0x8b, 0x7d, 0x70, // next: mov di,[di+0x70]
    0x0b, 0xff, 0x75, 0xea, // header: or di,di; jne body
    0x5f, 0x5e, 0x5d, 0xcb, // pop di; pop si; pop bp; retf
  ];
  if (pass.length) {
    // What a pass does before it goes on moves the head and its jumps along.
    bytes.splice(35, 0, ...pass);
    bytes[19] = 18 + pass.length;
    bytes[34] = 3 + pass.length;
    bytes[41 + pass.length] = 0xea - pass.length;
  }
  image.set(bytes);
  image[0x100] = 0xcb;
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
    list: { ...fact, headField: 0x70, nextField: 0x70, excludesArgument: true },
  };
  return { image, helpers: new Map([[query.address, query]]) };
}

describe("find-first loops", () => {
  it("recognises a walk that acts once for the member it finds and stops", () => {
    const { image, helpers } = fixture();
    const loop = discoverFindFirstLoops(readRoutineCode(image, entry, 0), helpers).get(HEADER);
    expect(loop).toMatchObject({ node: "di", excludesOwner: true, passWrites: [] });
  });

  it("counts the register a pass changes without naming it", () => {
    // cwd
    const { image, helpers } = fixture(false, [0x99]);
    const loop = discoverFindFirstLoops(readRoutineCode(image, entry, 0), helpers).get(HEADER + 1);
    expect(loop?.registers).toContain("dx");
  });

  it("follows no member and one member instead of a loop invariant", () => {
    const { image, helpers } = fixture();
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(false);
    const targets = routine.transitions.map((transition) => JSON.stringify(transition.to));
    expect(targets).toContain(JSON.stringify({ kind: "constant", value: 2, width: 16 }));
    expect(targets).toContain(JSON.stringify({ kind: "field", object: "part", offset: 12, width: 16 }));
  });

  it("keeps a field a pass may change as changed when it joins a way that skips the loop", () => {
    // Only when the owner's field 0x40 is nonzero does it search; a passed part changes the owner's field 0x30.
    const { helpers } = fixture();
    const image = new Uint8Array(0x140);
    // prettier-ignore
    image.set([
      0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6, // push bp; mov bp,sp; push si; push di; mov si,[bp+6]
      0x83, 0x7c, 0x40, 0, 0x74, 39, // cmp word [si+0x40],0; je exit
      0x56, 0x9a, 0, 1, 0, 0, 0x59, // push si; call far 0:0x100; pop cx
      0x8b, 0x7c, 0x70, 0xeb, 23, // mov di,[si+0x70]; jmp header
      0x83, 0x7d, 4, 5, 0x75, 9, // body: cmp word [di+4],5; jne next
      0xc7, 0x44, 12, 2, 0, 0x33, 0xff, 0xeb, 8, // mov word [si+12],2; xor di,di; jmp header
      0xc7, 0x44, 0x30, 3, 0, 0x8b, 0x7d, 0x70, // next: mov word [si+0x30],3; mov di,[di+0x70]
      0x0b, 0xff, 0x75, 0xe5, // header: or di,di; jne body
      0x5f, 0x5e, 0x5d, 0xcb, // exit: pop di; pop si; pop bp; retf
    ]);
    image[0x100] = 0xcb;
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(false);
    // The way that found nothing and the way that skipped the search both keep the state, so they merge on 0x40.
    const kept = routine.transitions.find(
      (transition) =>
        JSON.stringify(transition.to) === JSON.stringify({ kind: "field", object: "part", offset: 12, width: 16 }),
    )!;
    expect(kept.condition.kind).toBe("true");
    const changed = kept.updates?.find((update) => update.object === "part" && update.offset === 0x30);
    expect(JSON.stringify(changed?.value)).toContain("part after field effect at 0x");
  });

  it("falls back to an unresolved loop when a pass that goes on changes the owner's state", () => {
    const { image, helpers } = fixture(true);
    const routine = analyseRoutine(image, entry, { engineSummaries: helpers, stateCount: 4 });
    expect(routine.uncertainties.some((reason) => reason.includes("Back edge"))).toBe(true);
  });
});
