import { describe, expect, it } from "vitest";
import {
  compressType3,
  decompressType3,
  installLanguage,
  unpackLanguagePackage,
  writeLanguagePackage,
} from "../src/language.ts";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (data: Uint8Array) => String.fromCharCode(...data);
const names = (files: { name: string }[]) => files.map((f) => f.name);

describe("decompressType3", () => {
  it("reads back what compressType3 wrote", () => {
    // Long enough for the tree to be rebuilt along the way.
    const data = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 251);
    expect(decompressType3(compressType3(data))).toEqual(data);
  });

  it("rejects other block types and truncated data", () => {
    expect(() => decompressType3(Uint8Array.of(2, 0, 0, 0, 0))).toThrow(/type 3/);
    expect(() => decompressType3(compressType3(bytes("TUTORIAL")).subarray(0, 6))).toThrow(/Truncated/);
  });
});

describe("unpackLanguagePackage", () => {
  it("reads back what writeLanguagePackage wrote, with upper-case names", () => {
    const files = unpackLanguagePackage(
      writeLanguagePackage([
        { name: "resource.002", data: bytes("levels") },
        { name: "READ.ME", data: bytes("") },
      ]),
    );
    expect(files.map((f) => [f.name, text(f.data)])).toEqual([
      ["RESOURCE.002", "levels"],
      ["READ.ME", ""],
    ]);
  });

  it("rejects other chunks and empty packages", () => {
    expect(() => unpackLanguagePackage(bytes("FORM\0\0\0\0"))).toThrow(/Unsupported chunk "FORM"/);
    expect(() => unpackLanguagePackage(new Uint8Array())).toThrow(/Empty/);
  });
});

describe("installLanguage", () => {
  const media = [
    {
      name: "FRENCH.RES",
      data: writeLanguagePackage([
        { name: "RESOURCE.002", data: bytes("fr 2") },
        { name: "TIM.EXE", data: bytes("exe") },
      ]),
    },
    { name: "GERMAN.RES", data: writeLanguagePackage([{ name: "RESOURCE.002", data: bytes("de 2") }]) },
    { name: "RESOURCE.001", data: bytes("common") },
    { name: "RESOURCE.F03", data: bytes("fr 3") },
    { name: "RESOURCE.FAP", data: bytes("fr map") },
    { name: "RESOURCE.G03", data: bytes("de 3") },
    { name: "RESOURCE.GAP", data: bytes("de map") },
  ];

  it("adds the package's RESOURCE files and renames the language's own copies", () => {
    const files = installLanguage(media, "FRENCH");
    expect(files.map((f) => [f.name, text(f.data)])).toEqual([
      ["RESOURCE.001", "common"],
      ["RESOURCE.002", "fr 2"],
      ["RESOURCE.003", "fr 3"],
      ["RESOURCE.MAP", "fr map"],
    ]);
    expect(files[0]).toBe(media[2]);
  });

  it("installs the other language from the same media", () => {
    expect(names(installLanguage(media, "GERMAN"))).toEqual([
      "RESOURCE.001",
      "RESOURCE.002",
      "RESOURCE.003",
      "RESOURCE.MAP",
    ]);
    expect(text(installLanguage(media, "GERMAN")[2]!.data)).toBe("de 3");
  });

  it("needs the language's package", () => {
    expect(() => installLanguage(media.slice(1), "FRENCH")).toThrow(/No language package for FRENCH/);
  });
});
