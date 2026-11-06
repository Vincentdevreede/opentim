import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { ownerPathStores } from "../src/read/behaviour-owner-paths.ts";
import type { Instruction } from "../src/read/x86.ts";

function stores(body: number[], dataSegment?: number, keepsOwner?: (call: Instruction) => boolean) {
  const image = new Uint8Array(0x100);
  // push bp; mov bp, sp; push si; mov si, [bp+6]; ...; pop si; pop bp; retf
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...body, 0x5e, 0x5d, 0xcb]);
  image[0x80] = 0xc3;
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  return ownerPathStores(code, "si", 6, dataSegment, keepsOwner);
}
// mov bx, [si+0x0c]; shl bx, 1; shl bx, 1; mov al, byte [bx+0x2f3c]; mov byte [si+0x6a], al
const lightBulb = [0x8b, 0x5c, 0x0c, 0xd1, 0xe3, 0xd1, 0xe3, 0x8a, 0x87, 0x3c, 0x2f, 0x88, 0x44, 0x6a];

describe("exact stores of a small helper", () => {
  it("reads a byte of a data table at an index worked out from the part's fields", () => {
    const result = stores(lightBulb, 0x2fe1)!;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ offset: 0x6a, width: 8, condition: { kind: "true" } });
    expect(result[0]!.value).toMatchObject({ kind: "table", segment: 0x2fe1, offset: 0x2f3c, width: 8 });
    const index = (result[0]!.value as { index: unknown }).index;
    expect(JSON.stringify(index)).toContain('"operator":"<<"');
  });
  it("doesn't read a table without the data segment", () => {
    expect(stores(lightBulb)).toBeUndefined();
  });
  it("forgets a word register when its byte half changes", () => {
    // mov ax, [si+0x0c]; mov al, 5; mov [si+0x10], ax
    expect(stores([0x8b, 0x44, 0x0c, 0xb0, 5, 0x89, 0x44, 0x10], 0x2fe1)).toBeUndefined();
    // mov al, 5; mov byte [si+0x10], al
    expect(stores([0xb0, 5, 0x88, 0x44, 0x10], 0x2fe1)![0]!.value).toEqual({ kind: "constant", value: 5, width: 8 });
  });
  it("reads past a call that leaves the part alone, and forgets the registers it may change", () => {
    // mov ax, [si+4]; cmp ax, 4; je; push si; call near 0x80; pop cx; or word [si+8], 0x2000; jmp;
    // mov word [si+0x12], 1
    const body = [0x8b, 0x44, 4, 0x3d, 4, 0, 0x74, 12, 0x56, 0xe8, 0x6d, 0, 0x59, 0x81, 0x4c, 8, 0, 0x20, 0xeb, 5];
    body.push(0xc7, 0x44, 0x12, 1, 0);
    expect(stores(body)).toBeUndefined();
    const result = stores(body, undefined, () => true)!;
    expect(result.map((r) => [r.offset, r.condition.kind === "compare" && r.condition.operator])).toEqual([
      [8, "!="],
      [0x12, "=="],
    ]);
    expect(result[0]!.value).toMatchObject({ kind: "binary", operator: "|", left: { kind: "field", offset: 8 } });
    // After the call, ax is no longer the part's type.
    const reread = [0x8b, 0x44, 4, 0x56, 0xe8, 0x72, 0, 0x59, 0x89, 0x44, 0x10];
    expect(stores(reread, undefined, () => true)).toBeUndefined();
    // The same with the read after the call is exact.
    const after = [0x56, 0xe8, 0x75, 0, 0x59, 0x8b, 0x44, 4, 0x89, 0x44, 0x10];
    expect(stores(after, undefined, () => true)![0]!.value).toMatchObject({ kind: "field", offset: 4 });
  });
});
