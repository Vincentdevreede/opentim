import { describe, expect, it } from "vitest";
import { discoverObjectFieldRoles } from "../src/read/behaviour-fields.ts";
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
    image.set([0x8b, 0x44, 0x2e, 0x89, 0x44, 0x30, 0x8b, 0x44, 0x2c, 0x89, 0x44, 0x2e], 0x540);
    const layout = discoverBehaviourLayout(image, 0x800);
    expect(layout.fields.find((f) => f.name === "previousState")).toMatchObject({
      offset: 0x2e,
      confidence: "inferred",
    });
    expect(layout.fields.find((f) => f.name === "stateDelta")).toMatchObject({ offset: 0x32, confidence: "inferred" });
    expect(layout.fields.find((field) => field.name === "olderState")).toMatchObject({
      offset: 0x30,
      confidence: "inferred",
    });
  });

  it("derives the bounce owner through the passed collider's related pointer", () => {
    const image = layoutImage();
    image.fill(0, 0x100, 0x100 + 30);
    const dispatch = (related: number) => [
      0x56,
      0x8b,
      0x9c,
      related & 255,
      related >> 8,
      0x8b,
      0x47,
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
      0x22,
      0,
    ];
    image.set(dispatch(0xb4), 0x100);
    const layout = discoverBehaviourLayout(image, 0x800);
    expect(layout.callbacks.find((callback) => callback.role === "bounce")?.objectSource).toMatchObject({
      argumentOffset: 6,
      path: [0xb4],
      argumentRole: "collider",
      confidence: "inferred",
    });
    expect(layout.callbacks.find((callback) => callback.role === "run")?.objectSource).toMatchObject({
      argumentOffset: 6,
      path: [],
      argumentRole: "owner",
    });
    image.set(dispatch(0xc4), 0x600);
    const ambiguous = discoverBehaviourLayout(image, 0x800);
    expect(ambiguous.callbacks.find((callback) => callback.role === "bounce")?.objectSource).toBeUndefined();
    expect(ambiguous.diagnostics.some((diagnostic) => diagnostic.includes("inconsistent owner-argument"))).toBe(true);
  });

  it("does not accept a plausible dispatch to a different table", () => {
    const layout = discoverBehaviourLayout(layoutImage(), 0x810);
    expect(layout.callbacks).toEqual([]);
    expect(layout.fields).toEqual([]);
    expect(layout.objectArgument.confidence).toBe("unresolved");
  });
});

