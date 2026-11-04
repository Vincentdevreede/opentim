import { describe, expect, it } from "vitest";
import { findAll, parseQuery } from "../src/search.ts";

const bytes = (q: string) => Array.from(parseQuery(q)?.pattern ?? []);

describe("parseQuery", () => {
  it("reads quoted text, hex bytes and numbers", () => {
    expect(parseQuery('"Hoop"')).toMatchObject({ kind: "text", fold: true });
    expect(bytes('"Hoop"')).toEqual([0x48, 0x4f, 0x4f, 0x50]);
    expect(bytes('"open')).toEqual([0x4f, 0x50, 0x45, 0x4e]);
    expect(parseQuery("ED AC")).toMatchObject({ kind: "bytes" });
    expect(bytes("ed ac 02")).toEqual([0xed, 0xac, 2]);
    expect(bytes("=408")).toEqual([0x98, 1]);
    expect(bytes("= 0x198")).toEqual([0x98, 1]);
    expect(bytes("=-8")).toEqual([0xf8, 0xff]);
    expect(bytes("=70000")).toEqual([0x70, 0x11, 1, 0]);
  });

  it("leaves names alone", () => {
    expect(parseQuery("L1.LEV")).toBeUndefined();
    expect(parseQuery("ED")).toBeUndefined();
    expect(parseQuery("PART")).toBeUndefined();
    expect(parseQuery("=")).toBeUndefined();
    expect(parseQuery("=-40000")).toBeUndefined();
  });
});

describe("findAll", () => {
  it("finds every start of the pattern, letters in any case", () => {
    const data = Uint8Array.from([..."The hoop, the HOOP"].map((c) => c.charCodeAt(0)));
    expect(findAll(data, parseQuery('"hoop"')!)).toEqual([4, 14]);
    expect(findAll(Uint8Array.of(0x98, 1, 0x98, 1, 0x98), parseQuery("=408")!)).toEqual([0, 2]);
    expect(findAll(Uint8Array.of(1, 1, 1), parseQuery("01 01")!)).toEqual([0, 1]);
    expect(findAll(Uint8Array.of(1, 1, 1), parseQuery("01 01")!, 1)).toEqual([0]);
  });
});
