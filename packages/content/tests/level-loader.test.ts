import { expect, it } from "vitest";
import { LOADED_FIELDS, LOADED_HEADERS } from "../src/read/level-loader.ts";
import { GAME_BUILDS, PART_RECORD } from "../src/run/game.ts";

it("knows the header's words for every build the level recorder runs", () => {
  expect([...LOADED_HEADERS.keys()].sort()).toEqual([...GAME_BUILDS.keys()].sort());
  for (const [hash, header] of LOADED_HEADERS) expect(header.build).toBe(GAME_BUILDS.get(hash)!.name);
});

it("keeps every field's words inside the part record a step keeps", () => {
  for (const place of Object.values(LOADED_FIELDS))
    for (const at of [...place.at, ...(place.also ?? []), ...(place.through ? [place.through.word] : [])])
      expect(at).toBeLessThan(PART_RECORD);
});
