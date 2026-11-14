/**
 * Reads what TIM 2 says about its parts: `INFO.RES` lists every part number with its English name and help text, and
 * each part's `.ANM` animation holds its frames and names the sheets it draws from in a `TAG:` chunk.
 */

import { findChunk, readChunks } from "@opentim/resources";
import type { Frame, Placement, Shape } from "../model.ts";

/**
 * The English names in `INFO.RES`, by part number. Each line is the number with a dot, a tab, the name, a tab and
 * the help text, like `  0.\tBowling Ball\tThis bowling ball is very heavy…`.
 */
export function readPartNames(info: Uint8Array): Map<number, string> {
  const names = new Map<number, string>();
  // In pieces, as a call takes only so many arguments.
  let text = "";
  for (let at = 0; at < info.length; at += 4096) text += String.fromCharCode(...info.subarray(at, at + 4096));
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\.\t([^\t]+)/.exec(line);
    if (match) names.set(Number(match[1]), match[2]!.trim());
  }
  return names;
}

/** The sheets an animation's `TAG:` chunk names, by the number its sprite commands use, like 1 for `PART18X`. */
export function animationSheetNumbers(anm: Uint8Array): Map<number, string> {
  const tag = findChunk(readChunks(anm), "TAG:")?.data;
  const sheets = new Map<number, string>();
  if (!tag || tag.length < 2) return sheets;
  const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
  let at = 2;
  for (let i = 0; i < view.getUint16(0, true) && at + 2 < tag.length; i++) {
    const end = tag.indexOf(0, at + 2);
    if (end < 0) break;
    const name = String.fromCharCode(...tag.subarray(at + 2, end))
      .toUpperCase()
      .replace(/\.BMP$/, "");
    sheets.set(view.getUint16(at, true), name);
    at = end + 1;
  }
  return sheets;
}

/** The sheets an animation draws from, in the order its `TAG:` chunk lists them, like `PART18X`. */
export const animationSheets = (anm: Uint8Array): string[] => [...animationSheetNumbers(anm).values()];

/** One command of a frame, as TIM2.EXE's frame drawing routine runs them. Coordinates are relative to the frame. */
export type AnimationCommand =
  /** Draws a sprite. `flags` bit 2 mirrors it left to right, bit 1 top to bottom. */
  | { kind: "sprite"; sheet: number; sprite: number; x: number; y: number; flags: number }
  /** Draws a box. What the two colour bytes and the high bit do isn't known; the game keeps them for its box routine. */
  | { kind: "box"; x: number; y: number; width: number; height: number; colour: number; other: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; colour: number }
  /** Plays a sound, by the number in its file name: 3019 is `SX_3019.RAW`. */
  | { kind: "sound"; sound: number }
  /**
   * Stops the sound with that number if it is playing: TIM2.EXE's command 5 calls the same routine to stop a sound
   * before it starts it again. No shipped animation uses it.
   */
  | { kind: "stop"; sound: number };

export interface AnimationFrame {
  /** The frame's box, relative to the animation's origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  commands: AnimationCommand[];
}

export interface Animation {
  /** 1000 or 1001; the game refuses a higher one. */
  version: number;
  /** The size the game mirrors a whole frame in. */
  width: number;
  height: number;
  /** The frame each step shows, or empty when step N shows frame N. */
  steps: number[];
  frames: AnimationFrame[];
  /** Each sequence's number and the step it starts at; it runs until the next one starts. */
  sequences: { sequence: number; step: number }[];
  /** The sheets, by the number the sprite commands use. */
  sheets: Map<number, string>;
}

/**
 * How long one step of TIM 2's machine takes at the least, in milliseconds. TIM2.EXE sets the PC's timer to 65,535 ÷ 13
 * = 5,041 counts (236.7 Hz), counts a step timer down every 4 of those ticks (59.2 Hz), and its run loop waits until
 * that timer is 0 and sets it to 2 before every step: at most 29.6 steps a second. An animation's steps repeat frames
 * to hold them, so a part moves one state a step.
 */
export const TIM2_STEP_MS = (2 * 4 * Math.trunc(0xffff / 13) * 1000) / 1193182;

