/**
 * Reads what TIM 2 says about its parts: `INFO.RES` lists every part number with its English name and help text, and
 * each part's `.ANM` animation names the sheets it draws from in a `TAG:` chunk.
 */

import { findChunk, readChunks } from "@opentim/resources";

/**
 * The English names in `INFO.RES`, by part number. Each line is the number with a dot, a tab, the name, a tab and
 * the help text, like `  0.\tBowling Ball\tThis bowling ball is very heavy…`.
 */
export function readPartNames(info: Uint8Array): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of String.fromCharCode(...info).split(/\r?\n/)) {
    const match = /^\s*(\d+)\.\t([^\t]+)/.exec(line);
    if (match) names.set(Number(match[1]), match[2]!.trim());
  }
  return names;
}

/** The sheets an animation draws from, in the order its `TAG:` chunk lists them, like `PART18X`. */
export function animationSheets(anm: Uint8Array): string[] {
  const tag = findChunk(readChunks(anm), "TAG:")?.data;
  if (!tag || tag.length < 2) return [];
  const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
  const sheets: string[] = [];
  let at = 2;
  for (let i = 0; i < view.getUint16(0, true) && at + 2 < tag.length; i++) {
    const end = tag.indexOf(0, at + 2);
    if (end < 0) break;
    sheets.push(
      String.fromCharCode(...tag.subarray(at + 2, end))
        .toUpperCase()
        .replace(/\.BMP$/, ""),
    );
    at = end + 1;
  }
  return sheets;
}
