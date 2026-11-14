import { describe, expect, it } from "vitest";
import {
  discoverFormFields,
  matchFieldForm,
  TIM2_FIELD_FORMS,
  TOONS_FIELD_FORMS,
  type FieldForm,
} from "../src/read/behaviour-field-forms.ts";
import type { LayoutField } from "../src/read/behaviour-layout.ts";

/** The bytes of a form with the given values for its names, and 0 for every byte that may differ. */
function assemble(bytes: string, values: Record<string, number>): number[] {
  return bytes
    .trim()
    .split(/\s+/)
    .flatMap((word) => {
      if (word === "??") return [0];
      const capture = /^\{(\w+)(?::(16))?\}$/.exec(word);
      if (!capture) return [parseInt(word, 16)];
      const value = values[capture[1]!] ?? 0;
      return capture[2] ? [value & 0xff, value >> 8] : [value];
    });
}

/** An image with each form's bytes at its own place, 0x200 apart, and `nop` everywhere else. */
function imageOf(parts: number[][]): Uint8Array {
  const image = new Uint8Array(0x200 * (parts.length + 1)).fill(0x90);
  parts.forEach((bytes, i) => image.set(bytes, 0x100 + 0x200 * i));
  return image;
}

const known = (fields: [string, number][]): LayoutField[] =>
  fields.map(([name, offset]) => ({ name, offset, confidence: "checked", evidence: [], assumptions: [] }));

// mov ax, [si+a]; mov [si+b], ax; mov ax, [si+a]
const COPY: FieldForm = { routine: "copy", bytes: "8b 44 {from} 89 44 {to} 8b 44 {from}", assumption: "A copy." };