/** The number of words each command takes, with the command itself, as TIM2.EXE's table has them. */
const COMMAND_WORDS = [1, 1, 6, 7, 6, 2, 2];

/**
 * Reads an `.ANM` animation: an `ANM:` chunk and a `TAG:` chunk. The `ANM:` chunk is, all words little-endian:
 *
 * - `TB`, the version, the number of steps, frames and sequences, and the size of the commands in bytes;
 * - the width and height;
 * - a frame number per step;
 * - per frame its box (x, y, width, height, signed) and where its commands start, in words from the first command;
 * - per sequence the step it starts at and its number;
 * - the commands. Each frame's commands end with a 0.
 */
export function readAnimation(anm: Uint8Array): Animation {
  const data = findChunk(readChunks(anm), "ANM:")?.data;
  if (!data) throw new Error("No ANM: chunk");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const word = (at: number) => {
    if (at + 2 > data.length) throw new Error(`The animation ends at byte ${data.length}, before ${at + 2}`);
    return view.getUint16(at, true);
  };
  const signed = (at: number) => (word(at) << 16) >> 16;
  if (data[0] !== 0x54 || data[1] !== 0x42) throw new Error("Not an animation: it doesn't start with TB");
  const version = word(2);
  if (version > 1001) throw new Error(`Animation version ${version} is newer than the game reads`);
  const [stepCount, frameCount, sequenceCount, size] = [word(4), word(6), word(8), word(10)];
  let at = 16;
  const steps = Array.from({ length: stepCount }, (_, i) => word(at + i * 2));
  at += stepCount * 2;
  const boxes = Array.from({ length: frameCount }, (_, i) => {
    const b = at + i * 10;
    return { x: signed(b), y: signed(b + 2), width: signed(b + 4), height: signed(b + 6), start: word(b + 8) };
  });
  at += frameCount * 10;
  const sequences = Array.from({ length: sequenceCount }, (_, i) => ({
    step: word(at + i * 4),
    sequence: word(at + i * 4 + 2),
  }));
  const commands = at + sequenceCount * 4;
  const end = commands + size;
  if (end > data.length) throw new Error(`The commands end past the animation, at byte ${end}`);
  // Every command of a frame, its closing 0 too, lies in the commands the header gives the size of.
  const past = (c: number) => new Error(`A frame's commands run past the commands' end, at byte ${c}`);
  const frames = boxes.map(({ start, ...box }): AnimationFrame => {
    const list: AnimationCommand[] = [];
    for (let c = commands + start * 2; ;) {
      if (c + 2 > end) throw past(c);
      const command = word(c);
      if (command === 0) break;
      const length = COMMAND_WORDS[command];
      if (!length) throw new Error(`Unknown command ${command} at byte ${c}`);
      if (c + length * 2 > end) throw past(c);
      const w = (n: number) => signed(c + n * 2);
      if (command === 2) list.push({ kind: "sprite", sheet: w(1), sprite: w(2), x: w(3), y: w(4), flags: w(5) });
      else if (command === 3)
        list.push({ kind: "box", x: w(1), y: w(2), width: w(3), height: w(4), colour: w(5), other: word(c + 12) });
      else if (command === 4) list.push({ kind: "line", x1: w(1), y1: w(2), x2: w(3), y2: w(4), colour: w(5) });
      else if (command === 5) list.push({ kind: "sound", sound: word(c + 2) });
      else if (command === 6) list.push({ kind: "stop", sound: word(c + 2) });
      c += length * 2;
    }
    return { ...box, commands: list };
  });
  return {
    version,
    width: word(12),
    height: word(14),
    steps,
    frames,
    sequences,
    sheets: animationSheetNumbers(anm),
  };
}

