/** Saving images from the lab as PNG files. */

import type { Frame } from "@opentim/resources";
import { frameCanvas } from "./components/pixels.ts";

const SHEET_WIDTH = 512;
const GAP = 1;

/** Puts frames on one canvas in rows, left to right, with a pixel between them. */
export function sheetCanvas(frames: Frame[], palette?: Uint8Array): HTMLCanvasElement {
  const places: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  for (const frame of frames) {
    if (x > 0 && x + frame.width > SHEET_WIDTH) {
      x = 0;
      y += row + GAP;
      row = 0;
    }
    places.push({ x, y });
    x += frame.width + GAP;
    row = Math.max(row, frame.height);
    width = Math.max(width, x - GAP);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, y + row);
  const context = canvas.getContext("2d");
  frames.forEach((frame, i) => context?.drawImage(frameCanvas(frame, palette), places[i]!.x, places[i]!.y));
  return canvas;
}

/** Saves a canvas as a PNG file. */
export function download(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
}
