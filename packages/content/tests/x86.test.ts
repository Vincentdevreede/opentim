import { describe, expect, it } from "vitest";
import { decodeInstruction } from "../src/read/x86.ts";

const decode = (...bytes: number[]) => decodeInstruction(Uint8Array.from(bytes), 0);

describe("the 16-bit instruction decoder", () => {
  it("decodes state writes with their bytes and operands", () => {
    const instruction = decode(0xc7, 0x44, 0x0c, 0x01, 0x00);
    expect(instruction.text).toBe("mov word [si+0x0c], 0x0001");
    expect(instruction.bytes).toEqual([0xc7, 0x44, 0x0c, 0x01, 0x00]);
    expect(instruction.operands).toEqual([
      { kind: "memory", width: 16, segment: "ds", base: ["si"], displacement: 12, direct: false },
      { kind: "immediate", width: 16, value: 1 },
    ]);
  });

  it("reads signed displacements and selects the stack segment for BP", () => {
    expect(decode(0x8b, 0x46, 0xfe).operands[1]).toEqual({
      kind: "memory",
      width: 16,
      segment: "ss",
      base: ["bp"],
      displacement: -2,
      direct: false,
    });
    expect(decode(0x26, 0x8b, 0x86, 0x00, 0xff).text).toBe("mov ax, word es:[bp-0x100]");
  });

  it("reads far pointer loads and direct and indirect transfers", () => {
    expect(decode(0xc4, 0x76, 0x06).text).toBe("les si, dword [bp+0x06]");
    expect(decode(0x9a, 0x34, 0x12, 0x78, 0x56)).toMatchObject({
      flow: "call",
      far: true,
      target: { segment: 0x5678, offset: 0x1234, address: 0x579b4 },
    });
    expect(decode(0xff, 0x1e, 0x34, 0x12)).toMatchObject({ flow: "call", far: true, text: "call dword [0x1234]" });
    expect(decode(0xff, 0xe0)).toMatchObject({ flow: "jump", text: "jmp ax" });
  });

  it("sign extends immediate arithmetic and decodes counters and flag tests", () => {
    expect(decode(0x83, 0x44, 0x0c, 0xff).text).toBe("add word [si+0x0c], -0x0001");
    expect(decode(0xff, 0x84, 0x96, 0x00).text).toBe("inc word [si+0x96]");
    expect(decode(0xf7, 0x44, 0x06, 0x00, 0x10).text).toBe("test word [si+0x06], 0x1000");
  });

  it("resolves relative branches in their code segment and wraps IP", () => {
    const image = new Uint8Array(0x10100);
    image.set([0x75, 0xfc], 0x100fe);
    expect(decodeInstruction(image, 0x100fe, 0x10).target).toEqual({ segment: 0x10, offset: 0xfffc, address: 0x100fc });
    image[0x100ff] = 0xe9;
    image[0x100] = 0x00;
    image[0x101] = 0x00;
    expect(decodeInstruction(image, 0x100ff, 0x10)).toMatchObject({
      bytes: [0xe9, 0, 0],
      target: { segment: 0x10, offset: 2, address: 0x102 },
    });
  });

  it("distinguishes returns, loops, string operations and timer port writes", () => {
    expect(decode(0xca, 0x04, 0x00)).toMatchObject({ flow: "return", text: "retf 0x0004" });
    expect(decode(0xe2, 0xfe)).toMatchObject({ flow: "branch", mnemonic: "loop", target: { address: 0 } });
    expect(decode(0xf3, 0xa5).text).toBe("rep movsw");
    expect(decode(0xe6, 0x43).text).toBe("out 0x43, al");
  });

  it("stops on unknown, invalid, truncated and overlong instructions with the address", () => {
    expect(() => decode(0x66)).toThrow(/x86 at 0x0000.*unsupported opcode 0x66/);
    expect(() => decode(0xc7, 0x4c, 0x0c, 0, 0)).toThrow(/invalid MOV/);
    expect(() => decode(0xff, 0xd8)).toThrow(/far transfer requires a memory/);
    expect(() => decode(0xc4, 0xf0)).toThrow(/far pointer load requires a memory/);
    expect(() => decode(0xb8, 1)).toThrow(/truncated instruction/);
    expect(() => decode(...new Array<number>(16).fill(0x26))).toThrow(/exceeds 15 bytes/);
  });
});
