/**
 * Just enough of DOS, the BIOS and the PC around it to run the game: its files, memory blocks, the screen modes it
 * sets, the keyboard, a mouse that never moves and the timer. Everything here answers the game's own requests; the
 * game's code itself runs unchanged in the processor.
 *
 * - Files are read only, from a lookup the caller gives (the game folder and its parent, as the game looks in both).
 * - Memory is a list of blocks from the program's own block up to 640 KB, allocated first fit, freed and resized as DOS
 *   does. Real DOS keeps a header paragraph before each block; leaving it out only moves where blocks start.
 * - File handles are the lowest free ones from 5, as DOS gives them: the C library's file table has room for 20.
 * - The timer interrupt and key presses go through the game's own handlers in the interrupt table. A tick is held back
 *   while another interrupt is still running, as the interrupt controller does.
 */
import { CF, Cpu, CpuStop, IF, type CpuHooks } from "./cpu.ts";
import type { DosProgram } from "./program.ts";

/** Where the BIOS stub that every unused interrupt vector points at lives: a single `iret`. */
const STUB_SEGMENT = 0xf000;
const STUB_OFFSET = 0xff00;
/** The end of conventional memory, as a segment. */
const MEMORY_TOP = 0xa000;
const ZF = 0x0040;

interface Block {
  seg: number;
  size: number;
  free: boolean;
}
interface OpenFile {
  name: string;
  data: Uint8Array;
  pos: number;
}

export interface DosOptions {
  /** The bytes of a file the program opens by name (upper case, without a path), or undefined when there is none. */
  file(name: string): Uint8Array | undefined;
  /** Where the program's PSP goes; the program loads 16 paragraphs above it. */
  psp?: number;
  /** Instructions between two timer ticks. */
  tickEvery?: number;
  /** Gets every request the game makes that this layer doesn't answer, for tracing. */
  onUnknown?(what: string): void;
}

export class Dos implements CpuHooks {
  readonly cpu: Cpu;
  readonly psp: number;
  /** The segment the program's image is loaded at. */
  readonly load: number;
  readonly tickEvery: number;
  private readonly blocks: Block[] = [];
  private readonly files = new Map<number, OpenFile>();
  private readonly options: DosOptions;
  /** The stack pointer at each interrupt the timer or keyboard delivered that hasn't returned yet. */
  private readonly running: number[] = [];
  private scanCode = 0;
  private nextTick: number;
  /** Files the program opened, in order, for tracing. */
  readonly opened: string[] = [];

  constructor(options: DosOptions) {
    this.options = options;
    this.psp = options.psp ?? 0x0ff0;
    this.load = this.psp + 0x10;
    this.tickEvery = options.tickEvery ?? 20_000;
    this.nextTick = this.tickEvery;
    this.cpu = new Cpu(this);
  }

  /** Loads the program as DOS does: PSP, environment, image with its relocations, registers at its entry. */
  start(program: DosProgram): void {
    const cpu = this.cpu;
    cpu.write8(STUB_SEGMENT, STUB_OFFSET, 0xcf);
    for (let vector = 0; vector < 256; vector++) {
      cpu.write16(0, vector * 4, STUB_OFFSET);
      cpu.write16(0, vector * 4 + 2, STUB_SEGMENT);
    }
    // The BIOS data area as a VGA BIOS leaves it: equipment, memory size, text mode 3 with 80 columns and 25 rows.
    cpu.write16(0x40, 0x10, 0x0026);
    cpu.write16(0x40, 0x13, 640);
    cpu.write8(0x40, 0x49, 0x03);
    cpu.write16(0x40, 0x4a, 80);
    cpu.write16(0x40, 0x4c, 0x1000);
    cpu.write16(0x40, 0x63, 0x3d4);
    cpu.write8(0x40, 0x84, 24);
    cpu.write16(0x40, 0x85, 16);
    this.blocks.push({ seg: this.psp, size: MEMORY_TOP - this.psp, free: false });
    cpu.memory.set(program.image, this.load * 16);
    for (const at of program.relocations) {
      const linear = this.load * 16 + at;
      const value = (cpu.memory[linear]! | (cpu.memory[linear + 1]! << 8)) + this.load;
      cpu.memory[linear] = value & 0xff;
      cpu.memory[linear + 1] = (value >> 8) & 0xff;
    }
    cpu.write16(this.psp, 0, 0x20cd);
    cpu.write16(this.psp, 2, MEMORY_TOP);
    cpu.write8(this.psp, 0x80, 0);
    cpu.write8(this.psp, 0x81, 0x0d);
    const environment = this.psp - 0x10;
    const text = "PATH=C:\\\0\0\x01\0C:\\TIM.EXE\0";
    for (let k = 0; k < text.length; k++) cpu.write8(environment, k, text.charCodeAt(k));
    cpu.write16(this.psp, 0x2c, environment);
    cpu.segs[0] = this.psp;
    cpu.segs[3] = this.psp;
    cpu.segs[2] = this.load + program.ss;
    cpu.regs[4] = program.sp;
    cpu.segs[1] = this.load + program.cs;
    cpu.ip = program.ip;
    cpu.flags = 0x0202;
  }

