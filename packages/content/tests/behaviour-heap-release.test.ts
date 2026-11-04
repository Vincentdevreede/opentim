import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { matchHeapRoutine, proveOwnedHeapRelease } from "../src/read/behaviour-heap-release.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const branchPattern = `mov ax,16:ds[{global}]
or ax,ax
je @done
inc ax
done: retf`;
const branchImage = () => Uint8Array.from([0xa1, 0x40, 0, 0x0b, 0xc0, 0x74, 1, 0x40, 0xcb]);
const branch = () => readRoutineCode(branchImage(), entry, 0);

describe("heap routine structure proofs", () => {
  it("matches decoded operands, branch targets and complete edges with relocated data", () => {
    const bindings = new Map<string, number>();
    expect(matchHeapRoutine(branch(), branchPattern, bindings)?.get("global")).toBe(0x40);
    expect(bindings.size).toBe(0);
    const relocated = branchImage();
    relocated[1] = 0x60;
    expect(matchHeapRoutine(readRoutineCode(relocated, entry, 0), branchPattern, bindings)?.get("global")).toBe(0x60);
    expect(matchHeapRoutine(branch(), branchPattern, new Map([["global", 0x60]]))).toBeUndefined();
  });
  it("rejects changed operands even if disassembly text is unchanged", () => {
    const code = branch(),
      source = code.instructions[0]!.operands[1]!;
    if (source.kind === "memory") source.width = 8;
    expect(matchHeapRoutine(code, branchPattern, new Map())).toBeUndefined();
  });
  it.each(["extra", "missing", "reversed"])("rejects %s CFG edges", (change) => {
    const code = branch();
    if (change === "extra") code.edges.push({ from: 0, to: 8, kind: "next" });
    if (change === "missing") code.edges.pop();
    if (change === "reversed") code.edges.find((e) => e.kind === "taken")!.kind = "not-taken";
    expect(matchHeapRoutine(code, branchPattern, new Map())).toBeUndefined();
  });
  it("rejects an incomplete routine, changed flow or unexpected prefix", () => {
    const partial = branch();
    partial.status = "partial";
    expect(matchHeapRoutine(partial, branchPattern, new Map())).toBeUndefined();
    const stopped = branch();
    stopped.instructions[0]!.flow = "stop";
    expect(matchHeapRoutine(stopped, branchPattern, new Map())).toBeUndefined();
    const prefixed = branch();
    prefixed.instructions[0]!.prefixes.push("rep");
    expect(matchHeapRoutine(prefixed, branchPattern, new Map())).toBeUndefined();
  });
  it("checks a repeated store's prefix explicitly", () => {
    const code = readRoutineCode(Uint8Array.from([0xfc, 0xf3, 0xab, 0xcb]), entry, 0);
    expect(matchHeapRoutine(code, "cld\nrep stosw\nretf", new Map())).toBeDefined();
    expect(matchHeapRoutine(code, "cld\nstosw\nretf", new Map())).toBeUndefined();
  });
  it("checks resolved call targets and the actual near or far convention", () => {
    const image = Uint8Array.from([0xe8, 1, 0, 0xcb, 0xcb]);
    const code = readRoutineCode(image, entry, 0);
    expect(matchHeapRoutine(code, "call $helper\nretf", new Map())?.get("helper")).toBe(4);
    expect(matchHeapRoutine(code, "callf $helper\nretf", new Map())).toBeUndefined();
    code.calls[0]!.target = { address: 3, segment: 0, offset: 3 };
    expect(matchHeapRoutine(code, "call $helper\nretf", new Map())).toBeUndefined();
  });
  it("does not grant arbitrary read-only code a release contract without the allocator and ownership chain", () => {
    const code = readRoutineCode(Uint8Array.from([0xcb]), entry, 0);
    expect(proveOwnedHeapRelease(code, new Map([[0, code]]), new Map(), new Set())).toBeUndefined();
  });
});
