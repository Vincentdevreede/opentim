/** The palettes of the loaded files, and which one an image is shown with. */

import { computed } from "vue";
import { resources } from "../../library.ts";
import { autoPalette, paletteColors, type PaletteChoice } from "../../sprites.ts";

/** The setting for the palette chosen automatically from the image's name. */
export const AUTO = "auto";
export const AUTO_HINT =
  "Automatic: the palette with the image’s name, like TITLE.PAL for TITLE.SCR, or else the game’s main palette. Guessed from the names, not read from the file.";

export function usePalettes() {
  const palettes = computed(() => resources.value.filter((r) => r.group === "palette" && paletteColors(r)));
  const names = computed(() => palettes.value.map((r) => r.name));

  const colorsOf = (name?: string) => {
    const r = palettes.value.find((p) => p.name === name);
    return r && paletteColors(r);
  };

  /** The palette for an image: the chosen one, or else the automatic one. */
  const choose = (image: string, setting: string): PaletteChoice | undefined =>
    names.value.includes(setting) ? { name: setting, reason: "chosen" } : autoPalette(image, names.value);

  /** The options of a palette select whose first option follows another setting. */
  const options = (first: string) => [
    { value: AUTO, label: first },
    ...names.value.map((n) => ({ value: n, label: n })),
  ];

  return { names, colorsOf, choose, options };
}
