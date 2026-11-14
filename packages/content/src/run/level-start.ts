/**
 * Loads a level and starts its puzzle with the game's own code, for the games whose program the emulator can't start
 * whole: TOONS.EXE and TIM2.EXE ask for EMS memory, so they don't start under `Dos`. Instead the program is laid out
 * with its overlays (`readToonsMemory`) on a bare `Cpu`, and only the routines the level needs run: the level loader,
 * then the routines the game calls when a puzzle starts. Everything else in them runs as it is.
 *
 * Standing in, because nothing set them up before:
 *
 * - the game's own `fopen`, which looks a name up in the resource files: it gives the level as a C library file whose
 *   buffer is empty, so the library's own `fread` and `getc` fill it through DOS (int 21h, function 3Fh), which reads
 *   the level's bytes. Any other name, like a part's picture, can't be opened, as when a file is missing;
 * - the game's memory routines: the near `calloc` and the far allocation by a size and flags, which give zeroed memory,
 *   and their `free`, which does nothing;
 * - DOS's memory blocks (int 21h, functions 48h to 4Ah), the overlay manager (int 3Fh, which jumps to the routine the
 *   stub names) and the ports (read as 0).
 *
 * The overlays are laid 64 KB above the data segment's start, because the data segment runs past the load image: its
 * heap and stack are there.
 */
import type { ToonsMemory } from "../read/toons-drawing.ts";
import { Cpu, CpuStop } from "./cpu.ts";

const CF = 0x0001;

export interface FarAddress {
  segment: number;
  offset: number;
}

/** A routine to call with its words: a number, or `name` for the level's name in the data segment. */
export interface StartCall extends FarAddress {
  args: (number | "name")[];
}

/** What a game needs to load a level and start its puzzle, as found in its program (`level-start-find.ts`). */
export interface GameStart {
  game: "toons" | "tim2";
  /** The size of a part record. */
  partSize: number;
  /** Whether the lists link their parts by far pointers (TIM 2) or near ones in the data segment (Toons). */
  far: boolean;
  /** The words of the data segment that hold the first part of each list. */
  lists: { moving: number; fixed: number; bin: number };
  /** The word that holds the far pointer to the loader's table of parts, in the file's order. */
  pool: number;
  /** Routines the game runs once when it starts, before any level: TIM 2 makes its store of part records there. */
  setup: StartCall[];
  /** The level loader, called with the level's name. */
  loader: FarAddress;
  /** The routines the game runs when a puzzle starts, in order; the first loads the level by its name. */
  start: StartCall[];
  /** The library routines the runner stands in for. */
  stands: {
    open: FarAddress;
    calloc?: FarAddress;
    alloc?: FarAddress;
    free: FarAddress[];
  };
}

/** The game's parts at one moment: each list as the record addresses in its order, and every record's bytes. */
export interface GameParts {
  lists: { moving: number[]; fixed: number[]; bin: number[] };
  /** The record of each part of the file, by its index, as the loader's table holds it (0 when it has none). */
  pool: number[];
  records: Map<number, Uint8Array>;
  /** The word another record holds to point at each part, by its index: the near offset, or a far pointer's offset. */
  pointers: number[];
  /** The memory below 640 KB, for what the records point at. */
  memory: Uint8Array;
}

export interface LevelStartRun {
  /** The parts right after the level loader. */
  loaded: GameParts;
  /** The parts after the puzzle start (the loaded ones when it wasn't run). */
  started: GameParts;
  /** The requests the runner doesn't answer, like an interrupt nothing handles, with how many times. */
  unknown: Map<string, number>;
}

/** Where things go in the data segment: a C library file record, the level's name, and the top of the stack. */
const FILE_AT = 0xe000;
const NAME_AT = 0xe100;
const STACK_TOP = 0xfff0;
/** The handle the level's file gets. */
const HANDLE = 5;
/** Borland's file flags: open for reading, binary. */
const FILE_FLAGS = 0x0041;
/** The far memory the stand-in allocation gives out, and then the memory DOS gives out in blocks, as linear addresses. */
const FAR_FROM = 0x80000;
const BLOCKS_FROM = 0x90000;
const MEMORY_TOP = 0xa0000;
const LIMIT = 50_000_000;

/** The program laid out on a processor, ready to load levels: `clean` is its memory before any level. */
export class GameMachine {
  readonly cpu: Cpu;
  readonly start: GameStart;
  private readonly program: ToonsMemory;
  private readonly imageEnd: number;
  private readonly shift: number;
  private readonly clean: Uint8Array;
  private readonly stands = new Map<number, () => void>();
  private level: Uint8Array = new Uint8Array();
  private position = 0;
  private name = "";
  private near = 0;
  private far = FAR_FROM;
  private blocks = BLOCKS_FROM >> 4;
  /** Where the memory the stand-ins give out stood after the start-up routines. */
  private after = { near: 0, far: FAR_FROM, blocks: BLOCKS_FROM >> 4 };
  readonly unknown = new Map<string, number>();

