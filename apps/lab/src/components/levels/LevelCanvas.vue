<script setup lang="ts">
import { computed, useTemplateRef, watchEffect } from "vue";
import { MARGIN, PLAY_AREA, partAt, type DrawnPart, type Scene } from "../../levels.ts";
import { compositionCanvas } from "../pixels.ts";

/**
 * Draws a level: the play area with a margin around it, every part where the file puts it, and the ropes and belts
 * between them. Boxes and numbers can be shown over the parts. A click selects the part under the pointer.
 */
const props = defineProps<{
  scene: Scene;
  /** The palette for a part's sheet. */
  paletteOf: (sheet: string) => Uint8Array | undefined;
  /** The palette whose colours ropes and belts are drawn in. */
  linePalette?: Uint8Array;
  zoom: number;
  bounds: boolean;
  selected?: number;
}>();
const emit = defineEmits<{ select: [index: number | undefined] }>();

const canvas = useTemplateRef<HTMLCanvasElement>("canvas");
const width = PLAY_AREA.width + 2 * MARGIN;
const height = PLAY_AREA.height + 2 * MARGIN;

/** The picture of each part, drawn once per scene and palette. */
const pictures = computed(
  () =>
    new Map(
      props.scene.parts.flatMap((d) =>
        d.composition?.placed.length
          ? [
              [
                d.part.index,
                compositionCanvas(d.composition, props.paletteOf(d.composition.placed[0]!.placement.sheet)),
              ],
            ]
          : [],
      ),
    ),
);

const knotPicture = computed(() =>
  props.scene.knot.placed.length ? compositionCanvas(props.scene.knot, props.paletteOf("GP_BORD")) : undefined,
);

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

function drawPicture(context: CanvasRenderingContext2D, d: DrawnPart, picture: HTMLCanvasElement) {
  const b = d.composition!.bounds;
  context.drawImage(picture, d.part.position.x + b.x, d.part.position.y + b.y);
}

/** A colour of the game's palette as CSS, or undefined without a palette. */
function paletteColor(palette: Uint8Array | undefined, index: number) {
  if (!palette) return undefined;
  const [r, g, b] = [palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!];
  return `rgb(${r} ${g} ${b})`;
}

watchEffect(() => {
  const el = canvas.value;
  const context = el?.getContext("2d");
  if (!el || !context) return;
  const { scene, bounds, selected } = props;
  // The canvas is drawn at a whole zoom and the page scales it to the exact one, so lines and text stay sharp.
  const zoom = Math.max(1, Math.ceil(props.zoom));
  /** One pixel on the screen, in pixels of the level, for lines and labels that keep their size at any zoom. */
  const px = 1 / props.zoom;
  const colors = {
    margin: token("sunken"),
    line: token("line-strong"),
    accent: token("accent"),
    partial: token("partial"),
    muted: token("muted"),
    ink: token("ink"),
  };
  el.width = width * zoom;
  el.height = height * zoom;
  context.imageSmoothingEnabled = false;
  context.setTransform(zoom, 0, 0, zoom, MARGIN * zoom, MARGIN * zoom);

  // Levels have no background picture: the canvas stays transparent over the background the page chooses, as sprites
  // do on the Sprites page. Everything outside the play area is darkened, in the canvas's margin and, by a shadow on the
  // canvas, up to the edges of the page, so parts placed outside the play area stand out.
  context.clearRect(-MARGIN, -MARGIN, width, height);
  context.fillStyle = "rgb(0 0 0 / 0.3)";
  context.fillRect(-MARGIN, -MARGIN, width, MARGIN);
  context.fillRect(-MARGIN, PLAY_AREA.height, width, MARGIN);
  context.fillRect(-MARGIN, 0, MARGIN, PLAY_AREA.height);
  context.fillRect(PLAY_AREA.width, 0, MARGIN, PLAY_AREA.height);
  context.strokeStyle = colors.line;
  context.lineWidth = px;
  context.strokeRect(0, 0, PLAY_AREA.width, PLAY_AREA.height);

  for (const d of scene.parts) {
    const picture = pictures.value.get(d.part.index);
    if (picture) drawPicture(context, d, picture);
    else if (d.how === "outline" && d.box.width && d.box.height) {
      context.save();
      context.fillStyle = `${colors.partial}33`;
      context.strokeStyle = colors.partial;
      context.setLineDash([3, 2]);
      context.fillRect(d.box.x, d.box.y, d.box.width, d.box.height);
      context.strokeRect(d.box.x + 0.5, d.box.y + 0.5, d.box.width - 1, d.box.height - 1);
      context.restore();
    }
  }

  for (const line of scene.lines) {
    const on = line.part === selected;
    context.save();
    context.strokeStyle = on ? colors.accent : (paletteColor(props.linePalette, line.color) ?? colors.ink);
    context.lineWidth = on ? Math.max(1, 2 * px) : 1;
    context.beginPath();
    for (const [a, b] of line.segments) {
      context.moveTo(a.x + 0.5, a.y + 0.5);
      context.lineTo(b.x + 0.5, b.y + 0.5);
    }
    context.stroke();
    context.restore();
  }

  // The knots at the ends of ropes, as TIM.EXE draws them after the rope's line.
  const knot = knotPicture.value;
  if (knot)
    for (const line of scene.lines)
      for (const p of line.knots ?? []) context.drawImage(knot, p.x + scene.knot.bounds.x, p.y + scene.knot.bounds.y);

  for (const d of scene.parts) {
    const on = d.part.index === selected;
    if (d.how === "line" || (!bounds && !on) || !d.box.width || !d.box.height) continue;
    context.save();
    context.strokeStyle = on ? colors.accent : d.how === "outline" ? colors.partial : colors.muted;
    context.lineWidth = (on ? 2 : 1) * px;
    context.strokeRect(d.box.x, d.box.y, d.box.width, d.box.height);
    const label = `#${d.part.index}`;
    context.font = `${11 * px}px ui-monospace, monospace`;
    const w = context.measureText(label).width + 4 * px;
    context.fillStyle = on ? colors.accent : `${colors.margin}d0`;
    context.fillRect(d.box.x, d.box.y - 13 * px, w, 13 * px);
    context.fillStyle = on ? token("accent-ink") : colors.ink;
    context.fillText(label, d.box.x + 2 * px, d.box.y - 3 * px);
    context.restore();
  }
});

function onClick(e: MouseEvent) {
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width - MARGIN;
  const y = ((e.clientY - rect.top) / rect.height) * height - MARGIN;
  emit("select", partAt(props.scene, { x, y })?.part.index);
}
</script>

<template>
  <canvas
    ref="canvas"
    class="m-auto block shrink-0 cursor-crosshair shadow-[0_0_0_100vmax_rgb(0_0_0/0.3)]"
    :style="{ width: `${width * zoom}px`, height: `${height * zoom}px` }"
    aria-label="The level drawn from its file"
    @click="onClick"
  ></canvas>
</template>
