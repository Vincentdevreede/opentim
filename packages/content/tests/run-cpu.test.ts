import { describe, expect, it } from "vitest";
import { CF, Cpu, CpuStop, OF, SF, ZF } from "../src/run/cpu.ts";

/** A processor with `bytes` at 0x1000:0000 and a stack at 0x2000:fffe, run until the code reaches its last byte. */
function run(bytes: number[], setup: (cpu: Cpu) => void = () => {}, hooks: ConstructorParameters<typeof Cpu>[0] = {}) {
  const cpu = new Cpu(hooks);
  cpu.memory.set([...bytes, 0xf4], 0x10000);
  cpu.segs[1] = 0x1000;
  cpu.segs[3] = 0x3000;
  cpu.segs[0] = 0x3000;
  cpu.segs[2] = 0x2000;
  cpu.regs[4] = 0xfffe;
  setup(cpu);
  cpu.runUntil(0x1000, bytes.length, 10_000);
  return cpu;
}

describe("the processor", () => {
  it("adds 1 to 10 in a loop", () => {
    // xor ax, ax; mov cx, 10; l: add ax, cx; loop l
    const cpu = run([0x31, 0xc0, 0xb9, 10, 0, 0x01, 0xc8, 0xe2, 0xfc]);
    expect(cpu.regs[0]).toBe(55);
    expect(cpu.regs[1]).toBe(0);
  });

  it("sets the carry, overflow, zero and sign flags as an 8086 does", () => {
    // mov ax, 0x7fff; add ax, 1
    let cpu = run([0xb8, 0xff, 0x7f, 0x05, 1, 0]);
    expect(cpu.regs[0]).toBe(0x8000);
    expect(cpu.flag(OF)).toBe(true);
    expect(cpu.flag(SF)).toBe(true);
    expect(cpu.flag(CF)).toBe(false);
    // mov ax, 0; sub ax, 1
    cpu = run([0xb8, 0, 0, 0x2d, 1, 0]);
    expect(cpu.regs[0]).toBe(0xffff);
    expect(cpu.flag(CF)).toBe(true);
    expect(cpu.flag(OF)).toBe(false);
    // mov ax, 5; cmp ax, 5
    cpu = run([0xb8, 5, 0, 0x3d, 5, 0]);
    expect(cpu.flag(ZF)).toBe(true);
  });

  it("branches on signed and unsigned comparisons", () => {
    // mov ax, -2; cmp ax, 1; jl +3; mov bx, 1; (skipped) ... mov cx, 7
    const cpu = run([0xb8, 0xfe, 0xff, 0x3d, 1, 0, 0x7c, 3, 0xbb, 1, 0, 0xb9, 7, 0]);
    expect(cpu.regs[3]).toBe(0);
    expect(cpu.regs[1]).toBe(7);
    // mov ax, -2; cmp ax, 1; jb +3 is not taken (0xfffe is above 1 unsigned)
    const unsigned = run([0xb8, 0xfe, 0xff, 0x3d, 1, 0, 0x72, 3, 0xbb, 1, 0]);
    expect(unsigned.regs[3]).toBe(1);
  });

  it("multiplies and divides, signed and unsigned", () => {
    // mov ax, -300; mov bx, 200; imul bx  (dx:ax = -60000)
    let cpu = run([0xb8, 0xd4, 0xfe, 0xbb, 200, 0, 0xf7, 0xeb]);
    expect((cpu.regs[2]! << 16) | cpu.regs[0]!).toBe(-60000);
    // mov dx, 0xffff; mov ax, 0x15a0 (-60000); mov bx, 7; idiv bx  (-8571 remainder -3)
    cpu = run([0xba, 0xff, 0xff, 0xb8, 0xa0, 0x15, 0xbb, 7, 0, 0xf7, 0xfb]);
    expect(cpu.regs[0]).toBe(-8571 & 0xffff);
    expect(cpu.regs[2]).toBe(-3 & 0xffff);
    // mov ax, 40000; mov bx, 3; mul bx  (120000)
    cpu = run([0xb8, 0x40, 0x9c, 0xbb, 3, 0, 0xf7, 0xe3]);
    expect(cpu.regs[2]! * 0x10000 + cpu.regs[0]!).toBe(120000);
    // mov bx, -7; imul ax, bx, 6
    cpu = run([0xbb, 0xf9, 0xff, 0x6b, 0xc3, 6]);
    expect(cpu.regs[0]).toBe(-42 & 0xffff);
    // mov ax, 1; xor bx, bx; div bx
    expect(() => run([0xb8, 1, 0, 0x31, 0xdb, 0xf7, 0xf3])).toThrow(CpuStop);
  });

  it("shifts and rotates", () => {
    // mov ax, 0x8001; shl ax, 1
    let cpu = run([0xb8, 1, 0x80, 0xd1, 0xe0]);
    expect(cpu.regs[0]).toBe(2);
    expect(cpu.flag(CF)).toBe(true);
    // mov ax, -64; sar ax, 3
    cpu = run([0xb8, 0xc0, 0xff, 0xc1, 0xf8, 3]);
    expect(cpu.regs[0]).toBe(-8 & 0xffff);
    // mov ax, 0x1234; mov cl, 4; rol ax, cl
    cpu = run([0xb8, 0x34, 0x12, 0xb1, 4, 0xd3, 0xc0]);
    expect(cpu.regs[0]).toBe(0x2341);
    // stc; mov ax, 0; rcl ax, 1
    cpu = run([0xf9, 0xb8, 0, 0, 0xd1, 0xd0]);
    expect(cpu.regs[0]).toBe(1);
  });

  it("copies and compares strings", () => {
    const cpu = run(
      // cld; mov si, 0; mov di, 0x100; mov cx, 3; rep movsw; mov si, 0; mov di, 0x100; mov cx, 6; repe cmpsb
      [0xfc, 0xbe, 0, 0, 0xbf, 0, 1, 0xb9, 3, 0, 0xf3, 0xa5, 0xbe, 0, 0, 0xbf, 0, 1, 0xb9, 6, 0, 0xf3, 0xa6],
      (c) => c.memory.set([1, 2, 3, 4, 5, 6], 0x30000),
    );
    expect([...cpu.memory.subarray(0x30100, 0x30106)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cpu.regs[1]).toBe(0);
    expect(cpu.flag(ZF)).toBe(true);
  });

  it("reads and writes memory through a segment and a base", () => {
    // mov bx, 0x10; mov word [bx+2], 0xbeef; les di, [bx+2]  (es:di from the dword at 0x12)
    const cpu = run([0xbb, 0x10, 0, 0xc7, 0x47, 2, 0xef, 0xbe, 0xc4, 0x7f, 2], (c) =>
      c.memory.set([0, 0, 0x34, 0x12], 0x30012),
    );
    expect(cpu.regs[7]).toBe(0xbeef);
    expect(cpu.es).toBe(0x1234);
  });

  it("runs code in its new form after the code changes it", () => {
    // mov cx, 2; l: inc ax; mov byte cs:[3], 0x48 (makes the inc a dec); loop l
    const cpu = run([0xb9, 2, 0, 0x40, 0x2e, 0xc6, 0x06, 3, 0, 0x48, 0xe2, 0xf7]);
    expect(cpu.regs[0]).toBe(0);
  });

  it("runs an instruction that wraps past the end of its segment in its new form after the code changes it", () => {
    // mov al, 1 at 1000:ffff, whose immediate wraps round to 1000:0000.
    const cpu = new Cpu();
    cpu.memory[0x1ffff] = 0xb0;
    cpu.memory[0x10000] = 1;
    cpu.segs[1] = 0x1000;
    cpu.ip = 0xffff;
    cpu.runUntil(0x1000, 1, 10);
    expect(cpu.regs[0]! & 0xff).toBe(1);
    cpu.write8(0x1000, 0, 2);
    cpu.ip = 0xffff;
    cpu.runUntil(0x1000, 1, 10);
    expect(cpu.regs[0]! & 0xff).toBe(2);
  });

  it("calls a far routine with its arguments and comes back", () => {
    const cpu = new Cpu();
    // push bp; mov bp, sp; mov ax, [bp+6]; add ax, [bp+8]; pop bp; retf
    cpu.memory.set([0x55, 0x89, 0xe5, 0x8b, 0x46, 6, 0x03, 0x46, 8, 0x5d, 0xcb], 0x10000);
    cpu.segs[2] = 0x2000;
    cpu.regs[4] = 0xfffe;
    expect(cpu.callFar(0x1000, 0, [40, 2])).toBe(42);
    expect(cpu.regs[4]).toBe(0xfffe);
  });

  it("gives interrupts to the hook, or to the interrupt table", () => {
    const seen: number[] = [];
    // int 0x21; int 0x60
    const cpu = run(
      [0xcd, 0x21, 0xcd, 0x60],
      (c) => {
        // The table sends 0x60 to 0x1100:0000: mov dx, 9; iret
        c.memory.set([0xba, 9, 0, 0xcf], 0x11000);
        c.write16(0, 0x60 * 4, 0);
        c.write16(0, 0x60 * 4 + 2, 0x1100);
      },
      {
        interrupt: (c, vector) => {
          seen.push(vector);
          if (vector !== 0x21) return false;
          c.regs[0] = 0x4c00;
          return true;
        },
      },
    );
    expect(seen).toEqual([0x21, 0x60]);
    expect(cpu.regs[0]).toBe(0x4c00);
    expect(cpu.regs[2]).toBe(9);
  });
});
