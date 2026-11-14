import { describe, expect, it } from "vitest";
import { analyseRoutine, CODE_VARIABLE_ASSUMPTION } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };

describe("variables in the code segment", () => {
  it("keeps the part known past a store to a fixed place in the code segment", () => {
    // push bp; mov bp, sp; push si; mov si, [bp+6]; mov word cs:[0x100], 5; mov word [si+0x0c], 3; pop si; pop bp; retf
    const bytes = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0x2e, 0xc7, 0x06, 0x00, 0x01, 5, 0].concat([
      0xc7, 0x44, 0x0c, 3, 0, 0x5e, 0x5d, 0xcb,
    ]);
    const routine = analyseRoutine(Uint8Array.from(bytes), entry, { stateCount: 4 });
    expect(routine.status).toBe("complete");
    expect(routine.uncertainties).toEqual([]);
    const state = routine.writes.find((w) => w.object === "part" && w.offset === 0x0c)!;
    expect(state.value).toEqual({ kind: "constant", value: 3, width: 16 });
    expect(state.assumptions).toContain(CODE_VARIABLE_ASSUMPTION);
  });

  it("reads back what the routine stored there, not what the program holds", () => {
    // push bp; mov bp, sp; push si; mov si, [bp+6]; mov word cs:[0x100], 5; mov ax, cs:[0x100]; mov [si+0x0c], ax;
    // pop si; pop bp; retf. The program holds 7 at 0x100.
    const image = new Uint8Array(0x110);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0x2e, 0xc7, 0x06, 0x00, 0x01, 5, 0]);
    image.set([0x2e, 0xa1, 0x00, 0x01, 0x89, 0x44, 0x0c, 0x5e, 0x5d, 0xcb], 14);
    image[0x100] = 7;
    const routine = analyseRoutine(image, entry, { stateCount: 4 });
    expect(routine.status).toBe("complete");
    const state = routine.writes.find((w) => w.object === "part" && w.offset === 0x0c)!;
    expect(state.value).toEqual({ kind: "constant", value: 5, width: 16 });
  });

  it("reads a variable the routine didn't store into as the program holds it", () => {
    // push bp; mov bp, sp; push si; mov si, [bp+6]; mov ax, cs:[0x100]; mov [si+0x0c], ax; pop si; pop bp; retf
    const image = new Uint8Array(0x110);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0x2e, 0xa1, 0x00, 0x01, 0x89, 0x44, 0x0c, 0x5e, 0x5d, 0xcb]);
    image[0x100] = 7;
    const routine = analyseRoutine(image, entry, { stateCount: 4 });
    const state = routine.writes.find((w) => w.object === "part" && w.offset === 0x0c)!;
    expect(state.value).toEqual({ kind: "constant", value: 7, width: 16 });
  });
});
