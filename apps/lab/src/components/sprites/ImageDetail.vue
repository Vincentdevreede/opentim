<script setup lang="ts">
import { computed, ref, watch, watchEffect } from "vue";
import { download, sheetCanvas } from "../../export.ts";
import type { Resource } from "../../importer.ts";
import { badgeOf, colorCounts, type Decoded } from "../../sprites.ts";
import { crumb, hex } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabKbd from "../LabKbd.vue";
import LabSegmented from "../LabSegmented.vue";
import LabSelect from "../LabSelect.vue";
import PaletteGrid from "../PaletteGrid.vue";
import PanelTitle from "../PanelTitle.vue";
import PixelFrame from "../PixelFrame.vue";
import { frameCanvas } from "../pixels.ts";
import { AUTO, usePalettes } from "./palettes.ts";
import { FPS, ZOOMS, fitScale, gridStyle, toggle, usePlayer, useSpriteKeys } from "./player.ts";
import SpriteStage, { type Background } from "./SpriteStage.vue";

const props = defineProps<{
  resource: Resource;
  decoded: Decoded;
  /** The palette setting of the gallery. */
  galleryPalette: string;
  /** The sprite to show first. */
  startSprite?: number;
}>();
const emit = defineEmits<{ viewBytes: [resource: Resource, offset?: number] }>();

const zoom = ref(2);
const flip = ref(false);
const background = ref<Background>("checker");
const grid = ref(false);
const onion = ref(false);
const tab = ref<"details" | "colours">("details");
const highlight = ref<number>();
const hover = ref<{ x: number; y: number; index?: number }>();
const detailPalette = ref(AUTO);

const { names, colorsOf, choose, options } = usePalettes();
/** The sprites of a sprite sheet, or the one image of a screen. */
const sprites = computed(() => (props.decoded.status === "decoded" ? props.decoded.image.frames : []));
const count = computed(() => sprites.value.length);
const player = usePlayer(count, props.startSprite ?? 0);
const { position, playing, move } = player;
const shownSprite = computed(() => sprites.value[position.value]);
const previous = computed(() => (position.value > 0 ? position.value - 1 : sprites.value.length - 1));

watch(
  () => props.resource,
  () => {
    position.value = props.startSprite ?? 0;
    playing.value = false;
  },
);

const choice = computed(() =>
  detailPalette.value === AUTO
    ? choose(props.resource.name, props.galleryPalette)
    : choose(props.resource.name, detailPalette.value),
);
const colors = computed(() => colorsOf(choice.value?.name));
const screen = computed(() => props.resource.group === "screen");
/** What one picture of the file is called: a sprite of a sheet, or the image of a screen. */
const noun = computed(() => (screen.value ? "image" : "sprite"));

/** Colours used by the shown sprite, with their pixel counts. */
const counts = computed(() => (shownSprite.value ? colorCounts(shownSprite.value) : new Map<number, number>()));
const usedRange = computed(() => {
  const indexes = [...counts.value.keys()];
  return indexes.length ? `${Math.min(...indexes)}–${Math.max(...indexes)}` : "none";
});

/** Reads the pixel under the mouse in the preview. */
function inspect(e: MouseEvent) {
  const f = shownSprite.value;
  if (!f) return;
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  let x = Math.floor((e.clientX - box.left) / zoom.value);
  const y = Math.floor((e.clientY - box.top) / zoom.value);
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) {
    hover.value = undefined;
    return;
  }
  if (flip.value) x = f.width - 1 - x;
  const i = y * f.width + x;
  hover.value = { x, y, index: f.mask[i] ? f.pixels[i] : undefined };
}

const rgb = (index: number) => {
  const p = colors.value;
  return p ? [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]] : [index, index, index];
};
const css = (index: number) => `rgb(${rgb(index).join(" ")})`;

