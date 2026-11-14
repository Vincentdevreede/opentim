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

/**
 * push bp; mov bp, sp; push si; mov si, [bp+6]; mov word [bp-4], 0x1234; mov cx, 1
 * loop: cmp cx, 2; jne skip; mov byte [bp-4], 9
 * skip: shl cx, 1; cmp cx, 8; jne loop
 * then: mov ax, [bp-4]; mov [si+0x0c], ax; pop si; pop bp; retf
 */
const byteInWord = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0xc7, 0x46, 0xfc, 0x34, 0x12, 0xb9, 1, 0].concat(
  [0x83, 0xf9, 0x02, 0x75, 0x04, 0xc6, 0x46, 0xfc, 0x09, 0xd1, 0xe1, 0x83, 0xf9, 0x08, 0x75, 0xf0],
  [0x8b, 0x46, 0xfc, 0x89, 0x44, 0x0c, 0x5e, 0x5d, 0xcb],
);

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

  it("forgets a word local when the loop stores a byte of it", () => {
    const routine = analyseRoutine(Uint8Array.from(byteInWord), entry, { stateCount: 4, confinedLoops: true });
    expect(routine.status).toBe("complete");
    const writes = routine.writes.filter((w) => w.object === "part" && w.offset === 0x0c);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.value.kind).toBe("unknown");
  });

  it("leaves a loop that stores into the part unresolved", () => {
    const routine = analyseRoutine(Uint8Array.from(storing), entry, { stateCount: 4, confinedLoops: true });
    expect(routine.status).toBe("partial");
    expect(routine.uncertainties.some((u) => u.startsWith("Back edge"))).toBe(true);
  });
});
