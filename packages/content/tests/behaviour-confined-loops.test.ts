import { describe, expect, it } from "vitest";
import { analyseRoutine, CONFINED_LOOP_ASSUMPTION } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };

/**
 * push bp; mov bp, sp; push si; mov si, [bp+6]; mov cx, 10
 * loop: add [bp-2], cx; dec cx; jne loop
 * then: mov word [si+0x0c], 3; pop si; pop bp; retf
 */
const counting = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0xb9, 10, 0, 0x01, 0x4e, 0xfe, 0x49, 0x75, 0xfa].concat([
  0xc7, 0x44, 0x0c, 3, 0, 0x5e, 0x5d, 0xcb,
]);

/** The same, but the loop also stores into the part: `add [si+0x10], cx`. */
const storing = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0xb9, 10, 0, 0x01, 0x4c, 0x10, 0x49, 0x75, 0xfa].concat([
  0xc7, 0x44, 0x0c, 3, 0, 0x5e, 0x5d, 0xcb,
]);

describe("confined loops", () => {
  it("goes past a loop that changes only registers and locals when the profile says so", () => {
    const off = analyseRoutine(Uint8Array.from(counting), entry, { stateCount: 4 });
    expect(off.status).toBe("partial");
    const on = analyseRoutine(Uint8Array.from(counting), entry, { stateCount: 4, confinedLoops: true });
    expect(on.status).toBe("complete");
    const write = on.writes.find((w) => w.object === "part" && w.offset === 0x0c)!;
    expect(write.value).toEqual({ kind: "constant", value: 3, width: 16 });
    expect(write.assumptions).toContain(CONFINED_LOOP_ASSUMPTION);
  });

  it("leaves a loop that stores into the part unresolved", () => {
    const routine = analyseRoutine(Uint8Array.from(storing), entry, { stateCount: 4, confinedLoops: true });
    expect(routine.status).toBe("partial");
    expect(routine.uncertainties.some((u) => u.startsWith("Back edge"))).toBe(true);
  });
});