describe("part fields from the programs' own routines", () => {
  it("reads the offsets from the matched bytes, and a name must hold the same wherever it appears", () => {
    const image = imageOf([[0x8b, 0x44, 0x12, 0x89, 0x44, 0x34, 0x8b, 0x44, 0x12]]);
    expect(matchFieldForm(image, COPY.bytes)).toEqual([
      {
        at: 0x100,
        end: 0x109,
        values: new Map([
          ["from", 0x12],
          ["to", 0x34],
        ]),
      },
    ]);
    // The second read is of another field, so the form doesn't match.
    expect(matchFieldForm(imageOf([[0x8b, 0x44, 0x12, 0x89, 0x44, 0x34, 0x8b, 0x44, 0x13]]), COPY.bytes)).toEqual([]);
    // A word: mov ax, es:[bx+0x9a], and any byte.
    const word = imageOf([[0x26, 0x8b, 0x87, 0x9a, 0x00, 0x77]]);
    expect(matchFieldForm(word, "26 8b 87 {link:16} ??")[0]!.values).toEqual(new Map([["link", 0x9a]]));
  });

  it("names the fields with the instructions as evidence, and leaves out what a finding names otherwise", () => {
    const image = imageOf([[0x8b, 0x44, 0x12, 0x89, 0x44, 0x34, 0x8b, 0x44, 0x12]]);
    const diagnostics: string[] = [];
    const fields = discoverFormFields(image, [COPY], [], diagnostics);
    expect(fields.map((f) => [f.name, f.offset, f.confidence])).toEqual([
      ["from", 0x12, "inferred"],
      ["to", 0x34, "inferred"],
    ]);
    expect(fields[0]!.evidence.map((e) => e.text)).toEqual([
      "mov ax, word [si+0x12]",
      "mov word [si+0x34], ax",
      "mov ax, word [si+0x12]",
    ]);
    expect(fields[0]!.assumptions).toEqual(["A copy."]);
    expect(diagnostics).toEqual([]);
    // A known field at the same offset with the same name is kept as it is.
    expect(discoverFormFields(image, [COPY], known([["from", 0x12]]), []).map((f) => f.name)).toEqual(["to"]);
    // Known at another offset, or the offset known by another name: the form names nothing.
    for (const other of [known([["from", 0x14]]), known([["state", 0x34]])]) {
      const said: string[] = [];
      expect(discoverFormFields(image, [COPY], other, said)).toEqual([]);
      expect(said[0]).toMatch(/^The copy gives (from|to) at 0x(12|34), which another finding names otherwise/);
    }
  });

  it("names nothing when the form isn't there or its matches disagree", () => {
    const said: string[] = [];
    expect(discoverFormFields(imageOf([[0x90]]), [COPY], [], said)).toEqual([]);
    expect(said).toEqual(["The copy wasn't found, so the fields it shows aren't named."]);
    const twice = imageOf([
      [0x8b, 0x44, 0x12, 0x89, 0x44, 0x34, 0x8b, 0x44, 0x12],
      [0x8b, 0x44, 0x12, 0x89, 0x44, 0x36, 0x8b, 0x44, 0x12],
    ]);
    const disagree: string[] = [];
    expect(discoverFormFields(twice, [COPY], [], disagree)).toEqual([]);
    expect(disagree).toEqual(["The copy matches in more than one form, so it names nothing."]);
  });

  it("adds the form's masks to a field, also to a known one", () => {
    const form: FieldForm = {
      routine: "flag test",
      bytes: "f7 44 {drawingFlags} 10 00",
      assumption: "A test.",
      masks: { drawingFlags: [{ value: 0x10, name: "horizontalFlip" }] },
    };
    const image = imageOf([[0xf7, 0x44, 0x08, 0x10, 0x00]]);
    expect(discoverFormFields(image, [form], [], [])[0]).toMatchObject({
      name: "drawingFlags",
      offset: 8,
      masks: [{ value: 0x10, name: "horizontalFlip" }],
    });
    const flags = { ...known([["drawingFlags", 8]])[0]!, masks: [{ value: 0x1000, name: "drawFromPieces" }] };
    expect(discoverFormFields(image, [form], [flags], [])).toEqual([]);
    expect(flags.masks).toEqual([
      { value: 0x1000, name: "drawFromPieces" },
      { value: 0x10, name: "horizontalFlip" },
    ]);
  });

  // Made-up offsets, none of them the games' own, so the names can only come from the bytes.
  const TIM2_OFFSETS = {
    drawingFlags: 0x0e,
    previousState: 0x13,
    olderState: 0x15,
    stateDelta: 0x17,
    positionX: 0x23,
    positionY: 0x25,
    previousX: 0x27,
    previousY: 0x29,
    drawX: 0x2f,
    drawY: 0x31,
    velocityX: 0x3b,
    velocityY: 0x3d,
    horizontalExtent: 0x45,
    verticalExtent: 0x47,
    frameWidth: 0x49,
    frameHeight: 0x4b,
    baseWidth: 0x55,
    baseHeight: 0x57,
    outlinePointCount: 0x97,
    contactPart: 0x9b,
    contactAngle: 0xa1,
    contactEdge: 0xa3,
    savedPositionX: 0xa5,
    savedPositionY: 0xa7,
    savedState: 0xa9,
    savedDrawingFlags: 0xad,
  };

  it("names TIM2.EXE's fields from its frame helpers, motion helper, history, level reset and contact producer", () => {
    const values = { ...TIM2_OFFSETS, type: 0x09, state: 0x11, _offset: 0xf6, _part: 0xfa, _index: 0xf8 };
    const image = imageOf(TIM2_FIELD_FORMS.map((form) => assemble(form.bytes, values)));
    const said: string[] = [];
    const fields = discoverFormFields(
      image,
      TIM2_FIELD_FORMS,
      known([
        ["type", 0x09],
        ["state", 0x11],
      ]),
      said,
    );
    expect(said).toEqual([]);
    expect(Object.fromEntries(fields.map((f) => [f.name, f.offset]))).toEqual(TIM2_OFFSETS);
    expect(fields.find((f) => f.name === "drawingFlags")!.masks).toEqual([
      { value: 0x10, name: "horizontalFlip" },
      { value: 0x20, name: "verticalFlip" },
    ]);
    // positionX is shown by four routines, and each adds its reason.
    expect(fields.find((f) => f.name === "positionX")!.assumptions).toHaveLength(4);
    // The state the forms read must be the one the layout proved.
    const wrong: string[] = [];
    expect(
      discoverFormFields(image, TIM2_FIELD_FORMS, known([["state", 0x10]]), wrong).some(
        (f) => f.name === "previousState",
      ),
    ).toBe(false);
    expect(wrong).toContain(
      "The frame position helper gives state at 0x11, which another finding names otherwise, so it names nothing.",
    );
  });

  it("names TOONS.EXE's fields, with the frame's offset the part keeps", () => {
    const offsets = {
      previousState: 0x10,
      olderState: 0x12,
      positionX: 0x1f,
      positionY: 0x21,
      previousX: 0x23,
      previousY: 0x25,
      drawX: 0x2b,
      drawY: 0x2d,
      velocityX: 0x37,
      velocityY: 0x39,
      horizontalExtent: 0x41,
      verticalExtent: 0x43,
      frameOffsetX: 0x45,
      frameOffsetY: 0x47,
      frameWidth: 0x4d,
      frameHeight: 0x4f,
      baseWidth: 0x59,
      baseHeight: 0x5b,
      outlinePointCount: 0x87,
      contactPart: 0x8d,
      contactAngle: 0x91,
      contactEdge: 0x93,
    };
    const values = { ...offsets, type: 4, state: 0x0e, drawingFlags: 8, _part: 0x4b8a, _other: 0x4b88, _index: 0xf8 };
    const image = imageOf(TOONS_FIELD_FORMS.map((form) => assemble(form.bytes, values)));
    const fields = discoverFormFields(
      image,
      TOONS_FIELD_FORMS,
      known([
        ["type", 4],
        ["state", 0x0e],
        ["drawingFlags", 8],
      ]),
      [],
    );
    expect(Object.fromEntries(fields.map((f) => [f.name, f.offset]))).toEqual(offsets);
  });
});
