/**
 * The colours TIM2.EXE shows. It always draws with the 16 colour `HEG:` driver of `VM.OVL`, in the BIOS's mode 12h,
 * where the screen keeps 4 bits a pixel (see the file formats research). What the driver does with a colour, as read
 * from its code:
 *
 * - When it sets the screen up, it sets each of the 16 palette registers to its own number and has the BIOS split the
 *   256 colours into 16 pages of 16, of which it keeps the first (int 10h, ax 0x1013, bx 0x0100). Nothing in the driver
 *   or in TIM2.EXE changes the page or the registers later. So the 4 bits of a pixel pick one of the palette's first 16
 *   colours.
 * - A picture, a line or a box's outline puts only the low 4 bits of its colour on the screen: colour c shows as the
 *   palette's colour c & 15.
 * - A box filled with a colour whose high 4 bits aren't 0 is filled with a pattern of two colours, like a
 *   checkerboard: its low 4 bits and its high 4 bits (`tim2FillColour`). TIM2.EXE's box routine fills this way, and
 *   it fills a colour block (type 127) and the play area in the level's background colour with it.
 *
 * `readTim2Driver` finds those three places in the driver, so the Lab only shows TIM 2 in 16 colours with the driver
 * loaded.
 */

import { decodeBin, findChunk, readChunks } from "@opentim/resources";

/** Where the rules for the colours are in the unpacked `HEG:` driver. */
export interface Tim2Driver {
  /** The loop that sets each of the 16 palette registers to its own number. */
  registers: number;
  /** The call that splits the 256 colours into 16 pages of 16. */
  pages: number;
  /** The test in the box fill of the colour's high 4 bits, which fills the box with a pattern when they aren't 0. */
  pattern: number;
}

/** `mov dl, 0xc0; mov al, cl; out dx, al; jmp $+2; out dx, al`: palette register cl gets cl. */
const REGISTERS = [0xb2, 0xc0, 0x8a, 0xc1, 0xee, 0xeb, 0x00, 0xee];
/** `mov ax, 0x1013; mov bx, 0x0100; int 10h`: 16 pages of 16 colours. */
const PAGES = [0xb8, 0x13, 0x10, 0xbb, 0x00, 0x01, 0xcd, 0x10];
/** `mov dl, al; mov ah, al; ror ah, 1` four times: the colour's two halves swapped, for the pattern. */
const SWAP = [0x8a, 0xd0, 0x8a, 0xe0, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc];
/** `and dl, 0xf0`: the test of the high 4 bits, a few bytes after the swap. */
const HIGH = [0x80, 0xe2, 0xf0];

function find(code: Uint8Array, bytes: readonly number[], from = 0): number {
  for (let at = from; at + bytes.length <= code.length; at++) if (bytes.every((b, k) => code[at + k] === b)) return at;
  return -1;
}

/**
 * Reads the rules for TIM2.EXE's colours from `VM.OVL`. Throws when the file has no `HEG:` driver or the driver doesn't
 * do what TIM2.EXE's driver does.
 */
export function readTim2Driver(vmOvl: Uint8Array): Tim2Driver {
  const chunk = findChunk(readChunks(vmOvl), "HEG:");
  if (!chunk) throw new Error("VM.OVL has no HEG: driver");
  const code = decodeBin(chunk.data);
  const registers = find(code, REGISTERS);
  if (registers < 0) throw new Error("The HEG: driver doesn't set the palette registers as TIM2.EXE's does");
  const pages = find(code, PAGES);
  if (pages < 0) throw new Error("The HEG: driver doesn't split the colours into 16 pages as TIM2.EXE's does");
  const swap = find(code, SWAP);
  const high = swap < 0 ? -1 : find(code.subarray(swap + SWAP.length, swap + SWAP.length + 8), HIGH);
  if (high < 0) throw new Error("The HEG: driver doesn't fill boxes with a pattern as TIM2.EXE's does");
  return { registers, pages, pattern: swap + SWAP.length + high };
}

/** A palette's 256 colours as TIM2.EXE shows them: colour c is the palette's colour c & 15. */
export function tim2SixteenColours(palette: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 768 }, (_, i) => palette[(((i / 3) | 0) & 15) * 3 + (i % 3)] ?? 0);
}

/**
 * The colour of a pixel of a box TIM2.EXE fills with `colour`, as one of the palette's first 16. `column` counts from
 * the box's left end and `row` is the pixel's row on the screen. A colour of 16 or more gives a pattern: the low 4 bits
 * where column + row is odd, the high 4 bits where it is even. The driver starts the pattern from where the first row
 * of the fill begins, so this holds for a box that isn't cut off at its left side.
 */
export function tim2FillColour(colour: number, column: number, row: number): number {
  const low = colour & 15;
  const high = (colour >> 4) & 15;
  if (!high) return low;
  return (column + row) & 1 ? low : high;
}
