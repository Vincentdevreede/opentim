<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import { MARGIN, partAt, type DrawnPart, type Scene } from "../../levels.ts";
import { compositionCanvas, patternCanvas } from "../pixels.ts";
import { sixteenColours } from "../tim2-colours.ts";

/**
 * Draws a level: the play area with a margin around it, every part where the file puts it, and the ropes and belts
 * between them. Boxes and numbers can be shown over the parts, and the puzzle's goal: the places it tests and the
 * parts it looks at. A click selects the part under the pointer.
 */
const props = defineProps<{
  scene: Scene;
  /** The palette for a part's sheet. */
  paletteOf: (sheet: string) => Uint8Array | undefined;
  /** The palette whose colours ropes and belts are drawn in. */
  linePalette?: Uint8Array;
  /** A colour of that palette to fill the play area with, as TIM2.EXE does with a level's background colour. */
  areaColour?: number;
  zoom: number;
  bounds: boolean;
  selected?: number;
  /** The places the puzzle's goal tests, numbered as its conditions show them, in pixels of the level. */
  goalAreas?: readonly { number: number; box: { x: number; y: number; width: number; height: number } }[];
  /** The parts the goal looks at, by their index in the level, which get a ring. */
  goalParts?: ReadonlySet<number>;
}>();
const emit = defineEmits<{ select: [index: number | undefined] }>();

const canvas = useTemplateRef<HTMLCanvasElement>("canvas");
const area = computed(() => props.scene.area);
const width = computed(() => area.value.width + 2 * MARGIN);
const height = computed(() => area.value.height + 2 * MARGIN);

/** The picture of each part, drawn once per scene and palette. */
const pictures = computed(
  () =>
    new Map(
      props.scene.parts.flatMap((d) =>
        d.composition?.placed.length || d.composition?.shapes?.length
          ? [
              [
                d.part.index,
                compositionCanvas(
                  d.composition,
                  props.paletteOf(d.composition.placed[0]?.placement.sheet ?? `PART${d.part.type}`),
                  { x: d.part.position.x, y: d.part.position.y, sixteen: sixteenColours.value },
                ),
              ],
            ]
          : [],
      ),
    ),
);

const knotPicture = computed(() =>
  props.scene.knot.placed.length ? compositionCanvas(props.scene.knot, props.paletteOf("GP_BORD")) : undefined,
);

const notePictures = computed(() =>
  props.scene.noteMarks.map((m) =>
    m.composition.placed.length ? compositionCanvas(m.composition, props.paletteOf("HANDLES")) : undefined,
  ),
);

/** Device pixels per CSS pixel, kept up to date when the page is zoomed or moved to another screen. */
const ratio = ref(1);
let ratioQuery: MediaQueryList | undefined;
function trackRatio() {
  ratioQuery?.removeEventListener("change", trackRatio);
  ratio.value = window.devicePixelRatio || 1;
  ratioQuery = window.matchMedia(`(resolution: ${ratio.value}dppx)`);
  ratioQuery.addEventListener("change", trackRatio);
}
onMounted(trackRatio);
onBeforeUnmount(() => ratioQuery?.removeEventListener("change", trackRatio));

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

function drawPicture(context: CanvasRenderingContext2D, d: DrawnPart, picture: HTMLCanvasElement) {
  const b = d.composition!.bounds;
  context.save();
  if (d.clip) {
    context.beginPath();
    context.rect(d.clip.x, d.clip.y, d.clip.width, d.clip.height);
    context.clip();
  }
  context.drawImage(picture, d.part.position.x + b.x, d.part.position.y + b.y);
  context.restore();
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
  // The canvas is drawn at a whole number of device pixels per pixel of the level, and the page scales it to the exact
  // zoom, so lines and text stay sharp on screens with more than one device pixel per CSS pixel too.
  const zoom = Math.max(1, Math.ceil(props.zoom * ratio.value));
  /** One pixel on the screen, in pixels of the level, for lines and labels that keep their size at any zoom. */
  const px = 1 / props.zoom;
  const colors = {
    margin: token("sunken"),
    line: token("line-strong"),
    accent: token("accent"),
    partial: token("partial"),
    muted: token("muted"),
    ink: token("ink"),
    goal: token("decoded"),
  };
  el.width = width.value * zoom;
  el.height = height.value * zoom;
  context.imageSmoothingEnabled = false;
  const { x: left, y: top, width: w, height: h } = area.value;
  context.setTransform(zoom, 0, 0, zoom, (MARGIN - left) * zoom, (MARGIN - top) * zoom);

  // Levels have no background picture: the canvas stays transparent over the background the page chooses, as sprites
  // do on the Sprites page. Everything outside the play area is darkened, in the canvas's margin and, by a shadow on the
  // canvas, up to the edges of the page, so parts placed outside the play area stand out.
  context.clearRect(left - MARGIN, top - MARGIN, width.value, height.value);
  context.fillStyle = "rgb(0 0 0 / 0.3)";
  context.fillRect(left - MARGIN, top - MARGIN, width.value, MARGIN);
  context.fillRect(left - MARGIN, top + h, width.value, MARGIN);
  context.fillRect(left - MARGIN, top, MARGIN, h);
  context.fillRect(left + w, top, MARGIN, h);
  const fill = props.areaColour === undefined ? undefined : paletteColor(props.linePalette, props.areaColour);
  // TIM2.EXE fills the play area with its box routine, which in 16 colours gives a colour of 16 or more a pattern.
  if (fill && sixteenColours.value && props.areaColour! > 15)
    context.drawImage(patternCanvas(w, h, props.areaColour!, props.linePalette!, top), left, top);
  else if (fill) {
    context.fillStyle = fill;
    context.fillRect(left, top, w, h);
  }
  context.strokeStyle = colors.line;
  context.lineWidth = px;
  context.strokeRect(left, top, w, h);

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

  // The notes’ pictures, after the parts.
  scene.noteMarks.forEach((m, i) => {
    const picture = notePictures.value[i];
    if (picture) context.drawImage(picture, m.at.x + m.composition.bounds.x, m.at.y + m.composition.bounds.y);
  });

  // The goal over the parts: the parts it looks at ringed, and the places it tests as numbered areas.
  for (const d of scene.parts) {
    if (!props.goalParts?.has(d.part.index) || !d.box.width || !d.box.height) continue;
    context.save();
    context.strokeStyle = colors.goal;
    context.lineWidth = 2 * px;
    context.strokeRect(d.box.x - 2 * px, d.box.y - 2 * px, d.box.width + 4 * px, d.box.height + 4 * px);
    context.restore();
  }
  for (const { number, box } of props.goalAreas ?? []) {
    context.save();
    context.fillStyle = `${colors.goal}26`;
    context.strokeStyle = colors.goal;
    context.lineWidth = 1.5 * px;
    context.setLineDash([5 * px, 3 * px]);
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.setLineDash([]);
    const label = String(number);
    context.font = `600 ${11 * px}px ui-monospace, monospace`;
    const w = context.measureText(label).width + 6 * px;
    // The number sits in the area's corner, kept inside the canvas for areas that run off it.
    const x = Math.max(box.x, left - MARGIN);
    const y = Math.max(box.y, top - MARGIN);
    context.fillStyle = colors.goal;
    context.fillRect(x, y, w, 14 * px);
    context.fillStyle = token("accent-ink");
    context.fillText(label, x + 3 * px, y + 11 * px);
    context.restore();
  }

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
  const x = ((e.clientX - rect.left) / rect.width) * width.value - MARGIN + area.value.x;
  const y = ((e.clientY - rect.top) / rect.height) * height.value - MARGIN + area.value.y;
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
