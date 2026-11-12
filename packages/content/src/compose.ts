/** Putting the sprites of a frame together. It only asks a sprite source for images and never sees palettes. */

import type { Frame as Bitmap } from "@opentim/resources";
import type { Part, Placement } from "./model.ts";

/** A sprite of a sheet, decoded, or undefined when the sheet or sprite isn't in the loaded files. */
export type SpriteOf = (sheet: string, sprite: number) => Bitmap | undefined;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sprite placed in a frame, with its position after pulling the layers apart. */
export interface Placed {
  placement: Placement;
  image: Bitmap;
  x: number;
  y: number;
}

export interface Composition {
  /** In drawing order. */
  placed: Placed[];
  /** The box around the drawn sprites, relative to the part's origin. */
  bounds: Bounds;
  /** Placements whose sprite isn't in the loaded files. */
  missing: Placement[];
}

/**
 * The layers of these placements in drawing order. Which layer the game draws on top isn't known; the Sprite Lab
 * research suggests layer 5 first and 0 last, so that is the guess here.
 */
export const drawOrder = (sprites: readonly Placement[]) =>
  [...new Set(sprites.map((s) => s.layer))].sort((a, b) => b - a);

/**
 * Puts a frame's sprites together. Hidden layers are left out, and `spread` moves each layer that many units further
 * down than the one drawn before it, to see the layers apart.
 */
export function compose(
  sprites: readonly Placement[],
  spriteOf: SpriteOf,
  { hidden = new Set<number>(), spread = 0 }: { hidden?: ReadonlySet<number>; spread?: number } = {},
): Composition {
  const layers = drawOrder(sprites).filter((l) => !hidden.has(l));
  const placed: Placed[] = [];
  const missing: Placement[] = [];
  layers.forEach((layer, rank) => {
    for (const placement of sprites.filter((s) => s.layer === layer)) {
      const image = spriteOf(placement.sheet, placement.sprite);
      if (image) placed.push({ placement, image, x: placement.x, y: placement.y + rank * spread });
      else missing.push(placement);
    }
  });
  if (!placed.length) return { placed, bounds: { x: 0, y: 0, width: 0, height: 0 }, missing };
  const x = Math.min(...placed.map((p) => p.x));
  const y = Math.min(...placed.map((p) => p.y));
  const right = Math.max(...placed.map((p) => p.x + p.image.width));
  const bottom = Math.max(...placed.map((p) => p.y + p.image.height));
  return { placed, bounds: { x, y, width: right - x, height: bottom - y }, missing };
}

/** The sprites of a part's first frame, or the first sprite of its sheet when the list has no frames for it. */
export function coverSprites(part: Part): Placement[] {
  const first = part.frames[0]?.sprites;
  if (first) return first;
  const sheet = part.sheets[0];
  return sheet ? [{ sheet, sprite: 0, x: 0, y: 0, layer: 0 }] : [];
}

/**
 * A part's sequences in the game's order, each with the states it runs through and the frame each state shows. A
 * sequence starts at its state and runs until the next one starts, the last one to the part's last state.
 */
export function partSequences(part: Part): { sequence: number; states: number[]; frames: number[] }[] {
  const end = part.states?.length ?? part.frames.length;
  const starts = [...new Set(part.sequences?.map((s) => s.state) ?? [])].sort((a, b) => a - b);
  return (part.sequences ?? [])
    .map(({ sequence, state }) => {
      const next = starts.find((s) => s > state) ?? end;
      const states = Array.from({ length: Math.max(0, next - state) }, (_, i) => state + i);
      return { sequence, states, frames: states.map((s) => part.states?.[s] ?? s) };
    })
    .sort((a, b) => (a.states[0] ?? 0) - (b.states[0] ?? 0));
}
