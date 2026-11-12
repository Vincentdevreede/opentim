/**
 * Reads the files a Dynamix TTM script loads, like Toons' `TITLE.TTM`. A script is chunks: `VER:`, `PAG:` and `TT3:`,
 * which holds the commands packed like a `BIN:` chunk. Each command is a u16: its low 4 bits are the number of u16
 * arguments that follow, or 15 for one NUL-terminated name, padded to an even length.
 */

import { FormatError, findChunk, readChunks } from "./chunk.ts";
import { decodeBin } from "./image.ts";

/** The commands of TTM scripts that load a file, by their u16. */
export const TTM_LOADS = { screen: 0xf01f, bitmap: 0xf02f, palette: 0xf05f } as const;
export type TtmLoad = keyof typeof TTM_LOADS;

export interface TtmFile {
  load: TtmLoad;
  /** The name as the script writes it, like `game.PAL`. */
  name: string;
}

const STRING_ARGUMENT = 0xf;

/** The files a TTM script loads, in the order of its commands. */
export function readTtmFiles(data: Uint8Array): TtmFile[] {
  const chunks = readChunks(data);
  const tt3 = findChunk(chunks, "TT3:");
  if (!tt3) throw new FormatError("No TT3: chunk", 0);
  const code = decodeBin(tt3.data);
  const loads = new Map<number, TtmLoad>(Object.entries(TTM_LOADS).map(([k, v]) => [v, k as TtmLoad]));
  const files: TtmFile[] = [];
  let at = 0;
  while (at + 2 <= code.length) {
    const command = code[at]! | (code[at + 1]! << 8);
    at += 2;
    const count = command & 0xf;
    if (count !== STRING_ARGUMENT) {
      at += 2 * count;
      continue;
    }
    const end = code.indexOf(0, at);
    if (end < 0) throw new FormatError("A name in the script has no end", at);
    const name = String.fromCharCode(...code.subarray(at, end));
    const load = loads.get(command);
    if (load) files.push({ load, name });
    at = end + 1 + ((end + 1 - at) & 1);
  }
  return files;
}

/**
 * The palette each image of the scripts is shown with, by upper-case name: the palette its script loaded last before
 * it, or else the first one the script loads after it, as a script can load a screen before its palette.
 */
export function ttmPalettes(scripts: readonly TtmFile[][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const files of scripts)
    files.forEach((file, i) => {
      if (file.load === "palette") return;
      const before = files.slice(0, i).findLast((f) => f.load === "palette");
      const after = files.slice(i + 1).find((f) => f.load === "palette");
      const palette = before ?? after;
      if (palette && !out.has(file.name.toUpperCase())) out.set(file.name.toUpperCase(), palette.name.toUpperCase());
    });
  return out;
}
