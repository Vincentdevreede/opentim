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

  const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06];
  const epilogue = [0x5e, 0x5d, 0xcb];

  it("reads a byte of a word stored before as that byte", () => {
    // mov word [si+10],1234; mov al,[si+10]; mov ah,0; mov [si+0c],ax
    const bytes = [0xc7, 0x44, 0x10, 0x34, 0x12, 0x8a, 0x44, 0x10, 0xb4, 0x00, 0x89, 0x44, 0x0c];
    expect(states([...prologue, ...bytes, ...epilogue])).toEqual([[0x34, "inferred"]]);
  });

  it("does not read a word as it was at the start after a store to one of its bytes", () => {
    // mov byte [si+10],5; mov ax,[si+10]; mov [si+0c],ax
    const bytes = [0xc6, 0x44, 0x10, 0x05, 0x8b, 0x44, 0x10, 0x89, 0x44, 0x0c];
    expect(states([...prologue, ...bytes, ...epilogue])).toEqual([["field", "unresolved"]]);
  });

  it("tests a byte of a word stored before with the stored value", () => {
    // mov word [si+10],0100; test byte [si+11],1; je over; mov word [si+0c],3
    const bytes = [0xc7, 0x44, 0x10, 0x00, 0x01, 0xf6, 0x44, 0x11, 0x01, 0x74, 0x05, 0xc7, 0x44, 0x0c, 0x03, 0x00];
    expect(states([...prologue, ...bytes, ...epilogue])).toEqual([[3, "inferred"]]);
  });
});
