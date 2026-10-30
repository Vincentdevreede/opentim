import { frameToRgba, type Frame } from "@opentim/resources";
import type { Composition } from "../parts.ts";

/** Without a palette, the indexes are shown as grey levels. */
export const greys = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));

/** Fades every drawn pixel that isn't the highlighted palette index. */
export function fade(rgba: Uint8ClampedArray, frame: Frame, highlight: number) {
  for (let i = 0; i < frame.pixels.length; i++) {
    if (frame.mask[i] && frame.pixels[i] !== highlight) rgba[i * 4 + 3] = 40;
  }
}

/** A canvas with a frame at its own size. */
export function frameCanvas(frame: Frame, palette: Uint8Array = greys, highlight?: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const rgba = frameToRgba(frame, palette);
  if (highlight !== undefined) fade(rgba, frame, highlight);
  canvas.getContext("2d")?.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
  return canvas;
}

/** A canvas with a frame of a part: its sprites put together, at its own size. */
export function compositionCanvas(composition: Composition, palette: Uint8Array = greys): HTMLCanvasElement {
  const { placed, bounds } = composition;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, bounds.width);
  canvas.height = Math.max(1, bounds.height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  for (const { placement, image, x, y } of placed) {
    const flip = placement.flip ?? "";
    context.save();
    context.translate(
      x - bounds.x + (flip.includes("h") ? image.width : 0),
      y - bounds.y + (flip.includes("v") ? image.height : 0),
    );
    context.scale(flip.includes("h") ? -1 : 1, flip.includes("v") ? -1 : 1);
    context.drawImage(frameCanvas(image, palette), 0, 0);
    context.restore();
  }
  return canvas;
}
