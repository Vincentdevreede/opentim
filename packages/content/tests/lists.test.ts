import { describe, expect, it } from "vitest";
import { PART_LISTS, partOfType, type Part, type PartList } from "../src/index.ts";

const lists = Object.values(PART_LISTS);
const { tim1, evenmore, tim2 } = PART_LISTS as Record<"tim1" | "evenmore" | "tim2", PartList>;

describe("the part lists", () => {
  it("has the lists the version catalog refers to", () => {
    expect(Object.keys(PART_LISTS).sort()).toEqual(["evenmore", "tim1", "tim2"]);
  });

  it.each(lists.map((l) => [l.id, l] as const))("gives every part of %s a unique name as id", (_, list) => {
    const ids = list.parts.map((p) => p.id);
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    const types = list.parts.map((p) => p.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it.each(lists.map((l) => [l.id, l] as const))("only draws %s parts from their own sheets", (_, list) => {
    const strays = list.parts.flatMap((part) =>
      part.frames
        .flatMap((f) => f.sprites)
        .filter((sprite) => !part.sheets.includes(sprite.sheet))
        .map((sprite) => `${part.id}: ${sprite.sheet}`),
    );
    expect(strays).toEqual([]);
  });

  it("keeps every TIM 1 part in Even More, with the same frames", () => {
    // Even More can add a sheet, like the rope's knot, with the frames drawn from it.
    const onlyFrom = (part: Part | undefined, sheets: string[]) =>
      part && {
        ...part,
        sheets,
        frames: part.frames.filter((f) => f.sprites.every((s) => sheets.includes(s.sheet))),
      };
    for (const part of tim1.parts) expect(onlyFrom(partOfType(evenmore, part.type), part.sheets)).toEqual(part);
  });

  it("shows sprite N as frame N for a part without pieces, at the frame's position", () => {
    const cat = partOfType(tim1, 12)!;
    expect(cat.frames).toHaveLength(10);
    expect(cat.frames[1]).toEqual({ id: 1, sprites: [{ sheet: "PART12", sprite: 1, x: -6, y: -16, layer: 3 }] });
    expect(partOfType(tim1, 0)!.frames).toEqual([
      { id: 0, sprites: [{ sheet: "PART0", sprite: 0, x: 0, y: 0, layer: 3 }] },
    ]);
  });

  it("leaves out the frames of parts the program draws its own way", () => {
    for (const type of [1, 7, 14]) expect(partOfType(evenmore, type)!.frames).toEqual([]);
  });

  it("gives an object that moved in TIM 2 its id at its new number", () => {
    expect(partOfType(tim1, 3)?.id).toBe("teeter-totter");
    expect(partOfType(tim2, 3)?.id).toBe("tipsy-trailer");
    expect(partOfType(tim2, 139)?.id).toBe("teeter-totter");
    expect(partOfType(tim2, 138)?.id).toBe("candle");
  });

  it("has TIM 2's parts 0–148 with the game's own names", () => {
    expect(tim2.parts.map((p) => p.type)).toEqual(Array.from({ length: 149 }, (_, i) => i));
    expect(tim2.parts.filter((p) => !p.name)).toEqual([]);
  });
});
