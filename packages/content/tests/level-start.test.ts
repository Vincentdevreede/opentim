import { describe, expect, it } from "vitest";
import type { ToonsMemory } from "../src/read/toons-drawing.ts";
import { findGameStart } from "../src/run/level-start-find.ts";
import { GameMachine, heapStart, type GameStart } from "../src/run/level-start.ts";

const CODE = 0x0100;
const DATA = 0x2000;

/** A program with `routines` in a code segment at 0x0100 and a data segment at 0x2000, laid out as one image. */
function program(routines: [number, number[]][]): ToonsMemory {
  const memory = new Uint8Array(0x30000);
  for (const [offset, bytes] of routines) memory.set(bytes, CODE * 16 + offset);
  return {
    memory,
    dataSegment: DATA,
    codeSegments: [CODE],
    overlays: [],
    resolve: (segment, offset) => ({ segment, offset }),
    fileOffset: (address) => address,
  };
}

const far = (offset: number) => [0x9a, offset & 0xff, offset >> 8, CODE & 0xff, CODE >> 8];
const word = (value: number) => [value & 0xff, value >> 8];

/**
 * A loader that opens its file, reads one word with DOS, makes a table of one part with the far allocation and the
 * part with `calloc(1, 8)`, keeps the word at the part's 0x04 and puts it on the list at 0x300; and a puzzle start that
 * loads the level and moves that part to the bin at 0x304.
 */
const LOADER = [
  ...[0x55, 0x8b, 0xec], // push bp; mov bp, sp
  ...[0xff, 0x76, 0x06], // push word [bp + 6]
  ...far(0x0000), // call far open
  ...[0x83, 0xc4, 0x02], // add sp, 2
  ...[0x8b, 0xf0], // mov si, ax
  ...[0x8a, 0x5c, 0x04, 0x32, 0xff], // mov bl, [si + 4]; xor bh, bh
  ...[0xb4, 0x3f, 0xb9, 0x02, 0x00, 0xba, 0x00, 0x01, 0xcd, 0x21], // mov ah, 3Fh; mov cx, 2; mov dx, 0x100; int 21h
  ...[0x6a, 0x00, 0x6a, 0x04], // push 0; push 4
  ...far(0x0002), // call far alloc
  ...[0x83, 0xc4, 0x04], // add sp, 4
  ...[0x89, 0x16, 0x02, 0x02, 0xa3, 0x00, 0x02], // mov [0x202], dx; mov [0x200], ax
  ...[0x6a, 0x08, 0x6a, 0x01], // push 8; push 1
  ...far(0x0001), // call far calloc
  ...[0x83, 0xc4, 0x04, 0x8b, 0xf8], // add sp, 4; mov di, ax
  ...[0xa1, 0x00, 0x01, 0x89, 0x45, 0x04], // mov ax, [0x100]; mov [di + 4], ax
  ...[0xc4, 0x1e, 0x00, 0x02, 0x26, 0x89, 0x3f], // les bx, [0x200]; mov es:[bx], di
  ...[0x89, 0x3e, 0x00, 0x03], // mov [0x300], di
  ...[0x5d, 0xcb], // pop bp; retf
];
const START = [
  ...[0x55, 0x8b, 0xec, 0xff, 0x76, 0x06], // push bp; mov bp, sp; push word [bp + 6]
  ...[0x0e, 0xe8, ...word((0x10 - (0x80 + 10)) & 0xffff)], // push cs; call the loader at 0x10
  ...[0x59, 0xa1, 0x00, 0x03, 0xa3, 0x04, 0x03], // pop cx; mov ax, [0x300]; mov [0x304], ax
  ...[0xc7, 0x06, 0x00, 0x03, 0x00, 0x00, 0x5d, 0xcb], // mov word [0x300], 0; pop bp; retf
];

const START_DESCRIPTION: GameStart = {
  game: "toons",
  partSize: 8,
  far: false,
  lists: { moving: 0x300, fixed: 0x302, bin: 0x304 },
  pool: 0x200,
  setup: [],
  loader: { segment: CODE, offset: 0x10 },
  start: [{ segment: CODE, offset: 0x80, args: ["name"] }],
  stands: {
    open: { segment: CODE, offset: 0 },
    calloc: { segment: CODE, offset: 1 },
    alloc: { segment: CODE, offset: 2 },
    free: [],
  },
};

