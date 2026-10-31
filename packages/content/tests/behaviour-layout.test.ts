import { describe, expect, it } from "vitest";
import { discoverBehaviourLayout } from "../src/read/behaviour-layout.ts";

function layoutImage(): Uint8Array {
  const image = new Uint8Array(0x1000);
  image.set([0xb8, 0, 1, 0x8e, 0xd8], 5);
  for (let i = 0; i < 6; i++)
    image.set(
      [
        0x56,
        0x8b,
        0x44,
        4,
        0xba,
        58,
        0,
        0xf7,
        0xea,
        0xba,
        0x80,
        0,
        0x8b,
        0xd8,
        0x8e,
        0xc2,
        0x26,
        0xff,
        0x9f,
        0x22 + i * 4,
        0,
      ],
      0x100 + i * 30,
    );
  image.set(
    [
      0xc7, 0x46, 0xf8, 0x80, 0, 0x8b, 0x44, 0x2c, 0x89, 0x46, 0xfc, 0x8b, 0x44, 0x28, 0x89, 0x46, 0xfa, 0x26, 0x8b,
      0x47, 0x18, 0x8b, 0xf8, 0x0b, 0xc0, 0x74, 0x43, 0x8b, 0x46, 0xfc, 0xd1, 0xe0, 0x03, 0xf8, 0xf7, 0x46, 0xfa, 0x10,
      0, 0x74, 0x10, 0x8a, 5, 0x98, 0x8b, 0x54, 0x40, 0x2b, 0xd0, 0x2b, 0x54, 0x44, 1, 0x54, 0x2a, 0xf7, 0x46, 0xfa,
      0x20, 0, 0x74, 0x11, 0x8a, 0x45, 1, 0x98, 0x8b, 0x54, 0x42, 0x2b, 0xd0, 0x2b, 0x54, 0x46, 1, 0x54, 0x2c,
    ],
    0x300,
  );
  image.set(
    [
      0xf7, 0x44, 0x28, 0, 0x10, 0x74, 0x11, 0xc4, 0x5e, 0xd6, 0x26, 0x8b, 0x5f, 0x16, 0x8b, 0x46, 0xfc, 0xd1, 0xe0, 3,
      0xd8,
    ],
    0x400,
  );
  return image;
}

describe("object and callback layout discovery", () => {
  it("finds the table dispatch and derives state and flag offsets from drawing uses", () => {
    const layout = discoverBehaviourLayout(layoutImage(), 0x800);
    expect(layout.diagnostics).toEqual([]);
    expect(layout.callbacks.map((c) => c.field)).toEqual([0x22, 0x26, 0x2a, 0x2e, 0x32, 0x36]);
    expect(layout.objectArgument).toMatchObject({ offset: 6, confidence: "inferred" });
    expect(layout.fields.find((f) => f.name === "type")).toMatchObject({ offset: 4, confidence: "checked" });
    expect(layout.fields.find((f) => f.name === "state")).toMatchObject({ offset: 0x2c, confidence: "checked" });
    expect(layout.fields.find((f) => f.name === "drawingFlags")).toMatchObject({
      offset: 0x28,
      masks: [
        { value: 16, name: "horizontalFlip" },
        { value: 32, name: "verticalFlip" },
        { value: 4096, name: "drawFromPieces" },
      ],
    });
  });

  it("recognizes a direct DS table call as well as an ES table call", () => {
    const image = layoutImage();
    image.set([0xb8, 0x40, 0, 0x8e, 0xd8], 5);
    for (let i = 0; i < 6; i++) {
      image.fill(0, 0x100 + i * 30, 0x100 + i * 30 + 21);
      image.set(
        [0x56, 0x8b, 0x44, 4, 0xba, 58, 0, 0xf7, 0xea, 0x8b, 0xd8, 0xff, 0x9f, 0x22 + i * 4, 4],
        0x100 + i * 30,
      );
    }
    const layout = discoverBehaviourLayout(image, 0x800);
    expect(layout.callbacks.map((c) => c.field)).toEqual([0x22, 0x26, 0x2a, 0x2e, 0x32, 0x36]);
    expect(layout.objectArgument.offset).toBe(6);
  });

  it("derives the type field from the word multiplied by the record stride", () => {
    const image = layoutImage();
    image[0x100 + 30 + 3] = 0x24;
    const layout = discoverBehaviourLayout(image, 0x800);
    const type = layout.fields.find((f) => f.name === "type");
    expect(type).toMatchObject({ offset: 0x24, confidence: "checked" });
    expect(type!.evidence.some((e) => e.text === "mov ax, word [si+0x24]")).toBe(true);
    expect(type!.evidence.some((e) => e.text === "imul dx")).toBe(true);
  });

  it("retains separately inferred state snapshots and delta sources", () => {
    const image = layoutImage();
    image.set([0x8b, 0x44, 0x2c, 0x89, 0x44, 0x2e, 0x8b, 0x44, 0x2c, 0x89, 0x44, 0x2e], 0x500);
    image.set([0x8b, 0x44, 0x32, 0x01, 0x44, 0x2c], 0x520);
    const layout = discoverBehaviourLayout(image, 0x800);
    expect(layout.fields.find((f) => f.name === "previousState")).toMatchObject({
      offset: 0x2e,
      confidence: "inferred",
    });
    expect(layout.fields.find((f) => f.name === "stateDelta")).toMatchObject({ offset: 0x32, confidence: "inferred" });
  });

  it("does not accept a plausible dispatch to a different table", () => {
    const layout = discoverBehaviourLayout(layoutImage(), 0x810);
    expect(layout.callbacks).toEqual([]);
    expect(layout.fields).toEqual([]);
    expect(layout.objectArgument.confidence).toBe("unresolved");
  });
});