  /**
   * `heapFrom` is the first offset of the data segment past the program's own data and start-up stack, where the near
   * `calloc` gives out memory.
   */
  constructor(program: ToonsMemory, start: GameStart, heapFrom: number) {
    this.program = program;
    this.start = start;
    this.imageEnd = program.overlays.length ? program.overlays[0]! * 16 : program.memory.length;
    const overlaysAt = (program.dataSegment + 0x1000) * 16;
    this.shift = Math.max(0, overlaysAt - this.imageEnd);
    const cpu = new Cpu({
      interrupt: (c, vector) => this.interrupt(c, vector),
      portIn: () => 0,
      portOut: () => {},
    });
    this.cpu = cpu;
    cpu.memory.set(program.memory.subarray(0, this.imageEnd));
    cpu.memory.set(program.memory.subarray(this.imageEnd), this.imageEnd + this.shift);
    const at = (a: FarAddress) => this.linear(a);
    this.stands.set(at(start.stands.open), () => this.open());
    if (start.stands.calloc) this.stands.set(at(start.stands.calloc), () => this.calloc());
    if (start.stands.alloc) this.stands.set(at(start.stands.alloc), () => this.alloc());
    for (const free of start.stands.free) this.stands.set(at(free), () => this.return(0));
    this.near = heapFrom;
    for (const call of start.setup) this.call(call);
    this.clean = cpu.memory.slice();
    this.after = { near: this.near, far: this.far, blocks: this.blocks };
  }

  /** Where a routine runs: an overlay's routines run 64 KB above the data segment. */
  private segmentOf(segment: number): number {
    return segment * 16 >= this.imageEnd ? segment + this.shift / 16 : segment;
  }
  private linear(a: FarAddress): number {
    return this.segmentOf(a.segment) * 16 + a.offset;
  }

  private get data() {
    return this.program.dataSegment;
  }
  private arg(k: number): number {
    return this.cpu.read16(this.cpu.ss, this.cpu.regs[4]! + 4 + 2 * k);
  }
  /** Leaves a far routine as `retf` does, with `dx:ax`. */
  private return(ax: number, dx = 0): void {
    const cpu = this.cpu;
    cpu.regs[0] = ax & 0xffff;
    cpu.regs[2] = dx & 0xffff;
    cpu.ip = cpu.pop();
    cpu.segs[1] = cpu.pop();
  }
  private note(what: string): void {
    this.unknown.set(what, (this.unknown.get(what) ?? 0) + 1);
  }

  private open(): void {
    let text = "";
    for (
      let k = 0, c = this.cpu.read8(this.data, this.arg(0));
      c && k < 80;
      c = this.cpu.read8(this.data, this.arg(0) + ++k)
    )
      text += String.fromCharCode(c);
    if (text.toUpperCase() !== this.name.toUpperCase()) return this.return(0);
    this.position = 0;
    const cpu = this.cpu;
    for (let k = 0; k < 16; k++) cpu.write8(this.data, FILE_AT + k, 0);
    // level, flags, handle, hold, buffer size, buffer, current place, temporary, token: the buffer comes with setbuf.
    cpu.write16(this.data, FILE_AT + 2, FILE_FLAGS);
    cpu.write8(this.data, FILE_AT + 4, HANDLE);
    cpu.write16(this.data, FILE_AT + 14, FILE_AT);
    this.return(FILE_AT);
  }
  private calloc(): void {
    const size = this.arg(0) * this.arg(1);
    const at = this.near;
    if (at + size > FILE_AT) return this.return(0);
    this.near = (at + size + 1) & ~1;
    for (let k = 0; k < size; k++) this.cpu.write8(this.data, at + k, 0);
    this.return(at);
  }
  private alloc(): void {
    const size = this.arg(0) + this.arg(1) * 0x10000;
    const at = this.far;
    if (at + size > BLOCKS_FROM) return this.return(0);
    this.far = (at + size + 15) & ~15;
    this.cpu.memory.fill(0, at, at + size);
    this.return(at & 15, at >> 4);
  }