/**
 * The pixels of a line as TIM2.EXE draws it, in the order it draws them, with x and y on the screen. TIM2.EXE always
 * asks for the 16 colour `HEG:` driver of `VM.OVL` (see the file formats research), whose line function cuts the line
 * into runs by division and joins two runs with a pixel in the corner, so every pixel touches the one before it by a
 * side. The game sorts the ends so the line runs to the right, and the driver draws it from the left end:
 *
 * - a line wider than tall in runs across, one row after the other: the first run is width ÷ (height + 1) + 1 pixels
 *   long, each other one that many less 1, or 1 more when the running sum of the remainder's share, kept in 16 bits,
 *   overflows; the last run stops at the right end;
 * - a line taller than wide the same way in runs down (or up), with width and height swapped;
 * - a line as wide as tall a pixel right and then a pixel down (or up), for each column; the last pixel isn't drawn
 *   when the right end is at a multiple of 8 across, where the driver moves on to the next byte of the screen.
 */
export function tim2LinePixels(x1: number, y1: number, x2: number, y2: number): { x: number; y: number }[] {
  if (x1 > x2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
  const across = x2 - x1;
  const down = Math.abs(y2 - y1);
  const step = y2 > y1 ? 1 : -1;
  let x = x1;
  let y = y1;
  const pixels = [{ x, y }];
  const dot = () => pixels.push({ x, y });
  if (across === 0 || down === 0) {
    for (let i = 0; i < across + down; i++) {
      if (across) x++;
      else y += step;
      dot();
    }
    return pixels;
  }
  if (across === down) {
    for (let i = 1; i <= across; i++) {
      x++;
      dot();
      if (i === across && x % 8 === 0) break;
      y += step;
      dot();
    }
    return pixels;
  }
  // Runs along the longer side, each followed by one pixel along the shorter one.
  const long = Math.max(across, down);
  const runs = Math.min(across, down) + 1;
  const length = Math.floor(long / runs);
  const share = Math.floor(((long % runs) * 0x10000) / runs);
  const along = () => (across > down ? x++ : (y += step));
  const aside = () => (across > down ? (y += step) : x++);
  let left = long;
  let sum = 0;
  let run = length + 1;
  for (;;) {
    if (left - run < 0) run = left;
    left -= run;
    for (let i = 0; i < run; i++) {
      along();
      dot();
    }
    if (left === 0) return pixels;
    aside();
    dot();
    sum += share;
    run = length + (sum > 0xffff ? 1 : 0);
    sum &= 0xffff;
  }
}

const FLIPS: Record<number, Placement["flip"]> = { 1: "v", 2: "h", 3: "hv" };

/** Bit 15 of a box's second colour word: TIM2.EXE fills the box with the low byte of that word. */
const FILLED = 0x8000;

/**
 * The frames of an animation as the part lists keep them: the sprites of each frame, placed relative to the
 * animation's origin, in the order the game draws them, all on layer 0, and its boxes and lines. Sounds are left out.
 * TIM2.EXE draws a box filled when bit 15 of its second colour word is set, and its outline in the first colour unless
 * it is filled with that same colour; a line in its colour. The colours are the low bytes of the words.
 */
export function animationFrames(animation: Animation): Frame[] {
  return animation.frames.map((frame, id) => {
    const sprites: Placement[] = [];
    const shapes: Shape[] = [];
    for (const c of frame.commands) {
      if (c.kind === "sprite") {
        const sheet = animation.sheets.get(c.sheet);
        if (!sheet) throw new Error(`Frame ${id} draws from sheet ${c.sheet}, which the TAG: chunk doesn't name`);
        const flip = FLIPS[c.flags & 3];
        const placement: Placement = { sheet, sprite: c.sprite, x: frame.x + c.x, y: frame.y + c.y, layer: 0 };
        sprites.push(flip ? { ...placement, flip } : placement);
      } else if (c.kind === "box") {
        const box: Shape = {
          kind: "box",
          x: frame.x + c.x,
          y: frame.y + c.y,
          width: c.width,
          height: c.height,
          colour: c.colour & 0xff,
          after: sprites.length,
        };
        shapes.push(c.other & FILLED ? { ...box, fill: c.other & 0xff } : box);
      } else if (c.kind === "line")
        shapes.push({
          kind: "line",
          x1: frame.x + c.x1,
          y1: frame.y + c.y1,
          x2: frame.x + c.x2,
          y2: frame.y + c.y2,
          colour: c.colour & 0xff,
          after: sprites.length,
        });
    }
    const box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    return shapes.length ? { id, sprites, shapes, box } : { id, sprites, box };
  });
}