/** Synthetic records and code use deliberately shifted object offsets, so naming must follow instructions. */
function fieldRoleImage(counter = 0xa8, reloadContact = false) {
  const image = new Uint8Array(0x2000).fill(0x66);
  image.set([0xb8, 0x40, 0, 0x8e, 0xd8], 0);
  const table = 0x1000;
  image.fill(0, table, table + 58 * 2);
  image[0x80] = 0xcb;
  const word = (at: number, value: number) => image.set([value & 255, value >> 8], at);
  for (let type = 0; type < 2; type++)
    for (let field = 0x22; field < 58; field += 4) {
      word(table + type * 58 + field, field === 0x26 ? 0x200 + type * 0x100 : field === 0x32 ? 0x900 : 0x80);
    }
  const memory = (opcode: number, register: number, base: "si" | "bx" | "bp", offset: number) => [
    opcode,
    0x80 | (register << 3) | (base === "si" ? 4 : base === "bx" ? 7 : 6),
    offset & 255,
    (offset >> 8) & 255,
  ];
  const prologue = [0x55, 0x8b, 0xec, 0x8b, 0x76, 6];
  for (let type = 0; type < 2; type++)
    image.set(
      [
        ...prologue,
        ...memory(0xff, type === 0 ? 0 : 1, "si", counter),
        ...memory(0x83, 7, "si", counter),
        type === 0 ? 4 : 0,
        0x9a,
        0,
        6,
        0,
        0,
        0x9a,
        0,
        7,
        0,
        0,
        0x9a,
        0,
        8,
        0,
        0,
        0xcb,
      ],
      0x200 + type * 0x100,
    );
  image.set(
    [
      ...prologue,
      ...memory(0x8b, 0, "si", 0x58),
      ...memory(0x89, 0, "si", 0x2a),
      ...memory(0x8b, 0, "si", 0x5a),
      ...memory(0x89, 0, "si", 0x2c),
      0xcb,
    ],
    0x600,
  );
  image.set(
    [
      ...prologue,
      ...memory(0x8b, 0, "si", 0x58),
      ...memory(0x2b, 0, "si", 0x5c),
      ...memory(0x89, 0, "si", 0x66),
      0xb1,
      9,
      0x2a,
      0x4e,
      8,
      ...memory(0xd3, 4, "si", 0x66),
      ...memory(0x8b, 0, "si", 0x5a),
      ...memory(0x2b, 0, "si", 0x5e),
      ...memory(0x89, 0, "si", 0x68),
      0xb1,
      9,
      0x2a,
      0x4e,
      10,
      ...memory(0xd3, 4, "si", 0x68),
      0xcb,
    ],
    0x700,
  );
  image.set(
    [
      0x8b,
      0x1e,
      0,
      0x15,
      0xa1,
      4,
      0x15,
      ...memory(0x89, 0, "bx", 0xb4),
      ...memory(0x8b, 0, "bp", -10),
      0x05,
      0,
      0x80,
      ...(reloadContact ? [0x8b, 0x1e, 0, 0x15] : []),
      ...memory(0x89, 0, "bx", 0xb8),
      ...memory(0x8b, 0, "bp", -8),
      0x48,
      0x8b,
      0x1e,
      0,
      0x15,
      ...memory(0x89, 0, "bx", 0xba),
      0xc7,
      0x46,
      0xfe,
      1,
      0,
      ...memory(0xff, 0, "bp", -8),
      0x8b,
      0x1e,
      4,
      0x15,
      ...memory(0x8b, 0, "bx", 0xb0),
      ...memory(0x3b, 0, "bp", -8),
      0xcb,
    ],
    0x800,
  );
  image.set(
    [
      ...prologue,
      ...memory(0x8b, 0, "si", 0x70),
      ...memory(0x89, 0, "si", 0x44),
      ...memory(0x8b, 0, "si", 0x72),
      ...memory(0x89, 0, "si", 0x46),
      0xcb,
    ],
    0x900,
  );
  return { image, table };
}

const fieldCallbacks = ["bounce", "run", "reset", "resize", "flip", "rope"].map((role, slot) => ({
  role,
  field: 0x22 + slot * 4,
}));
const knownFieldRoles = [
  { name: "state", offset: 0x26 },
  { name: "drawX", offset: 0x2a },
  { name: "drawY", offset: 0x2c },
  { name: "frameWidth", offset: 0x44 },
  { name: "frameHeight", offset: 0x46 },
].map((field) => ({ ...field, confidence: "checked" as const, assumptions: [], evidence: [] }));

