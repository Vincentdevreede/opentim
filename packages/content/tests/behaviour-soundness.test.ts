import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const prologue = [0x55, 0x8b, 0xec, 0x8b, 0x76, 0x06];
const analyse = (bytes: number[]) => analyseRoutine(Uint8Array.from(bytes), entry, { stateCount: 4 });

describe("conservative behaviour analysis", () => {
  it("does not reuse comparison carry after a carry-setting instruction", () => {
    const result = analyse([
      ...prologue,
      0x83,
      0x7c,
      0x0c,
      0, // cmp state, 0
      0xf9, // stc
      0x72,
      1, // jb the write
      0xcb,
      0xc7,
      0x44,
      0x0c,
      1,
      0,
      0xcb,
    ]);
    const transition = result.transitions.find(
      (transition) => transition.to.kind === "constant" && transition.to.value === 1,
    );
    expect(transition?.from).toEqual([0, 1, 2, 3]);
  });

  it("forgets the part identity when its stack argument is overwritten", () => {
    const result = analyse([
      0x55,
      0x8b,
      0xec,
      0xc7,
      0x46,
      0x06,
      0,
      0, // mov word [bp+6], 0
      0x8b,
      0x76,
      0x06, // mov si, [bp+6]
      0xc7,
      0x44,
      0x0c,
      1,
      0,
      0xcb,
    ]);
    expect(result.writes.filter((write) => write.object === "part" && write.offset === 12)).toHaveLength(0);
    expect(result.uncertainEffects).toBe(true);
  });

  it("keeps a final state unknown after an unsupported implicit memory write", () => {
    const result = analyse([
      ...prologue,
      0xab, // stosw has an unestablished ES:DI target
      0xcb,
    ]);
    expect(result.uncertainEffects).toBe(true);
    expect(result.transitions[0]?.to.kind).toBe("unknown");
  });

  it("uses the current code segment after a direct far tail jump", () => {
    const image = new Uint8Array(0x40).fill(0x66);
    image.set([...prologue, 0xea, 0, 0, 2, 0], 0);
    image.set([0xc7, 0x44, 0x0c, 1, 0, 0xcb], 0x20);
    const result = analyseRoutine(image, entry, { stateCount: 4 });
    expect(
      result.transitions.find((transition) => transition.to.kind === "constant" && transition.to.value === 1),
    ).toBeDefined();
  });

  it("recovers every sparse switch key without retaining the first search iteration's predicate", () => {
    const image = new Uint8Array(0x90).fill(0x66);
    image.set([
      ...prologue,
      0x8b,
      0x44,
      0x0c, // mov ax, state
      0x89,
      0x46,
      0xfe, // mov [bp-2], ax
      0xb9,
      2,
      0, // mov cx, key count
      0xbb,
      0x50,
      0, // mov bx, key table
      0x2e,
      0x8b,
      0x07, // mov ax, cs:[bx]
      0x3b,
      0x46,
      0xfe, // cmp ax, [bp-2]
      0x74,
      7, // je indirect jump
      0x83,
      0xc3,
      2, // add bx, 2
      0xe2,
      0xf3, // loop key load
      0xeb,
      4, // jmp default
      0x2e,
      0xff,
      0x67,
      4, // jmp cs:[bx+4]
      0xcb,
    ]);
    image.set([0, 0, 1, 0, 0x60, 0, 0x70, 0], 0x50);
    image.set([0xc7, 0x44, 0x0c, 2, 0, 0xcb], 0x60);
    image.set([0xc7, 0x44, 0x0c, 3, 0, 0xcb], 0x70);
    const result = analyseRoutine(image, entry, { stateCount: 4 });
    expect(
      result.transitions.find((transition) => transition.to.kind === "constant" && transition.to.value === 2)?.from,
    ).toEqual([0]);
    expect(
      result.transitions.find((transition) => transition.to.kind === "constant" && transition.to.value === 3)?.from,
    ).toEqual([1]);
  });

  it("restricts dense switch cases to the selector value established by the table", () => {
    const image = new Uint8Array(0x80).fill(0x66);
    image.set(
      [
        ...prologue,
        0x8b,
        0x5c,
        0x0c, // mov bx, state
        0x83,
        0xfb,
        1, // cmp bx, 1
        0x77,
        7, // ja default return
        0xd1,
        0xe3, // shl bx, 1
        0x2e,
        0xff,
        0xa7,
        0x30,
        0,
        0xcb,
      ],
      0,
    );
    image.set([0x40, 0, 0x50, 0], 0x30);
    image.set([0xc7, 0x44, 0x0c, 1, 0, 0xcb], 0x40);
    image.set([0xc7, 0x44, 0x0c, 2, 0, 0xcb], 0x50);
    const result = analyseRoutine(image, entry, { stateCount: 4 });
    expect(
      result.transitions.find((transition) => transition.to.kind === "constant" && transition.to.value === 1)?.from,
    ).toEqual([0]);
    expect(
      result.transitions.find((transition) => transition.to.kind === "constant" && transition.to.value === 2)?.from,
    ).toEqual([1]);
  });
});

it("reports an unsupported opcode at the routine entry without throwing away the diagnostic", () => {
  const result = analyseRoutine(Uint8Array.from([0x66, 0x90]), entry);
  expect(result.status).toBe("error");
  expect(result.uncertainties.join(" ")).toContain("0x0000");
  expect(result.transitions.every((transition) => transition.confidence === "unresolved")).toBe(true);
});

it("derives state predicates with a discovered state field rather than assuming +0x0c", () => {
  const result = analyseRoutine(
    Uint8Array.from([...prologue, 0x83, 0x7c, 0x2c, 2, 0x75, 5, 0xc7, 0x44, 0x2c, 3, 0, 0xcb]),
    entry,
    { stateOffset: 0x2c, stateCount: 4 },
  );
  expect(result.transitions.find((transition) => transition.to.kind === "constant")?.from).toEqual([2]);
});
