/** The palettes of the loaded files, and which one an image is shown with. */

import { computed } from "vue";
import { tim2SixteenColours } from "@opentim/content";
import { resources } from "../../library.ts";
import { autoPalette, paletteColors, scriptPalettes, type PaletteChoice } from "../../sprites.ts";
import { sixteenColours } from "../tim2-colours.ts";

/** The setting for the palette chosen automatically from the image's name. */
export const AUTO = "auto";

const sixteens = new WeakMap<Uint8Array, Uint8Array>();

/** A palette as TIM2.EXE's 16 colour driver shows it, made once per palette. */
function sixteenOf(palette: Uint8Array): Uint8Array {
  let made = sixteens.get(palette);
  if (!made) sixteens.set(palette, (made = tim2SixteenColours(palette)));
  return made;
}

export function usePalettes() {
  const palettes = computed(() => resources.value.filter((r) => r.group === "palette" && paletteColors(r)));
  const names = computed(() => palettes.value.map((r) => r.name));

  /** A palette's colours, for TIM 2 in 16 colours as the game shows them when the setting asks for that. */
  const colorsOf = (name?: string) => {
    const r = palettes.value.find((p) => p.name === name);
    const colors = r && paletteColors(r);
    return colors && sixteenColours.value ? sixteenOf(colors) : colors;
  };

  /** The palette for an image: the chosen one, or else the automatic one. */
  const choose = (image: string, setting: string): PaletteChoice | undefined =>
    names.value.includes(setting)
      ? { name: setting, reason: "chosen" }
      : autoPalette(image, names.value, scriptPalettes(resources.value));

  /** The options of a palette select whose first option follows another setting. */
  const options = (first: string) => [
    { value: AUTO, label: first },
    ...names.value.map((n) => ({ value: n, label: n })),
  ];

  return { names, colorsOf, choose, options };
}