const baseName = computed(() => props.resource.name.replace(/\.[^.]*$/, ""));
function exportSprite() {
  if (shownSprite.value)
    download(frameCanvas(shownSprite.value, colors.value), `${baseName.value}-${noun.value}${position.value}.png`);
}
const exportSheet = () => download(sheetCanvas(sprites.value, colors.value), `${baseName.value}-sheet.png`);
const compareScale = (width: number, height: number) => fitScale(width, height, 76, 52);

useSpriteKeys(player, count, zoom, (key) => {
  if (key === "h") flip.value = !flip.value;
  else if (key === "o") onion.value = !onion.value;
});

watchEffect(() => (crumb.value = ["Sprites", props.resource.name, `${noun.value} ${position.value}`]));

const zoomOptions = ZOOMS.map((z) => ({ value: z, label: `${z}×` }));
const backgrounds: { value: Background; label: string }[] = [
  { value: "checker", label: "Checks" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
];
const tabClass = (on: boolean) => (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink");
</script>

<template>
  <section :aria-label="`${resource.name} detail`" class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3">
      <span class="font-mono text-title font-semibold">{{ resource.name }}</span>
      <span class="text-muted">{{ screen ? "screen" : "sprite sheet" }}</span>
      <span v-if="shownSprite && !screen" class="text-muted"
        >Sprite <span class="font-mono text-ink">{{ position }}</span></span
      >
      <div class="flex-1"></div>
      <LabBadge v-bind="badgeOf(decoded)" />
    </div>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <SpriteStage :background="background">
          <div
            v-if="shownSprite"
            class="relative outline-1 outline-accent/55 outline-dashed"
            @mousemove="inspect"
            @mouseleave="hover = undefined"
          >
            <PixelFrame
              v-if="onion && sprites.length > 1"
              :frame="sprites[previous]!"
              :palette="colors"
              :scale="zoom"
              :flip="flip"
              class="absolute top-0 left-0 opacity-30"
            />
            <PixelFrame
              :frame="shownSprite"
              :palette="colors"
              :scale="zoom"
              :flip="flip"
              :highlight="highlight"
              class="relative"
            />
            <div v-if="grid && zoom >= 3" class="pointer-events-none absolute inset-0" :style="gridStyle(zoom)"></div>
          </div>
          <div
            v-else-if="decoded.status !== 'decoded'"
            role="alert"
            class="flex max-w-[420px] items-start gap-2.5 rounded-md border px-3 py-2.5"
            :class="decoded.status === 'error' ? 'border-error/40 bg-error/7' : 'border-line-strong bg-sunken'"
          >
            <LabIcon
              name="warning"
              :size="15"
              :stroke="2"
              class="mt-px"
              :class="decoded.status === 'error' ? 'text-error' : 'text-muted'"
            />
            <div class="flex flex-1 flex-col gap-[3px]">
              <template v-if="decoded.status === 'error'">
                <span class="font-semibold text-error">Couldn’t decode this file</span>
                <span class="font-mono text-meta text-ink">{{ decoded.message }}</span>
                <span class="text-muted">Other files are unaffected.</span>
              </template>
              <template v-else>
                <span class="font-semibold text-ink">Not an image</span>
                <span class="text-muted"
                  >This file is text, even though its name ends in .{{ resource.name.split(".").pop() }}.</span
                >
              </template>
              <div class="mt-1.5">
                <LabButton @click="emit('viewBytes', resource, decoded.status === 'error' ? decoded.offset : undefined)"
                  >View bytes{{
                    decoded.status === "error" && decoded.offset !== undefined ? ` at ${hex(decoded.offset, 4)}` : ""
                  }}</LabButton
                >
              </div>
            </div>
          </div>
          <p v-else class="text-muted">Nothing to show for this file.</p>
          <template #topLeft>{{ zoom }}× · nearest</template>
          <template #topRight>{{ shownSprite?.width ?? 0 }} × {{ shownSprite?.height ?? 0 }}</template>
          <template v-if="hover" #bottomLeft>
            x {{ hover.x }}, y {{ hover.y }} ·
            <template v-if="hover.index !== undefined">
              <span
                class="size-3 rounded-[2px] border border-line-strong"
                :style="{ background: css(hover.index) }"
              ></span>
              colour {{ hover.index }} · {{ rgb(hover.index).join(" ") }}
            </template>
            <template v-else>transparent</template>
          </template>
        </SpriteStage>

        <div class="flex shrink-0 flex-col gap-2 border-t border-line bg-sunken px-3 py-2.5">
          <div class="flex items-center gap-1.5">
            <LabButton icon :aria-label="`Previous ${noun}`" :disabled="count < 2" @click="move(-1)">
              <LabIcon name="chevronLeft" :size="13" :stroke="2.5" />
            </LabButton>
            <LabButton
              icon
              :aria-label="playing ? 'Pause preview' : 'Play preview'"
              :aria-pressed="playing"
              :disabled="count < 2"
              :class="toggle(playing)"
              @click="playing = !playing"
            >
              <LabIcon :name="playing ? 'pause' : 'play'" :size="12" :stroke="0" class="fill-current" />
            </LabButton>
            <LabButton icon :aria-label="`Next ${noun}`" :disabled="count < 2" @click="move(1)">
              <LabIcon name="chevronRight" :size="13" :stroke="2.5" />
            </LabButton>
            <label class="flex min-w-0 flex-1 items-center">
              <span class="sr-only">{{ screen ? "Image" : "Sprite" }}</span>
              <input
                v-model.number="position"
                class="w-full accent-accent"
                type="range"
                min="0"
                :max="Math.max(0, count - 1)"
                step="1"
                :disabled="count < 2"
              />
            </label>
            <span class="min-w-11 text-right font-mono whitespace-nowrap"
              >{{ position }} / {{ Math.max(0, count - 1) }}</span
            >
          </div>
          <p class="text-meta text-muted">
            Steps through the sprites in file order, {{ FPS }} a second, which isn’t an animation by itself.
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <LabSegmented v-model="zoom" label="Zoom" :options="zoomOptions" />
            <LabButton :aria-pressed="flip" :class="toggle(flip)" title="Flip horizontally (H)" @click="flip = !flip">
              <LabIcon name="flip" :size="13" :stroke="2" />Flip
            </LabButton>
            <LabButton
              :aria-pressed="onion"
              :class="toggle(onion)"
              title="Show the previous sprite faintly behind (O)"
              @click="onion = !onion"
              >Onion</LabButton
            >
            <LabButton
              :aria-pressed="grid"
              :class="toggle(grid)"
              :disabled="zoom < 3"
              title="Pixel grid, from 3×"
              @click="grid = !grid"
              >Grid</LabButton
            >
            <div class="flex-1"></div>
            <LabSegmented v-model="background" label="Background" :options="backgrounds" />
          </div>
        </div>

        <div class="flex shrink-0 flex-col border-t border-line bg-sunken" :class="screen ? 'h-[170px]' : 'h-[150px]'">
          <div class="flex h-8 shrink-0 items-center gap-1 border-b border-line px-3">
            <PanelTitle>{{ screen ? "Images" : "Sprites" }} · {{ count }}</PanelTitle>
            <div class="flex-1"></div>
            <span class="text-meta text-muted"
              ><LabKbd>←</LabKbd> <LabKbd>→</LabKbd> sprite <LabKbd>Space</LabKbd> play <LabKbd>H</LabKbd> flip
              <LabKbd>O</LabKbd> onion</span
            >
          </div>
          <div class="flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 py-2">
            <button
              v-for="(f, i) in sprites"
              :key="i"
              type="button"
              class="flex shrink-0 cursor-pointer flex-col gap-1 rounded-md border bg-surface p-1"
              :class="[
                screen ? 'w-[140px]' : 'w-[76px]',
                i === position
                  ? 'border-accent bg-accent/12 ring-1 ring-accent'
                  : 'border-line hover:border-line-strong',
              ]"
              :data-item="i === position ? 'selected' : ''"
              :aria-label="`${screen ? 'Image' : 'Sprite'} ${i}, ${f.width} × ${f.height}`"
              @click="position = i"
            >
              <span
                class="flex items-center justify-center overflow-hidden rounded-[3px] checker"
                :class="screen ? 'h-[80px]' : 'h-[60px]'"
              >
                <PixelFrame
                  :frame="f"
                  :palette="colors"
                  :scale="screen ? fitScale(f.width, f.height, 130, 76) : fitScale(f.width, f.height, 66, 56)"
                />
              </span>
              <span class="flex justify-between gap-1 px-0.5 font-mono text-2xs text-muted">
                <span>{{ i }}</span>
                <span class="truncate">{{ f.width }}×{{ f.height }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <aside aria-label="Image file data" class="flex w-[300px] shrink-0 flex-col border-l border-line bg-sunken">
        <div class="flex shrink-0 border-b border-line px-3" role="tablist">
          <button
            v-for="t in ['details', 'colours'] as const"
            :key="t"
            type="button"
            role="tab"
            :aria-selected="tab === t"
            class="-mb-px h-8 cursor-pointer border-b-2 px-2 text-label font-semibold tracking-[.07em] uppercase"
            :class="tabClass(tab === t)"
            @click="tab = t"
          >
            {{ t === "details" ? "Details" : "Colours" }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-3 py-2.5">
          <div v-if="tab === 'details'" class="flex flex-col gap-3">
            <dl class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-[5px] font-mono text-ui">
              <dt class="text-muted">file</dt>
              <dd>
                {{ resource.name }} <span class="text-muted">in {{ resource.archive }}</span>
              </dd>
              <template v-if="decoded.status === 'decoded' && shownSprite">
                <dt class="text-muted">{{ noun }}</dt>
                <dd>{{ position }} of {{ sprites.length }}</dd>
                <dt class="text-muted">size</dt>
                <dd>{{ shownSprite.width }} × {{ shownSprite.height }}</dd>
                <dt class="text-muted">encoding</dt>
                <dd>{{ decoded.image.encoding }}</dd>
              </template>
              <dt class="text-muted">palette</dt>
              <dd>
                {{ choice?.name ?? "none, shown in grey" }}
                <span v-if="choice" class="text-muted">({{ choice.reason }})</span>
              </dd>
            </dl>
            <LabSelect
              v-model="detailPalette"
              label="Palette for this image"
              :options="options('Palette: as gallery')"
            />
            <div v-if="shownSprite" class="flex flex-wrap gap-2">
              <LabButton @click="exportSprite">Save {{ noun }} as PNG</LabButton>
              <LabButton @click="exportSheet">Save sheet as PNG</LabButton>
            </div>
            <div>
              <LabButton variant="ghost" @click="emit('viewBytes', resource)">
                <LabIcon name="bytes" :size="13" :stroke="2" />View bytes in Files
              </LabButton>
            </div>
          </div>

          <div v-else class="flex flex-col gap-3">
            <p class="text-meta text-muted">
              <span class="font-mono text-ink">{{ counts.size }}</span> colours used · indexes
              <span class="font-mono text-ink">{{ usedRange }}</span
              >. Hover a colour to find its pixels.
            </p>
            <PaletteGrid v-model:highlight="highlight" :palette="colors" :counts="counts" />
            <div class="flex flex-col gap-1.5">
              <PanelTitle>Try another palette</PanelTitle>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="name in names"
                  :key="name"
                  type="button"
                  class="flex cursor-pointer flex-col items-center gap-1 rounded-md border p-1"
                  :class="choice?.name === name ? 'border-accent bg-accent/12' : 'border-line hover:border-line-strong'"
                  :title="`Use ${name} for this image`"
                  @click="detailPalette = name"
                >
                  <span class="flex h-14 w-full items-center justify-center overflow-hidden rounded-[3px] checker">
                    <PixelFrame
                      v-if="shownSprite"
                      :frame="shownSprite"
                      :palette="colorsOf(name)"
                      :scale="compareScale(shownSprite.width, shownSprite.height)"
                    />
                  </span>
                  <span class="w-full truncate text-center font-mono text-2xs text-muted">{{
                    name.replace(/\.PAL$/, "")
                  }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
