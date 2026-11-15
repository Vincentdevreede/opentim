import { describe, expect, it } from "vitest";
import {
  PART_LISTS,
  PART_NAMES,
  TOONS_PART_NAMES,
  partNamesOf,
  partOfType,
  type Part,
  type PartList,
} from "../src/index.ts";
import toonsNames from "../src/lists/toons-names.json" with { type: "json" };

const lists = Object.values(PART_LISTS);
const { tim1, evenmore, tim2, toons } = PART_LISTS as Record<"tim1" | "evenmore" | "tim2" | "toons", PartList>;

describe("the part lists", () => {
  it("has the lists the version catalog refers to", () => {
    expect(Object.keys(PART_LISTS).sort()).toEqual(["evenmore", "tim1", "tim2", "toons"]);
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

  it("has TIM 2's parts 0–148, each with the game's own name in the names list", () => {
    expect(tim2.parts.map((p) => p.type)).toEqual(Array.from({ length: 149 }, (_, i) => i));
    expect(tim2.parts.filter((p) => !PART_NAMES.has(p.id))).toEqual([]);
    expect(PART_NAMES.get("bowling-ball")).toBe("Bowling Ball");
  });

  it("keeps names out of the game lists and names only ids a list has", () => {
    expect(lists.flatMap((l) => l.parts).filter((p) => p.name !== undefined)).toEqual([]);
    const ids = new Set(lists.filter((l) => l.id !== "toons").flatMap((l) => l.parts.map((p) => p.id)));
    expect([...PART_NAMES.keys()].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("keeps Toons' names apart, each for a Toons part and with the level or file it comes from", () => {
    const ids = new Set(toons.parts.map((p) => p.id));
    expect([...TOONS_PART_NAMES.keys()].filter((id) => !ids.has(id))).toEqual([]);
    expect(toonsNames.names.filter((n) => !/^([A-Z]{4}\d+|[A-Z]+\.[A-Z]{3})[ ,:]/.test(n.from))).toEqual([]);
    expect(partNamesOf("toons").get("teeter-totter")).toBe("Teeter-Totter");
    expect(partNamesOf("toons").get("eye-hook")).toBe("Eyehook");
    expect(partNamesOf("toons").get("mallet")).toBeUndefined();
    expect(partNamesOf("tim1").get("pulley")).toBe("Pulley");
  });

  it("has Toons' parts with a sheet, and Al and Sid, who have none", () => {
    expect(toons.parts).toHaveLength(75);
    const al = partOfType(toons, 36);
    expect(al).toMatchObject({ id: "al-e-cat" });
    expect(al?.frames).toHaveLength(520);
    expect(al?.frames[0]?.sprites).toEqual([{ sheet: "CATROOT", sprite: 0, x: 0, y: 0, layer: 3 }]);
    expect(partOfType(toons, 37)?.frames[0]?.sprites[0]?.sheet).toBe("SIDROOT");
    expect(partOfType(toons, 45)?.tiles).toEqual({ width: 32, middles: 1 });
  });
});
