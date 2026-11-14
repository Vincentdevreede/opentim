import { frameToRgba, type Frame } from "@opentim/resources";
import { tim2LinePixels, type Composition, type Shape } from "@opentim/content";

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

/**
 * A canvas with a frame of a part: its sprites put together, at its own size. `screenX` is where the part's 0 is across
 * the screen: TIM2.EXE leaves out the last pixel of some lines by where they end on the screen (`tim2LinePixels`).
 */
export function compositionCanvas(
  composition: Composition,
  palette: Uint8Array = greys,
  screenX = 0,
): HTMLCanvasElement {
  const { placed, bounds } = composition;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, bounds.width);
  canvas.height = Math.max(1, bounds.height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const shapes = composition.shapes ?? [];
  const drawShapes = (after: number) => {
    for (const s of shapes) if (s.after === after) drawShape(context, s, bounds, palette, screenX);
  };
  drawShapes(0);
  for (const [k, { placement, image, x, y }] of placed.entries()) {
    const flip = placement.flip ?? "";
    context.save();
    context.translate(
      x - bounds.x + (flip.includes("h") ? image.width : 0),
      y - bounds.y + (flip.includes("v") ? image.height : 0),
    );
    context.scale(flip.includes("h") ? -1 : 1, flip.includes("v") ? -1 : 1);
    context.drawImage(frameCanvas(image, palette), 0, 0);
    context.restore();
    drawShapes(k + 1);
  }
  for (const s of shapes) if (s.after > placed.length) drawShape(context, s, bounds, palette, screenX);
  return canvas;
}

/** A palette index as CSS. */
const css = (palette: Uint8Array, index: number) =>
  `rgb(${palette[index * 3] ?? 0} ${palette[index * 3 + 1] ?? 0} ${palette[index * 3 + 2] ?? 0})`;

/** Draws a box or a line of a frame in whole pixels, the line as TIM2.EXE's 16 colour driver does. */
function drawShape(
  context: CanvasRenderingContext2D,
  s: Shape,
  at: { x: number; y: number },
  palette: Uint8Array,
  screenX: number,
) {
  const dot = (x: number, y: number) => context.fillRect(x - at.x, y - at.y, 1, 1);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++)
      dot(Math.round(x1 + ((x2 - x1) * i) / (steps || 1)), Math.round(y1 + ((y2 - y1) * i) / (steps || 1)));
  };
  if (s.kind === "line") {
    context.fillStyle = css(palette, s.colour);
    for (const p of tim2LinePixels(s.x1 + screenX, s.y1, s.x2 + screenX, s.y2)) dot(p.x - screenX, p.y);
    return;
  }
  if (s.fill !== undefined) {
    context.fillStyle = css(palette, s.fill);
    context.fillRect(s.x - at.x, s.y - at.y, s.width, s.height);
    if (s.fill === s.colour) return;
  }
  context.fillStyle = css(palette, s.colour);
  const right = s.x + s.width - 1;
  const bottom = s.y + s.height - 1;
  line(s.x, s.y, right, s.y);
  line(s.x, bottom, right, bottom);
  line(s.x, s.y, s.x, bottom);
  line(right, s.y, right, bottom);
}
