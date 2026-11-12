import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const routine = (...bytes: number[]) => readRoutineCode(Uint8Array.from(bytes), entry, 0);

describe("routine control flow", () => {
  it("follows both sides of a conditional branch to their returns", () => {
    const result = routine(0x83, 0x7c, 0x0c, 2, 0x75, 6, 0xc7, 0x44, 0x0c, 3, 0, 0xcb, 0xcb);
    expect(result.status).toBe("complete");
    expect(result.instructions.map((i) => i.address)).toEqual([0, 4, 6, 11, 12]);
    expect(result.edges).toContainEqual({ from: 4, to: 12, kind: "taken", condition: "jne" });
    expect(result.edges).toContainEqual({ from: 4, to: 6, kind: "not-taken", condition: "not jne" });
    expect(result.extent).toEqual([{ start: 0, end: 13 }]);
  });

  it("records near and far calls without treating their bodies as part of the routine", () => {
    const result = routine(0xe8, 0x10, 0, 0x9a, 0x23, 1, 0x40, 0, 0xcb);
    expect(result.instructions.map((i) => i.address)).toEqual([0, 3, 8]);
    expect(result.calls).toMatchObject([
      { instruction: 0, far: false, target: { segment: 0, offset: 0x13, address: 0x13 }, confidence: "checked" },
      { instruction: 3, far: true, target: { segment: 0x40, offset: 0x123, address: 0x523 }, confidence: "checked" },
    ]);
  });

  it("follows direct tail jumps and records noncontiguous instruction extents", () => {
    expect(routine(0xeb, 3, 0x66, 0x66, 0x66, 0xcb)).toMatchObject({
      status: "complete",
      extent: [
        { start: 0, end: 2 },
        { start: 5, end: 6 },
      ],
    });
  });

  it("stops the routine at the first unknown encoding and retains its address", () => {
    const result = routine(0x90, 0x66, 0xcb);
    expect(result.status).toBe("error");
    expect(result.instructions.map((i) => i.address)).toEqual([0]);
    expect(result.uncertainties[0]).toContain("x86 at 0x0001");
  });

  it("rejects a branch into the middle of a decoded instruction", () => {
    const result = routine(0x75, 1, 0xb8, 0, 0, 0xcb);
    expect(result.status).toBe("error");
    expect(result.uncertainties[0]).toMatch(/0x3.*instruction at 0x2/);
  });

  it("keeps unknown indirect jumps unresolved", () => {
    const result = routine(0xff, 0xe0);
    expect(result.status).toBe("partial");
    expect(result.edges).toEqual([{ from: 0, to: null, kind: "unresolved" }]);
    expect(result.uncertainties[0]).toContain("no structurally established table bound");
  });

  it("follows every entry of a switch guarded by an unsigned range check", () => {
    const image = new Uint8Array(0x60).fill(0x66);
    image.set([0x83, 0xfb, 1, 0x77, 11, 0xd1, 0xe3, 0x2e, 0xff, 0xa7, 0x30, 0], 0);
    image[0x10] = 0xcb;
    image.set([0x40, 0, 0x50, 0], 0x30);
    image.set([0xc7, 0x44, 0x0c, 1, 0, 0xcb], 0x40);
    image.set([0xc7, 0x44, 0x0c, 2, 0, 0xcb], 0x50);
    const result = readRoutineCode(image, entry, 0);
    expect(result.status).toBe("complete");
    expect(result.edges.filter((edge) => edge.kind === "jump-table")).toMatchObject([
      { from: 7, to: 0x40, tableIndex: 0, indexRegister: "bx" },
      { from: 7, to: 0x50, tableIndex: 1, indexRegister: "bx" },
    ]);
    expect(result.edges.find((edge) => edge.kind === "jump-table")!.evidence!.at(-1)).toEqual({
      address: 0x30,
      bytes: [0x40, 0],
      text: "switch entry 0: offset 0x40",
    });
    expect(result.instructions.filter((instruction) => instruction.mnemonic === "mov")).toHaveLength(2);
  });

  it("does not trust a range check that another way into the shift goes around", () => {
    // mov bx, [bp+6]; or bx, bx; js shift; cmp bx, 1; ja default; shift: shl bx, 1; jmp cs:[bx+0x13]; default: retf
    // prettier-ignore
    const skipped = routine(0x8b, 0x5e, 6, 0x0b, 0xdb, 0x78, 5, 0x83, 0xfb, 1, 0x77, 0x0b, 0xd1, 0xe3, 0x2e, 0xff, 0xa7, 0x13, 0, 0x17, 0, 0x17, 0, 0xcb);
    expect(skipped.status).toBe("partial");
    expect(skipped.edges.filter((edge) => edge.kind === "jump-table")).toEqual([]);
    // mov bx, [bp+6]; cmp bx, 1; ja default; shift: shl bx, 1; jmp cs:[bx+0x0f]; case 0: jmp shift; case 1: retf
    // prettier-ignore
    const looped = routine(0x8b, 0x5e, 6, 0x83, 0xfb, 1, 0x77, 0x0e, 0xd1, 0xe3, 0x2e, 0xff, 0xa7, 0x0f, 0, 0x13, 0, 0x15, 0, 0xeb, 0xf3, 0xcb, 0xcb);
    expect(looped.status).toBe("partial");
    expect(looped.uncertainties.some((u) => u.includes("can be bypassed"))).toBe(true);
  });

  it("follows a bounded sparse search table and preserves its actual keys", () => {
    const image = new Uint8Array(0x70).fill(0x66);
    image.set([
      0xb9,
      2,
      0, // mov cx, 2
      0xbb,
      0x30,
      0, // mov bx, 0x30
      0x2e,
      0x8b,
      0x07, // mov ax, cs:[bx]
      0x3b,
      0x46,
      0xfe, // cmp ax, [bp-2]
      0x74,
      7, // je the indirect jump
      0x83,
      0xc3,
      2, // add bx, 2
      0xe2,
      0xf3, // loop to the key load
      0xeb,
      0x07, // jmp default
      0x2e,
      0xff,
      0x67,
      4, // jmp cs:[bx+4]
      0x66,
      0x66,
      0x66,
      0xcb,
    ]);
    image.set([3, 0, 9, 0, 0x40, 0, 0x50, 0], 0x30);
    image[0x40] = 0xcb;
    image[0x50] = 0xcb;
    const result = readRoutineCode(image, entry, 0);
    expect(result.status).toBe("complete");
    expect(result.edges.filter((edge) => edge.kind === "jump-table")).toMatchObject([
      { to: 0x40, tableIndex: 0, caseValue: 3, selector: { kind: "memory", base: ["bp"], displacement: -2 } },
      { to: 0x50, tableIndex: 1, caseValue: 9 },
    ]);
    expect(result.edges.find((edge) => edge.kind === "jump-table")!.search).toEqual({
      entry: 0,
      compare: 9,
      match: 12,
      defaultTarget: 28,
      count: 2,
      tableBase: 0x30,
      keyRegister: "ax",
      indexRegister: "bx",
    });
    image[17] = 0xe1; // A conditional loop is not the recognized bounded search.
    expect(readRoutineCode(image, entry, 0).status).toBe("partial");
  });

  it("does not invent a table from plausible pointer words without a guard", () => {
    const image = new Uint8Array(0x60);
    image.set([0xd1, 0xe3, 0x2e, 0xff, 0xa7, 0x30, 0], 0);
    image.set([0x40, 0, 0x50, 0], 0x30);
    image[0x40] = 0xcb;
    image[0x50] = 0xcb;
    expect(readRoutineCode(image, entry, 0).status).toBe("partial");
  });

  it("labels an indirect call's initial pointer as unresolved because it can be rewritten", () => {
    const image = new Uint8Array(0x60);
    image.set([0xff, 0x1e, 0x10, 0, 0xcb], 0);
    image.set([0x30, 0, 2, 0], 0x30);
    const call = readRoutineCode(image, entry, 2).calls[0]!;
    expect(call.target).toEqual({ offset: 0x30, segment: 2, address: 0x50 });
    expect(call.confidence).toBe("unresolved");
    expect(call.evidence[1]!.address).toBe(0x30);
    expect(call.assumptions[0]).toContain("runtime write");
  });
});
