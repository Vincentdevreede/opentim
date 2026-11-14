import { describe, expect, it } from "vitest";
import { BEHAVIOUR_PROFILES } from "../src/read/behaviour-program.ts";
import { discoverBehaviourLayout } from "../src/read/behaviour-layout.ts";

/** The data segment is 0x100 (image 0x1000), as `mov ax, 0x100; mov ds, ax` says. */
function image(): Uint8Array {
  const bytes = new Uint8Array(0x2000);
  bytes.set([0xb8, 0, 1, 0x8e, 0xd8], 5);
  return bytes;
}

/**
 * TOONS.EXE's way: 70-byte records in a table at offset 0xf2 of segment 0x80 (image 0x8f2), each callback called with
 * `push si; mov ax, [si+4]; mov dx, 70; imul dx; mov dx, 0x80; mov bx, ax; mov es, dx; call far es:[bx+0xf2+field]`.
 * The bounce callback is called once for the part itself and twice for the part it touches (`[si+0x8d]`).
 */
function toonsImage(): Uint8Array {
  const bytes = image();
  const call = (field: number) =>
    [0xba, 70, 0, 0xf7, 0xea, 0xba, 0x80, 0, 0x8b, 0xd8, 0x8e, 0xc2, 0x26, 0xff, 0x9f].concat([
      (0xf2 + field) & 0xff,
      (0xf2 + field) >> 8,
    ]);
  let at = 0x100;
  for (let i = 0; i < 6; i++, at += 32) bytes.set([0x56, 0x8b, 0x44, 4, ...call(0x2e + 4 * i)], at);
  for (let i = 0; i < 2; i++, at += 32) bytes.set([0x56, 0x8b, 0x9c, 0x8d, 0x00, 0x8b, 0x47, 4, ...call(0x2e)], at);
  // The frame drawing: the state into a local, the record's far pointer, the positions, then the pieces.
  bytes.set(
    [
      0x8b, 0x44, 0x0e, 0x89, 0x46, 0xfc, 0xba, 70, 0, 0xf7, 0xea, 0x05, 0xf2, 0x00, 0xc7, 0x46, 0xf6, 0x80, 0x00, 0x89,
      0x46, 0xf4, 0xc4, 0x5e, 0xf4, 0x26, 0x8b, 0x47, 0x1e, 0x26, 0x8b, 0x57, 0x1c, 0x89, 0x46, 0xfa, 0x89, 0x56, 0xf8,
      0x0b, 0xd0, 0x74, 0x08, 0x8b, 0x46, 0xfc, 0xd1, 0xe0, 0x01, 0x46, 0xf8, 0x90, 0x90, 0x90, 0x90, 0x90, 0xf7, 0x44,
      0x08, 0x00, 0x10, 0x74, 0x1f, 0xc4, 0x5e, 0xf4, 0x26, 0xc4, 0x5f, 0x18, 0x8b, 0x46, 0xfc, 0xd1, 0xe0, 0xd1, 0xe0,
      0x03, 0xd8,
    ],
    0x400,
  );
  // Four copies of the state into 0x0c (mov ax, [si+0x0e]; mov [si+0x0c], ax), which TIM.EXE's rule would take for
  // the previous state.
  for (let i = 0; i < 4; i++) bytes.set([0x8b, 0x44, 0x0e, 0x89, 0x44, 0x0c], 0x500 + 8 * i);
  return bytes;
}