describe("field roles derived from callback code", () => {
  it("follows coordinate, scaled motion and stored-dimension data flow at shifted offsets", () => {
    const { image, table } = fieldRoleImage();
    const fields = discoverObjectFieldRoles(image, table, 2, fieldCallbacks, knownFieldRoles);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offset: 0x58, name: "positionX" }),
        expect.objectContaining({ offset: 0x5a, name: "positionY" }),
        expect.objectContaining({ offset: 0x66, name: "velocityX" }),
        expect.objectContaining({ offset: 0x68, name: "velocityY" }),
        expect.objectContaining({ offset: 0x70, name: "baseWidth" }),
        expect.objectContaining({ offset: 0x72, name: "baseHeight" }),
      ]),
    );
    expect(
      fields
        .find((field) => field.name === "velocityX")!
        .evidence.some((entry) => entry.text === "shl word [si+0x66], cl"),
    ).toBe(true);
    expect(
      fields.every(
        (field) => field.confidence === "inferred" && field.assumptions.length > 0 && field.evidence.length > 0,
      ),
    ).toBe(true);
  });

  it("keeps increasing and decreasing uses of a reused counter separate for each type", () => {
    for (const offset of [0xa8, 0xc6]) {
      const { image, table } = fieldRoleImage(offset);
      const field = discoverObjectFieldRoles(image, table, 2, fieldCallbacks, knownFieldRoles).find(
        (field) => field.offset === offset,
      )!;
      expect(field.name).toBe("contextCounter");
      expect(field.contexts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ partType: 0, name: "tickCounter" }),
          expect.objectContaining({ partType: 1, name: "countdown" }),
        ]),
      );
      expect(field.description).toContain("reused");
    }
  });

  it.each([false, true])("recognizes the contact tuple with an optional pointer reload (%s)", (reload) => {
    const { image, table } = fieldRoleImage(0xa8, reload);
    const fields = discoverObjectFieldRoles(image, table, 2, fieldCallbacks, knownFieldRoles);
    expect(fields.find((field) => field.name === "contactPart")?.offset).toBe(0xb4);
    expect(fields.find((field) => field.name === "contactAngle")?.offset).toBe(0xb8);
    expect(fields.find((field) => field.name === "contactEdge")?.offset).toBe(0xba);
    expect(
      fields.find((field) => field.name === "contactEdge")?.evidence.some((entry) => entry.text === "dec ax"),
    ).toBe(true);
  });

  it("does not name a counter when its register is no longer the callback object", () => {
    const { image, table } = fieldRoleImage();
    image.set([0x8b, 0xf0], 0x200 + 4);
    image.set([0x8b, 0xf0], 0x300 + 4);
    expect(
      discoverObjectFieldRoles(image, table, 2, fieldCallbacks, knownFieldRoles).find((field) => field.offset === 0xa8),
    ).toBeUndefined();
  });

  it("requires the linked contact and boundary traversal proof before naming orientation fields", () => {
    const { image, table } = fieldRoleImage();
    image.fill(0x90, 0x800, 0x804);
    const fields = discoverObjectFieldRoles(image, table, 2, fieldCallbacks, knownFieldRoles);
    expect(fields.some((field) => field.name === "contactAngle" || field.name === "contactEdge")).toBe(false);
  });
});

function outlineRoleImage(pointer = 0x72, count = 0x6e, edgeWord = true) {
  const image = new Uint8Array(0x1000).fill(0x66);
  image.set([0xb8, 0x40, 0, 0x8e, 0xd8]);
  image.fill(0, 0x800, 0x800 + 58);
  for (let field = 0x22; field < 58; field += 4) image.set([0, 1, 0, 0], 0x800 + field);
  const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, 2, 0x8b, 0x7e, 6, 0x8b, 0xb5, pointer, 0];
  const body = bytes.length;
  bytes.push(0x8a, 4, 0x8a, 0x44, 1, 0x8a, 0x44, 4, 0x8a, 0x44, 5);
  bytes.push(...(edgeWord ? [0x89, 0x44, 2] : [0x90, 0x90, 0x90]));
  bytes.push(0xff, 0x46, 0xfe, 0x83, 0xc6, 4, 0x8b, 0x85, count, 0, 0x3b, 0x46, 0xfe);
  const jump = bytes.length;
  bytes.push(0x7f, (body - jump - 2) & 255, 0x8b, 0xe5, 0x5d, 0xcb);
  image.set(bytes, 0x100);
  return image;
}

describe("outline storage roles", () => {
  it.each([
    [0x72, 0x6e],
    [0x86, 0x84],
  ])("derives a separate record buffer and count from changed operands %s", (pointer, count) => {
    const fields = discoverObjectFieldRoles(
      outlineRoleImage(pointer, count),
      0x800,
      1,
      [{ field: 0x26, role: "run" }],
      [],
    );
    expect(fields).toContainEqual(
      expect.objectContaining({ name: "outlinePoints", offset: pointer, confidence: "inferred" }),
    );
    expect(fields).toContainEqual(expect.objectContaining({ name: "outlinePointCount", offset: count }));
    expect(fields.find((field) => field.name === "outlinePoints")!.evidence.length).toBeGreaterThan(4);
  });

  it("does not call scalar byte data an outline without the derived edge word", () => {
    expect(
      discoverObjectFieldRoles(outlineRoleImage(0x72, 0x6e, false), 0x800, 1, [{ field: 0x26, role: "run" }], []).some(
        (field) => field.name === "outlinePoints",
      ),
    ).toBe(false);
  });
});
