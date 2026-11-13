import { describe, expect, it } from "vitest";
import { LevelError, readLevel } from "../src/read/level.ts";

/** Builds level bytes: numbers are little-endian words, `b(n)` is a byte, strings end with a zero byte. */
const b = (value: number) => ({ byte: value });
type Item = number | string | { byte: number };

function bytes(...items: Item[]): Uint8Array {
  const out: number[] = [];
  for (const item of items) {
    if (typeof item === "number") out.push(item & 0xff, (item >> 8) & 0xff);
    else if (typeof item === "string") out.push(...[...item].map((c) => c.charCodeAt(0)), 0);
    else out.push(item.byte);
  }
  return Uint8Array.from(out);
}

const NONE = 0xffff;
/** No belt, no ropes, no links. */
const noTies = [0, b(0), b(0), 0, 0, b(0), b(0), 0, b(0), b(0), NONE, NONE];

/** A part of version 0x102 and later: three flag words and the plugs. */
function part(type: number, x: number, y: number, ...rest: Item[]): Item[] {
  return [type, 0xe040, 0x180, 0, 3, 0, 32, 16, 32, 16, x, y, 0, ...(rest.length ? rest : [...noTies, NONE, NONE])];
}

describe("level files", () => {
  it("reads a puzzle: its header, its parts and the bin", () => {
    const data = bytes(
      0xaced,
      0x102,
      "TUTORIAL:  PUT THE BALL IN THE HOOP",
      "Make the basketball go through the hoop.",
      400,
      300,
      67,
      272,
      0xfff8,
      0xfff8,
      1002,
      1,
      1,
      1,
      ...part(1, 40, 136),
      ...part(9, -8, 62),
      ...part(0, -1, -1),
    );
    const level = readLevel(data, { name: "L1.LEV" });
    expect(level).toMatchObject({
      kind: "puzzle",
      version: 0x102,
      title: "TUTORIAL:  PUT THE BALL IN THE HOOP",
      goal: "Make the basketball go through the hoop.",
      bonus: [400, 300],
      airPressure: 67,
      gravity: 272,
      scroll: [-8, -8],
      music: 1002,
    });
    expect(level.parts.map((p) => [p.index, p.group, p.type, p.position.x, p.position.y])).toEqual([
      [0, "static", 1, 40, 136],
      [1, "moving", 9, -8, 62],
      [2, "bin", 0, -1, -1],
    ]);
    expect(level.parts[0]).toMatchObject({
      flags: [0xe040, 0x180, 0],
      state: [3, 0],
      size: { width: 32, height: 16 },
      links: [null, null],
      plugs: [null, null],
      offset: level.fields.at(-1)!.offset + 2,
      length: 48,
    });
    expect(level.fields.find((f) => f.key === "gravity")).toEqual({ key: "gravity", offset: 87, size: 2, value: 272 });
  });

  it("records every field of a part with where it is, covering the part's bytes", () => {
    const data = bytes(0xaced, 0x102, "T", "G", 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, ...part(1, 40, 136));
    const [p] = readLevel(data).parts;
    let at = p!.offset;
    for (const f of p!.fields) {
      expect(f.offset).toBe(at);
      at += f.size;
    }
    expect(at).toBe(p!.offset + p!.length);
    expect(p!.fields.find((f) => f.key === "position.x")).toEqual({
      key: "position.x",
      offset: p!.offset + 20,
      size: 2,
      value: 40,
    });
    expect(p!.fields.find((f) => f.key === "belt.at.y")).toMatchObject({ size: 1, value: 0 });
    expect(p!.fields.find((f) => f.key === "plugs.1")).toMatchObject({ size: 2, value: NONE });
  });

  it("reads belts, ropes, links and the pulley's extra word", () => {
    const belt = part(8, -1, -1, 1, b(0), b(0), 0, 1, 2, 0, b(0), b(0), 0, b(0), b(0), NONE, NONE, NONE, NONE);
    const rope = part(
      10,
      -1,
      -1,
      0,
      b(0),
      b(0),
      0,
      1,
      b(0),
      b(0),
      2,
      3,
      b(0),
      b(1),
      0,
      b(0),
      b(0),
      NONE,
      NONE,
      NONE,
      NONE,
    );
    const pulley = part(7, 310, 37, 0, b(0), b(0), 0, 0, b(0), b(6), 0, b(15), b(6), 3, NONE, NONE, NONE, 1);
    const data = bytes(0xaced, 0x102, "T", "G", 0, 0, 67, 272, 0, 0, 0, 3, 0, 0, ...belt, ...rope, ...pulley);
    const [b0, r0, p0] = readLevel(data).parts;
    expect(b0!.belt.parts).toEqual([1, 2]);
    expect(r0!.ropes[0]).toEqual({ at: { x: 0, y: 0 }, rope: { parts: [2, 3], slots: [0, 1] } });
    expect(r0!.ropes[1]).toEqual({ at: { x: 0, y: 0 } });
    expect(p0!.ropes.map((s) => s.at)).toEqual([
      { x: 0, y: 6 },
      { x: 15, y: 6 },
    ]);
    expect(p0!.links).toEqual([3, null]);
    expect(p0!.pulley).toBe(1);
  });

  it("reads a scene, which has no title, goal or bonus", () => {
    const data = bytes(0xaced, 0x102, 67, 268, 1001, 1, 0, 0, ...part(48, 0, 0));
    expect(readLevel(data, { name: "CREDITS.GKC" })).toMatchObject({
      kind: "freeform",
      airPressure: 67,
      gravity: 268,
      music: 1001,
      parts: [{ type: 48 }],
    });
  });

  it("reads the empty goal and the bin word of version 0x105", () => {
    const data = bytes(0xaced, 0x105, "", 67, 272, 1001, 0, 0, 1, 0, ...part(0, 8, 8));
    const level = readLevel(data, { name: "TITLE.GKC" });
    expect(level).toMatchObject({ kind: "freeform", goal: "", binFlag: 0 });
    expect(level.parts[0]!.group).toBe("bin");
  });

  it("reads version 0x100, with two flag words, no plugs and outline points", () => {
    const old = [0, 0x800, 0, 0, 0, 32, 32, 32, 32, -1, -1, 0, ...noTies, 2, 0x1f08, 0x171f];
    const level = readLevel(bytes(0xaced, 0x100, 20, 275, 0, 0, 0, 1, ...old), { name: "FF.LEV" });
    expect(level.kind).toBe("freeform");
    expect(level.parts[0]).toMatchObject({
      flags: [0x800, 0],
      outline: [
        { x: 8, y: 31 },
        { x: 31, y: 23 },
      ],
    });
    expect(level.parts[0]!.plugs).toBeUndefined();
  });

  it("reads the Toons layout: no bonus or bin, and more words per part", () => {
    const tunnel = [46, 0, 0, 0, 0, 0, 16, 16, 16, 16, 100, 50, 0, ...noTies, NONE, NONE, 4, b(7), 0x55];
    const data = bytes(0xacee, 0x106, "Title", "Goal", 67, 272, 0, 0, 5, 1, 0, ...tunnel);
    const level = readLevel(data, { layout: "toons" });
    expect(level.bonus).toBeUndefined();
    expect(level.parts[0]).toMatchObject({ type: 46, tunnel: 4, toons: { byte: 7, word: 0x55 } });
  });

  it("reads a TIM 2 level: notes in the header, a programmable ball and the entries after the parts", () => {
    const empty = [0, 0, 0, ""];
    const notes = [1, 300, 40, 1, "A hint.", ...Array.from({ length: 7 }, () => empty).flat()];
    const ball = [87, 0x1000, 0, 0x8048, 0, 0, 16, 16, 16, 16, 100, 50, 0, ...noTies, NONE, NONE, 1, 2, 3, 4, 5, -6];
    const wall = [1, 0x6000, 0x180, 0x2040, 0, 0, 64, 16, 64, 16, 0, 360, 0, ...noTies, NONE, NONE];
    const entries = Array.from({ length: 7 }, () => [NONE, 0, 0, 0, 0, 0, 0, 0]).flat();
    const data = bytes(
      ...[0xacef, 0x113, b(0), b(3), "Balls", "Knock the ball off.", ...notes],
      ...[67, 272, 0, 0, 1001, 1, 1, 0],
      ...wall,
      ...ball,
      ...[1, 1, 0, 0, 0, NONE, NONE, NONE, NONE, ...entries, 0],
    );
    const level = readLevel(data, { name: "TLEV1.LEV" });
    expect(level).toMatchObject({
      layout: "tim2",
      kind: "puzzle",
      title: "Balls",
      goal: "Knock the ball off.",
      airPressure: 67,
      gravity: 272,
      music: 1001,
    });
    expect(level.tim2).toMatchObject({ bytes: [0, 3], notes: [{ x: 300, y: 40, z: 1, text: "A hint." }], spare: 0 });
    expect(level.tim2!.goal!.entries[0]).toEqual({ part: 1, values: [0, 0, 0, -1, -1, -1, -1] });
    expect(level.parts.map((p) => [p.group, p.type])).toEqual([
      ["static", 1],
      ["moving", 87],
    ]);
    expect(level.parts[1]!.program).toEqual([1, 2, 3, 4, 5, -6]);
  });

  it("says why a file can't be read", () => {
    expect(() => readLevel(bytes(0xacef, 0x113))).toThrow(/ends too early/);
    expect(() => readLevel(bytes(0x1234, 0x102))).toThrow(/Not a level file/);
    const short = bytes(0xaced, 0x102, "T", "G", 0, 0, 67, 272, 0, 0, 0, 1, 0, 0, 7);
    expect(() => readLevel(short)).toThrow(LevelError);
    const extra = bytes(0xaced, 0x102, 67, 268, 1001, 0, 0, 0, 0x9999);
    expect(() => readLevel(extra, { name: "X.GKC" })).toThrow(/2 bytes before the file does/);
  });
});
