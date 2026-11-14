import { frameToRgba, type Frame } from "@opentim/resources";
import { tim2FillColour, tim2LinePixels, type Composition, type Shape } from "@opentim/content";

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

/** Where a part is on the screen, and whether TIM 2 is drawn in its 16 colours. */
export interface ScreenPlace {
  /** Where the part's 0 is across the screen: TIM2.EXE leaves out the last pixel of some lines by where they end. */
  x?: number;
  /** Where the part's 0 is down the screen: the pattern TIM2.EXE fills a box with in 16 colours goes by the row. */
  y?: number;
  /** True to fill a box in a colour of 16 or more with the pattern TIM2.EXE's 16 colour driver gives it. */
  sixteen?: boolean;
}

/** A canvas with a frame of a part: its sprites put together, at its own size, as at `place` on the screen. */
export function compositionCanvas(
  composition: Composition,
  palette: Uint8Array = greys,
  place: ScreenPlace = {},
): HTMLCanvasElement {
  const { placed, bounds } = composition;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, bounds.width);
  canvas.height = Math.max(1, bounds.height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const shapes = composition.shapes ?? [];
  const drawShapes = (after: number) => {
    for (const s of shapes) if (s.after === after) drawShape(context, s, bounds, palette, place);
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
  for (const s of shapes) if (s.after > placed.length) drawShape(context, s, bounds, palette, place);
  return canvas;
}

/** A palette index as CSS. */
const css = (palette: Uint8Array, index: number) =>
  `rgb(${palette[index * 3] ?? 0} ${palette[index * 3 + 1] ?? 0} ${palette[index * 3 + 2] ?? 0})`;

/**
 * A box TIM2.EXE's 16 colour driver fills with a colour of 16 or more: a pattern of the colour's two halves, by the
 * column in the box and the row on the screen (`tim2FillColour`). `top` is the box's top row on the screen.
 */
export function patternCanvas(width: number, height: number, colour: number, palette: Uint8Array, top: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const rgba = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  for (let j = 0; j < canvas.height; j++)
    for (let i = 0; i < canvas.width; i++) {
      const c = tim2FillColour(colour, i, top + j);
      const at = (j * canvas.width + i) * 4;
      rgba.set([palette[c * 3] ?? 0, palette[c * 3 + 1] ?? 0, palette[c * 3 + 2] ?? 0, 255], at);
    }
  canvas.getContext("2d")?.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);
  return canvas;
}

/** Draws a box or a line of a frame in whole pixels, the line as TIM2.EXE's 16 colour driver does. */
function drawShape(
  context: CanvasRenderingContext2D,
  s: Shape,
  at: { x: number; y: number },
  palette: Uint8Array,
  place: ScreenPlace,
) {
  const screenX = place.x ?? 0;
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
    if (place.sixteen && s.fill > 15 && s.width > 0 && s.height > 0)
      context.drawImage(
        patternCanvas(s.width, s.height, s.fill, palette, (place.y ?? 0) + s.y),
        s.x - at.x,
        s.y - at.y,
      );
    else {
      context.fillStyle = css(palette, s.fill);
      context.fillRect(s.x - at.x, s.y - at.y, s.width, s.height);
    }
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
