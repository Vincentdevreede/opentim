/** Decoding the sprite sheets, screens and palettes of the loaded files, for the Sprites page. */

import { FormatError, decodeImage, readPalette, type Image } from "@opentim/resources";
import type { Resource } from "./importer.ts";

export type Decoded =
  | { status: "decoded"; image: Image }
  /** A text file with an image name, like the linker map `TOONS.BMP` in Sid & Al's Incredible Toons. */
  | { status: "text" }
  /** `offset` is where in the resource the decoder stopped, when known. */
  | { status: "error"; message: string; offset?: number };

/** The game's main palette, used when an image has no palette of its own. Toons calls it `GAME.PAL`. */
const MAIN_PALETTES = ["TIM.PAL", "GAME.PAL"];

const decoded = new WeakMap<Resource, Decoded>();
const palettes = new WeakMap<Resource, Uint8Array | undefined>();

export const isImage = (r: Resource) => r.group === "sprites" || r.group === "screen";

/** True when the data starts like text instead of a chunk: printable characters and line breaks. */
const looksLikeText = (data: Uint8Array) =>
  data.length > 0 && data.subarray(0, 64).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));

/** Decodes an image once; later calls return the same result. */
export function decode(resource: Resource): Decoded {
  let result = decoded.get(resource);
  if (!result) {
    try {
      result = { status: "decoded", image: decodeImage(resource.data) };
    } catch (error) {
      const offset = error instanceof FormatError ? error.offset : undefined;
      result = looksLikeText(resource.data)
        ? { status: "text" }
        : { status: "error", message: (error as Error).message, offset };
    }
    decoded.set(resource, result);
  }
  return result;
}

/** The colours of a palette resource, or undefined when it can't be read. */
export function paletteColors(resource: Resource): Uint8Array | undefined {
  if (!palettes.has(resource)) {
    try {
      palettes.set(resource, readPalette(resource.data));
    } catch {
      palettes.set(resource, undefined);
    }
  }
  return palettes.get(resource);
}

export interface PaletteChoice {
  name: string;
  /** Why this palette was chosen, for the user. */
  reason: string;
}

/**
 * Guesses the palette of an image from the names: the palette with the same name, like `TITLE.PAL` for `TITLE.SCR`,
 * or else the game's main palette. Undefined when there are no palettes.
 */
export function autoPalette(image: string, available: readonly string[]): PaletteChoice | undefined {
  const own = image.replace(/\.[^.]*$/, ".PAL");
  if (available.includes(own)) return { name: own, reason: "same name as the image" };
  const main = MAIN_PALETTES.find((p) => available.includes(p));
  if (main) return { name: main, reason: "the game’s main palette" };
  const first = available[0];
  return first ? { name: first, reason: "the only palette found" } : undefined;
}
