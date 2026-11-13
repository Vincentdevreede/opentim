import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { readTim2Parts } from "../src/read/parts.ts";
import {
  TIM2_STEP_MS,
  animationFrames,
  animationSheets,
  readAnimation,
  readPartNames,
  tim2LinePixels,
} from "../src/read/tim2.ts";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const words = (...values: number[]) => new Uint8Array(Uint16Array.from(values, (v) => v & 0xffff).buffer);

/** An animation of two frames over three steps, with one sequence, drawing from sheet 1, `PART7X`. */
function animation(): Uint8Array {
  const commands = [
    // Frame 0: a sprite, a sound, the sound stopped and a line.
    ...[2, 1, 4, 3, -2, 0],
    ...[5, 3019],
    ...[6, 3019],
    ...[4, 1, 2, 1, 9, 15],
    0,
    // Frame 1, at word 17: a mirrored sprite and a box.
    ...[2, 1, 5, 0, 0, 2],
    ...[3, 0, 0, 10, 5, 11, 0x800b],
    0,
    // A last no-op, as the shipped files have.
    1,
  ];
  const anm = words(
    ...[0x4254, 1001, 3, 2, 1, commands.length * 2],
    ...[40, 30],
    ...[0, 0, 1],
    ...[10, 20, 30, 15, 0],
    ...[-5, 0, 20, 20, 17],
    ...[1, 6],
    ...commands,
  );
  const tag = Uint8Array.from([1, 0, 1, 0, ...bytes("part7x.bmp\0")]);
  return Uint8Array.from([...writeChunk("ANM:", anm), ...writeChunk("TAG:", tag)]);
}

describe("TIM 2", () => {
  it("reads the part names from INFO.RES", () => {
    const info = bytes("  0.\tBowling Ball\tHelp text one.\r\n10.\tRope\tHelp text two.\r\nnot a part\r\n");
    expect(readPartNames(info)).toEqual(
      new Map([
        [0, "Bowling Ball"],
        [10, "Rope"],
      ]),
    );
  });

  it("reads a large INFO.RES, with a name across the pieces it is read in", () => {
    const info = bytes(`${"x".repeat(4096 * 245 - 5)}\r\n12.\tPulley\tHelp.\r\n`);
    expect(readPartNames(info)).toEqual(new Map([[12, "Pulley"]]));
  });

  it("stops at a part without an id, unless asked to keep it as new", () => {
    const info = bytes("0.\tBowling Ball\tHelp.\r\n999.\tSomething New\tHelp.\r\n");
    const files = (name: string) => (name === "INFO.RES" ? info : undefined);
    expect(() => readTim2Parts(files)).toThrow(/999 \(Something New\) has no id/);
    const parts = readTim2Parts(files, { keepUnknown: true }).parts;
    expect(parts.map((p) => [p.type, p.id])).toEqual([
      [0, "bowling-ball"],
      [999, "part-999"],
    ]);
  });

  it("reads the sheets an animation draws from", () => {
    const tag = Uint8Array.from([2, 0, 1, 0, ...bytes("part18X.BMP\0"), 2, 0, ...bytes("PART41.BMP\0")]);
    const anm = Uint8Array.from([...writeChunk("ANM:", new Uint8Array(4)), ...writeChunk("TAG:", tag)]);
    expect(animationSheets(anm)).toEqual(["PART18X", "PART41"]);
  });

  it("reads an animation's steps, frames, sequences and commands", () => {
    const read = readAnimation(animation());
    expect(read).toMatchObject({ version: 1001, width: 40, height: 30, steps: [0, 0, 1] });
    expect(read.sequences).toEqual([{ step: 1, sequence: 6 }]);
    expect(read.sheets).toEqual(new Map([[1, "PART7X"]]));
    expect(read.frames[0]).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 15,
      commands: [
        { kind: "sprite", sheet: 1, sprite: 4, x: 3, y: -2, flags: 0 },
        { kind: "sound", sound: 3019 },
        { kind: "stop", sound: 3019 },
        { kind: "line", x1: 1, y1: 2, x2: 1, y2: 9, colour: 15 },
      ],
    });
    expect(read.frames[1]!.commands[1]).toEqual({
      kind: "box",
      x: 0,
      y: 0,
      width: 10,
      height: 5,
      colour: 11,
      other: 0x800b,
    });
  });

  it("places an animation's sprites from the frame's corner, mirrored by their flags, with its boxes and lines", () => {
    expect(animationFrames(readAnimation(animation()))).toEqual([
      {
        id: 0,
        sprites: [{ sheet: "PART7X", sprite: 4, x: 13, y: 18, layer: 0 }],
        shapes: [{ kind: "line", x1: 11, y1: 22, x2: 11, y2: 29, colour: 15, after: 1 }],
        box: { x: 10, y: 20, width: 30, height: 15 },
      },
      {
        id: 1,
        sprites: [{ sheet: "PART7X", sprite: 5, x: -5, y: 0, layer: 0, flip: "h" }],
        // Bit 15 of the second colour word fills the box with that word's low byte.
        shapes: [{ kind: "box", x: -5, y: 0, width: 10, height: 5, colour: 11, fill: 11, after: 1 }],
        box: { x: -5, y: 0, width: 20, height: 20 },
      },
    ]);
  });

  it("refuses an animation that isn't one, or is newer than the game reads", () => {
    const anm = animation();
    const start = 8; // past the ANM: chunk's tag and size
    const wrong = anm.slice();
    wrong[start] = 0;
    expect(() => readAnimation(wrong)).toThrow(/TB/);
    const newer = anm.slice();
    newer[start + 2] = 0xea;
    expect(() => readAnimation(newer)).toThrow(/version 1002/);
  });

  it("refuses a frame whose commands lie past the commands' size, even when the chunk goes on", () => {
    const anm = animation();
    const start = 8; // past the ANM: chunk's tag and size
    // Only frame 0's 15 words are in the commands now; frame 1 starts at word 15.
    anm[start + 10] = 30;
    expect(() => readAnimation(anm)).toThrow(/past the commands' end, at byte/);
  });

  it("steps the machine every 2 ticks of a 59.2 Hz timer", () => {
    expect(TIM2_STEP_MS).toBeCloseTo(33.8, 1);
  });

  it("draws a line as TIM2.EXE's VGA driver does, from the left end or, when it is steep, from the top", () => {
    const at = (x1: number, y1: number, x2: number, y2: number) =>
      tim2LinePixels(x1, y1, x2, y2).map((p) => [p.x, p.y]);
    // An error of 0 steps the row at once, also going up.
    expect(at(4, 0, 0, 2)).toEqual([
      [0, 2],
      [1, 1],
      [2, 1],
      [3, 0],
      [4, 0],
    ]);
    // A steep line going up is drawn from its top end, stepping left.
    expect(at(0, 4, 2, 0)).toEqual([
      [2, 0],
      [1, 1],
      [1, 2],
      [0, 3],
      [0, 4],
    ]);
    expect(at(3, 3, 3, 3)).toEqual([[3, 3]]);
    expect(at(0, 0, 2, 2)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });
});
