import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };
/** The state the routine's paths end in, as `[value, confidence]`. */
const states = (bytes: number[]) =>
  analyseRoutine(Uint8Array.from(bytes), entry, { stateCount: 4 }).transitions.map((t) => [
    t.to.kind === "constant" ? t.to.value : t.to.kind,
    t.confidence,
  ]);

describe("memory cells", () => {
  it("reads a local stored through its address as the same cell as through BP", () => {
    // sub sp,2; push si; mov si,[bp+6]; mov word [bp-2],0; lea bx,[bp-2]; mov word [bx],7; mov ax,[bp-2]; mov [si+0c],ax
    const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x56, 0x8b, 0x76, 6, 0xc7, 0x46, 0xfe, 0, 0, 0x8d, 0x5e, 0xfe];
    bytes.push(0xc7, 0x07, 7, 0, 0x8b, 0x46, 0xfe, 0x89, 0x44, 0x0c, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
    expect(states(bytes)).toEqual([[7, "inferred"]]);
  });
});