  /** Whether a timer or keyboard interrupt is running. */
  get inInterrupt(): boolean {
    return this.running.length > 0;
  }

  /** Runs one instruction, then delivers a timer tick when one is due. */
  step(): void {
    const cpu = this.cpu;
    cpu.step();
    if (cpu.current!.mnemonic === "iret")
      while (this.running.length && cpu.regs[4]! >= this.running.at(-1)!) this.running.pop();
    if (cpu.steps >= this.nextTick) {
      this.nextTick += this.tickEvery;
      cpu.write16(0x40, 0x6c, cpu.read16(0x40, 0x6c) + 1);
      if (cpu.flag(IF) && !this.inInterrupt) this.hardware(8);
    }
  }

  /** Runs until `stop` says so, or fails after `limit` instructions with `what` in the message. */
  runUntil(stop: () => boolean, limit: number, what: string): void {
    const end = this.cpu.steps + limit;
    while (!stop()) {
      if (this.cpu.steps >= end) throw new CpuStop(`${what}: still running`, this.cpu.linear(this.cpu.cs, this.cpu.ip));
      this.step();
    }
  }

  /** Calls a far routine with the given words as its arguments and runs it to its return, with the timer going. */
  callFar(segment: number, offset: number, args: number[], limit: number, what: string): number {
    const cpu = this.cpu;
    for (const word of [...args].reverse()) cpu.push(word);
    cpu.push(0xffff);
    cpu.push(0);
    cpu.segs[1] = segment;
    cpu.ip = offset;
    this.runUntil(() => cpu.cs === 0xffff && cpu.ip === 0, limit, what);
    cpu.regs[4] = cpu.regs[4]! + args.length * 2;
    return cpu.regs[0]!;
  }

  /** Presses or releases a key through the game's keyboard handler: a make code, or a break code (with 0x80). */
  key(scanCode: number): void {
    this.scanCode = scanCode;
    this.hardware(9);
  }

  private hardware(vector: number): void {
    this.running.push(this.cpu.regs[4]!);
    this.cpu.interrupt(vector, this.cpu.ip);
  }

  portIn(cpu: Cpu, port: number): number {
    // The VGA status register: its retrace bits come and go as the instructions run.
    if (port === 0x3da) return (cpu.steps >> 4) & 0x09;
    if (port === 0x60) return this.scanCode;
    return 0xff;
  }

  interrupt(cpu: Cpu, vector: number): boolean {
    switch (vector) {
      case 0x21:
        return this.dos(cpu);
      case 0x10:
        return this.video(cpu);
      case 0x33:
        return this.mouse(cpu);
      case 0x16: {
        const ah = cpu.register("ah");
        if (ah === 0x01 || ah === 0x11) cpu.setFlag(ZF, true);
        else this.options.onUnknown?.(`int 16 ah=${ah.toString(16)}`);
        return true;
      }
      case 0x1a:
        cpu.regs[1] = 0;
        cpu.regs[2] = cpu.read16(0x40, 0x6c);
        return true;
      case 0x11:
        cpu.regs[0] = cpu.read16(0x40, 0x10);
        return true;
      case 0x12:
        cpu.regs[0] = 640;
        return true;
      default:
        // The timer, the keyboard and anything the game hooked itself go through the interrupt table.
        return false;
    }
  }

