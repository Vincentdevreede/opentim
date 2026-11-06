import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { ownerPathStores } from "../src/read/behaviour-owner-paths.ts";

function stores(body: number[], dataSegment?: number) {
  const image = new Uint8Array(0x100);
  // push bp; mov bp, sp; push si; mov si, [bp+6]; ...; pop si; pop bp; retf
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...body, 0x5e, 0x5d, 0xcb]);
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  return ownerPathStores(code, "si", 6, dataSegment);
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
});