describe("layouts of the other games", () => {
  it("finds TOONS.EXE's callbacks in a table at an offset of its segment, and its state through the far record", () => {
    const layout = discoverBehaviourLayout(toonsImage(), 0x8f2, undefined, { profile: BEHAVIOUR_PROFILES.toons });
    expect(layout.callbacks.map((c) => [c.role, c.field])).toEqual([
      ["bounce", 0x2e],
      ["run", 0x32],
      ["reset", 0x36],
      ["flip", 0x3a],
      ["resize", 0x3e],
      ["rope", 0x42],
    ]);
    expect(layout.callbacks[0]!.sites).toHaveLength(3);
    expect(layout.fields.find((f) => f.name === "type")).toMatchObject({ offset: 4, confidence: "checked" });
    expect(layout.fields.find((f) => f.name === "state")).toMatchObject({ offset: 0x0e, confidence: "checked" });
    // TOONS.EXE's parts count with that word, so it isn't the previous state there.
    expect(layout.fields.find((f) => f.name === "previousState")).toBeUndefined();
    expect(
      discoverBehaviourLayout(toonsImage(), 0x8f2, undefined, {
        profile: { ...BEHAVIOUR_PROFILES.toons, stateHistory: true },
      }).fields.find((f) => f.name === "previousState"),
    ).toMatchObject({ offset: 0x0c });
    expect(layout.fields.find((f) => f.name === "drawingFlags")).toMatchObject({
      offset: 8,
      masks: [{ value: 0x1000, name: "drawFromPieces" }],
    });
    // The bounce callback's owner is the touched part, also in the call picked by the passed part's own type.
    const bounce = layout.callbacks[0]!.objectSource!;
    expect(bounce).toMatchObject({ path: [0x8d], argumentRole: "collider" });
    expect(bounce.assumptions.at(-1)).toBe(
      "The callback is also called through the type of the part passed (0x110), with the same argument: the same code then runs with that part as the collider and the part it touches as the owner, so its findings hold for the touched part in those calls too.",
    );
  });

  it("finds TIM2.EXE's eight routines through the table of record pointers, and reads six", () => {
    const bytes = image();
    // les bx, [bp+6]; mov bx, es:[bx+8]; add bx, bx; mov bx, [bx+0x4ba]; call far [bx+field]
    for (let i = 0; i < 8; i++) {
      const call = i === 0 ? [0xff, 0x1f] : [0xff, 0x5f, 4 * i];
      bytes.set(
        [0xc4, 0x5e, 0x06, 0x26, 0x8b, 0x5f, 0x08, 0x03, 0xdb, 0x8b, 0x9f, 0xba, 0x04, ...call],
        0x100 + 32 * i,
      );
    }
    const layout = discoverBehaviourLayout(bytes, 0x14ba, undefined, { profile: BEHAVIOUR_PROFILES.tim2 });
    expect(layout.callbacks.map((c) => [c.role, c.field])).toEqual([
      ["bounce", 0],
      ["run", 4],
      ["reset", 8],
      ["flip", 0x0c],
      ["resize", 0x10],
      ["rope", 0x14],
    ]);
    expect(layout.diagnostics).toContain(
      "The record's routines after the six callbacks are not read: draw at +0x18, set-up at +0x1c.",
    );
  });

  it("reads TIM2.EXE's far part: the type from the calls, the owner of the bounce and the state from the drawing", () => {
    const bytes = image();
    const lookup = (field: number) => [0x26, 0x8b, 0x5f, 0x08, 0x03, 0xdb, 0x8b, 0x9f, 0xba, 0x04, 0xff, 0x5f, field];
    // push word [bp+8]; push word [bp+6]; les bx, [bp+6]: the part itself.
    const own = [0xff, 0x76, 0x08, 0xff, 0x76, 0x06, 0xc4, 0x5e, 0x06];
    for (let i = 1; i < 8; i++) bytes.set([...own, ...lookup(4 * i)], 0x100 + 32 * i);
    // The bounce callback: once for the part itself, once for the part it touches (push word [bp+8]; push bx;
    // les bx, es:[bx+0x9a]).
    bytes.set([...own, ...lookup(0)], 0x100);
    bytes.set([0xff, 0x76, 0x08, 0x53, 0x26, 0xc4, 0x9f, 0x9a, 0x00, ...lookup(0)], 0x200);
    // One record, whose draw routine is 0x60:0 (image 0x600).
    bytes.set([0x00, 0x00, 0x60, 0x00], 0x1800 + 0x18);
    // The draw routine: the type and the state, then the state pushed as the second argument of the animation routine.
    bytes.set(
      [0x55, 0x8b, 0xec, 0xc4, 0x5e, 0x06, 0x26, 0x8b, 0x7f, 0x08, 0x26, 0x8b, 0x47, 0x10, 0x89, 0x46, 0xf8],
      0x600,
    );
    bytes.set([0xff, 0x76, 0xf8, 0xff, 0x76, 0xf6, 0x9a, 0x00, 0x00, 0x70, 0x00], 0x620);
    // The animation routine: its second argument, checked against a count, picks a word of a table.
    bytes.set(
      [0x55, 0x8b, 0xec, 0x8b, 0x7e, 0x08, 0x26, 0x39, 0x7f, 0x0c, 0x77, 0x03, 0x8b, 0xc7, 0x03, 0xc0, 0x03, 0xd8],
      0x700,
    );
    const layout = discoverBehaviourLayout(bytes, 0x14ba, undefined, {
      profile: BEHAVIOUR_PROFILES.tim2,
      records: [0x1800],
      routine: (segment, offset) => ({ segment, offset, address: segment * 16 + offset }),
    });
    expect(layout.fields.find((f) => f.name === "type")).toMatchObject({ offset: 8, confidence: "checked" });
    expect(layout.fields.find((f) => f.name === "state")).toMatchObject({ offset: 0x10, confidence: "checked" });
    expect(layout.objectArgument).toMatchObject({ offset: 6, confidence: "inferred" });
    expect(layout.callbacks[1]!.objectSource).toMatchObject({ path: [], argumentRole: "owner" });
    expect(layout.callbacks[0]!.objectSource).toMatchObject({ path: [0x9a], argumentRole: "collider" });
    expect(layout.callbacks[0]!.objectSource!.assumptions.at(-1)).toBe(
      "The callback is also called through the type of the part passed (0x113), with the same argument: the same code then runs with that part as the collider and the part it touches as the owner, so its findings hold for the touched part in those calls too.",
    );
  });
});