  private name(cpu: Cpu): string {
    let text = "";
    for (let k = 0; k < 128; k++) {
      const byte = cpu.read8(cpu.ds, cpu.regs[2]! + k);
      if (!byte) break;
      text += String.fromCharCode(byte);
    }
    return text;
  }

  private dos(cpu: Cpu): boolean {
    const ah = cpu.register("ah"),
      al = cpu.register("al");
    const ok = () => cpu.setFlag(CF, false);
    const fail = (code: number) => {
      cpu.regs[0] = code;
      cpu.setFlag(CF, true);
    };
    const bare = (name: string) => name.toUpperCase().replace(/^.*[\\:]/, "");
    switch (ah) {
      case 0x30:
        cpu.regs[0] = 0x0005;
        cpu.regs[3] = 0;
        cpu.regs[1] = 0;
        break;
      case 0x25:
        cpu.write16(0, al * 4, cpu.regs[2]!);
        cpu.write16(0, al * 4 + 2, cpu.ds);
        break;
      case 0x35:
        cpu.regs[3] = cpu.read16(0, al * 4);
        cpu.segs[0] = cpu.read16(0, al * 4 + 2);
        break;
      case 0x48: {
        const want = cpu.regs[3]!;
        const block = this.blocks.find((b) => b.free && b.size >= want);
        if (!block) {
          cpu.regs[3] = Math.max(0, ...this.blocks.filter((b) => b.free).map((b) => b.size));
          fail(8);
          break;
        }
        if (block.size > want)
          this.blocks.splice(this.blocks.indexOf(block) + 1, 0, {
            seg: block.seg + want,
            size: block.size - want,
            free: true,
          });
        block.size = want;
        block.free = false;
        cpu.regs[0] = block.seg;
        ok();
        break;
      }
      case 0x49: {
        const block = this.blocks.find((b) => b.seg === cpu.es && !b.free);
        if (!block) {
          fail(9);
          break;
        }
        block.free = true;
        this.mergeFree();
        ok();
        break;
      }
      case 0x4a: {
        const block = this.blocks.find((b) => b.seg === cpu.es && !b.free);
        if (!block) {
          fail(9);
          break;
        }
        const want = cpu.regs[3]!;
        const next = this.blocks[this.blocks.indexOf(block) + 1];
        const room = block.size + (next?.free ? next.size : 0);
        if (want > room) {
          cpu.regs[3] = room;
          fail(8);
          break;
        }
        if (next?.free) this.blocks.splice(this.blocks.indexOf(next), 1);
        if (want < room)
          this.blocks.splice(this.blocks.indexOf(block) + 1, 0, {
            seg: block.seg + want,
            size: room - want,
            free: true,
          });
        block.size = want;
        ok();
        break;
      }
      case 0x43: {
        if (this.options.file(bare(this.name(cpu)))) {
          cpu.regs[1] = 0x20;
          ok();
        } else fail(2);
        break;
      }
      case 0x3d: {
        const name = bare(this.name(cpu));
        const data = this.options.file(name);
        this.opened.push(name);
        if (!data) {
          fail(2);
          break;
        }
        let handle = 5;
        while (this.files.has(handle)) handle++;
        this.files.set(handle, { name, data, pos: 0 });
        cpu.regs[0] = handle;
        ok();
        break;
      }
      case 0x3f: {
        const file = this.files.get(cpu.regs[3]!);
        if (!file) {
          cpu.regs[0] = 0;
          ok();
          break;
        }
        const count = Math.max(0, Math.min(cpu.regs[1]!, file.data.length - file.pos));
        for (let k = 0; k < count; k++) cpu.write8(cpu.ds, cpu.regs[2]! + k, file.data[file.pos + k]!);
        file.pos += count;
        cpu.regs[0] = count;
        ok();
        break;
      }
      case 0x40:
        // Writes go nowhere: the game only writes to the console and to files it saves, which a run doesn't keep.
        cpu.regs[0] = cpu.regs[1]!;
        ok();
        break;
      case 0x42: {
        const file = this.files.get(cpu.regs[3]!);
        if (!file) {
          fail(6);
          break;
        }
        const distance = (cpu.regs[1]! << 16) | cpu.regs[2]!;
        file.pos = al === 0 ? distance : al === 1 ? file.pos + distance : file.data.length + distance;
        cpu.regs[0] = file.pos & 0xffff;
        cpu.regs[2] = (file.pos >>> 16) & 0xffff;
        ok();
        break;
      }
      case 0x3e:
        this.files.delete(cpu.regs[3]!);
        ok();
        break;
      case 0x44:
        // Device information: the standard handles are the console, everything else a file on drive C.
        if (al === 0) cpu.regs[2] = cpu.regs[3]! <= 2 ? 0x80d3 : 0x0002;
        ok();
        break;
      case 0x4c:
        throw new CpuStop(`the program ended with code ${al}`, cpu.linear(cpu.cs, cpu.ip));
      case 0x19:
        cpu.setRegister("al", 2);
        break;
      case 0x0e:
        cpu.setRegister("al", 3);
        break;
      case 0x3b:
      case 0x1a:
      case 0x2f:
        ok();
        break;
      case 0x47:
        cpu.write8(cpu.ds, cpu.regs[6]!, 0);
        ok();
        break;
      case 0x2a:
        cpu.regs[1] = 1994;
        cpu.regs[2] = 0x0101;
        cpu.setRegister("al", 6);
        break;
      case 0x2c:
        cpu.regs[1] = 0;
        cpu.regs[2] = 0;
        break;
      case 0x33:
        cpu.setRegister("dl", 0);
        break;
      case 0x62:
        cpu.regs[3] = this.psp;
        break;
      case 0x4e:
      case 0x4f:
        fail(18);
        break;
      default:
        this.options.onUnknown?.(`int 21 ah=${ah.toString(16)} al=${al.toString(16)}`);
        ok();
    }
    return true;
  }

