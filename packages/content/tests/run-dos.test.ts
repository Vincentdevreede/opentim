import { describe, expect, it } from "vitest";
import { CF } from "../src/run/cpu.ts";
import { Dos } from "../src/run/dos.ts";
import { readLzexeProgram } from "../src/run/program.ts";

/** A DOS with one file, and a way to call int 21h with registers set. */
function dos(files: Record<string, number[]> = {}) {
  const d = new Dos({ file: (name) => (files[name] ? Uint8Array.from(files[name]) : undefined) });
  d.start({ image: new Uint8Array(0x100), relocations: [], cs: 0, ip: 0, ss: 0, sp: 0x100 });
  const cpu = d.cpu;
  const call = (ah: number, set: Partial<Record<"al" | "bx" | "cx" | "dx" | "es" | "ds", number>> = {}) => {
    cpu.setRegister("ah", ah);
    for (const [name, value] of Object.entries(set)) cpu.setRegister(name, value);
    d.interrupt(cpu, 0x21);
    return { ax: cpu.regs[0]!, bx: cpu.regs[3]!, carry: cpu.flag(CF) };
  };
  return { d, cpu, call };
}

describe("the DOS the game runs on", () => {
  it("allocates first fit, frees and reuses memory, and grows a block into free memory after it", () => {
    const { d, call } = dos();
    // The program's block holds everything; shrink it first, as a program's start-up does.
    expect(call(0x4a, { es: d.psp, bx: 0x1000 }).carry).toBe(false);
    const a = call(0x48, { bx: 0x100 });
    const b = call(0x48, { bx: 0x200 });
    expect(a.carry).toBe(false);
    expect(b.ax).toBe(a.ax + 0x100);
    expect(call(0x49, { es: a.ax }).carry).toBe(false);
    // The freed block is used again for a request that fits.
    expect(call(0x48, { bx: 0x80 }).ax).toBe(a.ax);
    // Asking for everything fails and says how much the largest free block has.
    const all = call(0x48, { bx: 0xffff });
    expect(all.carry).toBe(true);
    expect(all.bx).toBe(0xa000 - (b.ax + 0x200));
    // A block grows into the free memory after it.
    expect(call(0x4a, { es: b.ax, bx: 0x400 }).carry).toBe(false);
    expect(call(0x48, { bx: 0x10 }).ax).toBe(a.ax + 0x80);
  });

  it("opens, reads, seeks and closes files, with the lowest free handle", () => {
    const { cpu, call } = dos({ "LEVEL.DAT": [1, 2, 3, 4, 5, 6] });
    const name = (text: string) => {
      for (let k = 0; k <= text.length; k++) cpu.write8(0x3000, k, k < text.length ? text.charCodeAt(k) : 0);
    };
    name("C:\\GAME\\level.dat");
    const first = call(0x3d, { al: 0, ds: 0x3000, dx: 0 });
    expect(first).toMatchObject({ ax: 5, carry: false });
    const second = call(0x3d, { al: 0, ds: 0x3000, dx: 0 });
    expect(second.ax).toBe(6);
    expect(call(0x42, { al: 0, bx: 5, cx: 0, dx: 2 }).ax).toBe(2);
    expect(call(0x3f, { bx: 5, cx: 10, ds: 0x3000, dx: 0x100 }).ax).toBe(4);
    expect([...cpu.memory.subarray(0x30100, 0x30104)]).toEqual([3, 4, 5, 6]);
    call(0x3e, { bx: 5 });
    // The closed handle is the next one given.
    expect(call(0x3d, { al: 0, ds: 0x3000, dx: 0 }).ax).toBe(5);
    name("MISSING.DAT");
    expect(call(0x3d, { al: 0, ds: 0x3000, dx: 0 })).toMatchObject({ ax: 2, carry: true });
  });

  it("delivers a timer tick through the program's own handler, and none while it still runs", () => {
    const d = new Dos({ file: () => undefined, tickEvery: 4 });
    // At 0x100: a loop of inc dx; jmp back. The handler at 0x200: inc bx; iret.
    const image = new Uint8Array(0x300);
    image.set([0x42, 0xeb, 0xfd], 0x100);
    image.set([0x43, 0xcf], 0x200);
    d.start({ image, relocations: [], cs: 0, ip: 0x100, ss: 0, sp: 0x2fe });
    d.cpu.write16(0, 8 * 4, 0x200);
    d.cpu.write16(0, 8 * 4 + 2, d.load);
    // 42 steps: the tick after step 40 has run its two instructions.
    for (let k = 0; k < 42; k++) d.step();
    expect(d.cpu.regs[3]).toBeGreaterThanOrEqual(8);
    expect(d.inInterrupt).toBe(false);
  });

  it("reads an LZEXE program's relocations and entry point", () => {
    // A minimal LZEXE 0.91 file: header, packed image of one copied byte, stub with the entry words and relocations.
    const exe = new Uint8Array(0x400);
    const view = new DataView(exe.buffer);
    view.setUint16(0, 0x5a4d, true);
    view.setUint16(8, 2, true); // header paragraphs
    exe.set(
      [..."LZ91"].map((c) => c.charCodeAt(0)),
      0x1c,
    );
    view.setUint16(0x16, 1, true); // the stub's paragraph in the load module
    // Packed data at 0x20: bits 1 (copy), then 0,1 with a long match of length 0 meaning the end.
    exe.set([0x05, 0x00, 0xaa, 0x00, 0x00, 0x00], 0x20);
    // The stub at 0x30: ip, cs, sp, ss; relocations at +0x158: spans 4 and 0x10, then the end mark.
    view.setUint16(0x30, 0x0010, true);
    view.setUint16(0x32, 0x0002, true);
    view.setUint16(0x34, 0x0200, true);
    view.setUint16(0x36, 0x0003, true);
    exe.set([4, 0x10, 0, 1, 0], 0x30 + 0x158);
    const program = readLzexeProgram(exe);
    expect(program).toMatchObject({ ip: 0x10, cs: 2, sp: 0x200, ss: 3, relocations: [4, 0x14] });
    // A file cut off before the relocation table's end mark, or one that isn't packed with LZEXE, fails at once.
    expect(() => readLzexeProgram(exe.subarray(0, 0x30 + 0x158 + 2))).toThrow("The relocation table ends too early");
    const other = exe.slice();
    other.set([0, 0, 0, 0], 0x1c);
    expect(() => readLzexeProgram(other)).toThrow("Not packed with LZEXE 0.91");
  });
});