describe("GameMachine", () => {
  const made = program([
    [0, [0xcb, 0xcb, 0xcb]],
    [0x10, LOADER],
    [0x80, START],
  ]);

  it("loads a level with the program's loader and starts it with its puzzle start, standing in for the library", () => {
    const machine = new GameMachine(made, START_DESCRIPTION, 0x1000);
    const run = machine.run(new Uint8Array([0x34, 0x12]), "TEST.LEV", 1);
    const [part] = run.loaded.pool;
    expect(part).toBeGreaterThan(0);
    expect(run.loaded.lists).toEqual({ moving: [part], fixed: [], bin: [] });
    expect([...run.loaded.records.get(part!)!.subarray(4, 6)]).toEqual([0x34, 0x12]);
    expect(run.started.lists).toEqual({ moving: [], fixed: [], bin: [part] });
    expect(run.unknown.size).toBe(0);
  });

  it("starts each level from the program as it was, so a second level reads its own bytes", () => {
    const machine = new GameMachine(made, START_DESCRIPTION, 0x1000);
    machine.run(new Uint8Array([0x34, 0x12]), "A.LEV", 1);
    const run = machine.run(new Uint8Array([0x78, 0x56]), "B.LEV", 1);
    const part = run.started.lists.bin[0]!;
    expect([...run.started.records.get(part)!.subarray(4, 6)]).toEqual([0x78, 0x56]);
  });

  it("finds the heap past the start-up stack in the program's header", () => {
    const header = new Uint8Array(0x20);
    header.set([0x10, 0x20], 0x0e); // ss 0x2010
    header.set([0x80, 0x00], 0x10); // sp 0x80
    expect(heapStart(header, 0x2000)).toBe(0x200);
  });
});

describe("findGameStart", () => {
  it("finds a TIM 2 loader by its magic, and from it the library routines, the table, the start and the store", () => {
    const loader = [
      ...[0x55, 0x8b, 0xec, 0x81, 0xec, 0x14, 0x02], // push bp; mov bp, sp; sub sp, 0x214
      ...[0x68, 0x00, 0x05, 0xff, 0x76, 0x06], // push mode; push word [bp + 6]
      ...far(0x0000), // call far open
      ...[0x81, 0x3e, 0x00, 0x04, 0xef, 0xac], // cmp word [0x400], 0xacef
      ...[0x50, 0x0e, 0xe8, ...word((0x200 - (0x10 + 29)) & 0xffff)], // push ax; push cs; call the table routine
      ...[0xff, 0x36, 0x12, 0x06, 0xff, 0x36, 0x10, 0x06], // push word [0x612]; push word [0x610]
      ...far(0x0004), // call far free
      ...[0xc9, 0xcb], // leave; retf
    ];
    const table = [
      ...[0x55, 0x8b, 0xec, 0x6a, 0x00, 0x6a, 0x0b, 0x6a, 0x00, 0x50], // push bp; mov bp, sp; push 0; push 11; push 0; push ax
      ...far(0x0002), // call far alloc
      ...[0x89, 0x16, 0x12, 0x06, 0xa3, 0x10, 0x06, 0x5d, 0xcb], // mov [0x612], dx; mov [0x610], ax; pop bp; retf
    ];
    const start = [
      ...[0x55, 0x8b, 0xec, 0x68, 0x00, 0x07], // push bp; mov bp, sp; push name
      ...[0x0e, 0xe8, ...word((0x10 - (0x100 + 10)) & 0xffff)], // push cs; call the loader
      ...[0x5d, 0xcb],
    ];
    const store = [
      ...[0x55, 0x8b, 0xec, 0x6a, 0x01, 0x6a, 0x09, 0x8b, 0xc6], // push bp; mov bp, sp; push 1; push 9; mov ax, si
      ...[0x69, 0xc0, 0xba, 0x00, 0x6a, 0x00, 0x50], // imul ax, ax, 0xba; push 0; push ax
      ...far(0x0002),
      ...[0x5d, 0xcb],
    ];
    const user = [
      0x55,
      0x8b,
      0xec,
      0x68,
      0x96,
      0x00,
      0x90,
      0x0e,
      0xe8,
      ...word((0x300 - (0x380 + 11)) & 0xffff),
      0x5d,
      0xcb,
    ];
    const found = findGameStart(
      program([
        [0x10, loader],
        [0x100, start],
        [0x200, table],
        [0x300, store],
        [0x380, user],
      ]),
      "tim2",
      { moving: 0x684d, fixed: 0x6845, bin: 0x6855 },
    );
    expect(found).toEqual({
      game: "tim2",
      partSize: 0xba,
      far: true,
      lists: { moving: 0x684d, fixed: 0x6845, bin: 0x6855 },
      pool: 0x610,
      setup: [{ segment: CODE, offset: 0x300, args: [0x96] }],
      loader: { segment: CODE, offset: 0x10 },
      start: [{ segment: CODE, offset: 0x100, args: ["name", 2] }],
      stands: {
        open: { segment: CODE, offset: 0 },
        alloc: { segment: CODE, offset: 2 },
        free: [{ segment: CODE, offset: 4 }],
      },
    });
  });
});