  private mergeFree(): void {
    for (let k = this.blocks.length - 2; k >= 0; k--)
      if (this.blocks[k]!.free && this.blocks[k + 1]!.free) {
        this.blocks[k]!.size += this.blocks[k + 1]!.size;
        this.blocks.splice(k + 1, 1);
      }
  }

  private video(cpu: Cpu): boolean {
    const ah = cpu.register("ah"),
      al = cpu.register("al");
    if (ah === 0x00) {
      const mode = al & 0x7f;
      cpu.write8(0x40, 0x49, mode);
      cpu.write16(0x40, 0x4a, mode === 0x13 ? 40 : 80);
      cpu.write8(0x40, 0x84, mode === 0x12 || mode === 0x11 ? 29 : 24);
    } else if (ah === 0x0f) {
      cpu.setRegister("al", cpu.read8(0x40, 0x49));
      cpu.setRegister("ah", cpu.read16(0x40, 0x4a));
    } else if (ah === 0x1a) {
      // A VGA with a colour display.
      cpu.setRegister("al", 0x1a);
      cpu.setRegister("bl", 8);
    }
    return true;
  }

  private mouse(cpu: Cpu): boolean {
    switch (cpu.regs[0]) {
      case 0x00:
        // Installed, with two buttons.
        cpu.regs[0] = 0xffff;
        cpu.regs[3] = 2;
        break;
      case 0x03:
        // No buttons pressed, in the middle of a 320 by 200 grid.
        cpu.regs[3] = 0;
        cpu.regs[1] = 160;
        cpu.regs[2] = 100;
        break;
    }
    return true;
  }
}