  private interrupt(cpu: Cpu, vector: number): boolean {
    if (vector === 0x3f) {
      const to = this.program.resolve(cpu.cs, (cpu.ip - 2) & 0xffff);
      cpu.segs[1] = this.segmentOf(to.segment);
      cpu.ip = to.offset;
      return true;
    }
    const ah = cpu.regs[0]! >> 8;
    const ok = (ax = cpu.regs[0]!) => {
      cpu.regs[0] = ax;
      cpu.flags &= ~CF;
      return true;
    };
    if (vector === 0x21) {
      if (ah === 0x3f && cpu.regs[3] === HANDLE) {
        const n = Math.min(cpu.regs[1]!, this.level.length - this.position);
        for (let k = 0; k < n; k++) cpu.write8(cpu.ds, cpu.regs[2]! + k, this.level[this.position++]!);
        return ok(n);
      }
      if (ah === 0x3e || ah === 0x44) {
        cpu.regs[2] = 0;
        return ok(0);
      }
      if (ah === 0x48) {
        const size = cpu.regs[3]!;
        if ((this.blocks + size) * 16 > MEMORY_TOP) {
          cpu.regs[3] = 0;
          cpu.regs[0] = 8;
          cpu.flags |= CF;
          return true;
        }
        const segment = this.blocks;
        this.blocks += size;
        return ok(segment);
      }
      if (ah === 0x49 || ah === 0x4a) return ok();
    }
    this.note(`int ${vector.toString(16)}${vector === 0x21 ? ` function ${ah.toString(16)}` : ""}`);
    cpu.flags |= CF;
    return true;
  }

  /** Calls a routine and runs it back, standing in for the library routines on the way. */
  private call(call: StartCall): void {
    const cpu = this.cpu;
    cpu.segs[0] = this.data;
    cpu.segs[2] = this.data;
    cpu.segs[3] = this.data;
    cpu.regs[4] = STACK_TOP;
    for (const value of [...call.args].reverse()) cpu.push(value === "name" ? NAME_AT : value);
    cpu.push(0xffff);
    cpu.push(0);
    cpu.segs[1] = this.segmentOf(call.segment);
    cpu.ip = call.offset;
    const end = cpu.steps + LIMIT;
    while (!(cpu.cs === 0xffff && cpu.ip === 0)) {
      const stand = this.stands.get(cpu.cs * 16 + cpu.ip);
      if (stand) {
        stand();
        continue;
      }
      if (cpu.steps >= end) throw new CpuStop(`still running after ${LIMIT} instructions`, cpu.cs * 16 + cpu.ip);
      cpu.step();
    }
  }

  /** The lists, the loader's table and the records as they are now. */
  private parts(count: number): GameParts {
    const cpu = this.cpu;
    const data = this.data * 16;
    const word = (at: number) => cpu.memory[at]! | (cpu.memory[at + 1]! << 8);
    const pointer = (at: number) => (this.start.far ? word(at + 2) * 16 + word(at) : word(at) && data + word(at));
    const chain = (head: number) => {
      const out: number[] = [];
      for (let at = pointer(data + head); at && out.length < 1000; at = pointer(at)) out.push(at);
      return out;
    };
    const lists = {
      moving: chain(this.start.lists.moving),
      fixed: chain(this.start.lists.fixed),
      bin: chain(this.start.lists.bin),
    };
    const table = word(data + this.start.pool + 2) * 16 + word(data + this.start.pool);
    const step = this.start.far ? 4 : 2;
    const pool = Array.from({ length: count }, (_, k) => (table ? pointer(table + k * step) : 0));
    const records = new Map<number, Uint8Array>();
    for (const at of [...pool, ...lists.moving, ...lists.fixed, ...lists.bin])
      if (at && !records.has(at)) records.set(at, cpu.memory.slice(at, at + this.start.partSize));
    const pointers = Array.from({ length: count }, (_, k) => (table ? word(table + k * step) : 0));
    return { lists, pool, records, pointers, memory: cpu.memory.slice(0, 0xa0000) };
  }

  private reset(level: Uint8Array, name: string): void {
    this.cpu.memory.set(this.clean);
    this.level = level;
    this.name = name;
    this.position = 0;
    this.near = this.after.near;
    this.far = this.after.far;
    this.blocks = this.after.blocks;
    for (let k = 0; k <= name.length; k++)
      this.cpu.write8(this.data, NAME_AT + k, k < name.length ? name.charCodeAt(k) : 0);
  }

  /**
   * Loads `level` (the bytes of the file called `name`) with the game's loader, and again from the start with the
   * puzzle start (`calls`, the game's own unless given; none leaves `started` out); `count` is the number of parts in
   * the file, for the loader's table.
   */
  run(level: Uint8Array, name: string, count: number, calls: StartCall[] | null = this.start.start): LevelStartRun {
    this.unknown.clear();
    this.reset(level, name);
    this.call({ ...this.start.loader, args: ["name"] });
    const loaded = this.parts(count);
    let started = loaded;
    if (calls) {
      this.reset(level, name);
      for (const call of calls) this.call(call);
      started = this.parts(count);
    }
    return { loaded, started, unknown: new Map(this.unknown) };
  }
}

/**
 * The first offset of the data segment past the program's own data and its start-up stack, from the program's header:
 * the stack the start-up code begins with lies at the end of the load image.
 */
export function heapStart(exe: Uint8Array, dataSegment: number): number {
  const word = (at: number) => exe[at]! | (exe[at + 1]! << 8);
  const top = word(0x0e) * 16 + word(0x10);
  return (top - dataSegment * 16 + 0xff) & ~0xff;
}
