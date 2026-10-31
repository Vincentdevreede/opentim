<script setup lang="ts">
import type { Part, Placement } from "@opentim/content";
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, reactive, ref, watch, watchEffect } from "vue";
import { download } from "../../export.ts";
import { compose, drawOrder, partName, sheetFile, type SpriteOf } from "../../parts.ts";
import { crumb } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabKbd from "../LabKbd.vue";
import LabSegmented from "../LabSegmented.vue";
import LabSelect from "../LabSelect.vue";
import PanelTitle from "../PanelTitle.vue";
import PartPicture from "../PartPicture.vue";
import PixelFrame from "../PixelFrame.vue";
import { compositionCanvas } from "../pixels.ts";
import { AUTO, usePalettes } from "./palettes.ts";
import { FPS, ZOOMS, fitScale, gridStyle, toggle, usePlayer, useSpriteKeys } from "./player.ts";
import SpriteStage, { type Background } from "./SpriteStage.vue";

const props = defineProps<{
  part: Part;
  /** The sprites of a sheet in the loaded files, or undefined when it isn't there. */
  sheetSprites: (sheet: string) => Bitmap[] | undefined;
  /** The palette setting of the gallery. */
  galleryPalette: string;
}>();
const emit = defineEmits<{ openSheet: [file: string] }>();

type Strip = "frames" | "sprites";

const strip = ref<Strip>("frames");
const zoom = ref(3);
const flipX = ref(false);
const flipY = ref(false);
const background = ref<Background>("checker");
const grid = ref(false);
const origin = ref(true);
const spread = ref(0);
const hidden = reactive(new Set<number>());
const detailPalette = ref(AUTO);

const { colorsOf, choose, options } = usePalettes();
const spriteOf: SpriteOf = (sheet, sprite) => props.sheetSprites(sheet)?.[sprite];
const name = computed(() => partName(props.part));

/** Every sprite of the part's sheets that is in the loaded files. */
const sprites = computed(() =>
  props.part.sheets.flatMap((sheet) =>
    (props.sheetSprites(sheet) ?? []).map((image, index) => ({ sheet, index, image })),
  ),
);
const missingSheets = computed(() => props.part.sheets.filter((s) => !props.sheetSprites(s)));
const count = computed(() => (strip.value === "frames" ? props.part.frames.length : sprites.value.length));
const player = usePlayer(count);
const { position, playing, move } = player;

watch(
  () => props.part,
  (part) => {
    strip.value = part.frames.length ? "frames" : "sprites";
    position.value = 0;
    playing.value = false;
    hidden.clear();
    spread.value = 0;
  },
  { immediate: true },
);
watch(strip, () => {
  position.value = 0;
  playing.value = false;
});

const frame = computed(() => (strip.value === "frames" ? props.part.frames[position.value] : undefined));
const shownSprite = computed(() => (strip.value === "sprites" ? sprites.value[position.value] : undefined));
const placements = computed<Placement[]>(() => {
  if (frame.value) return frame.value.sprites;
  const s = shownSprite.value;
  return s ? [{ sheet: s.sheet, sprite: s.index, x: 0, y: 0, layer: 0 }] : [];
});
const layers = computed(() => (frame.value ? drawOrder(placements.value) : []));
const composition = computed(() =>
  compose(placements.value, spriteOf, frame.value ? { hidden, spread: spread.value } : {}),
);
const label = computed(() =>
  frame.value
    ? `Frame ${frame.value.id}`
    : shownSprite.value
      ? `${shownSprite.value.sheet} · sprite ${shownSprite.value.index}`
      : "",
);

const imageName = computed(() => sheetFile(props.part.sheets[0] ?? ""));
const choice = computed(() =>
  detailPalette.value === AUTO
    ? choose(imageName.value, props.galleryPalette)
    : choose(imageName.value, detailPalette.value),
);
const colors = computed(() => colorsOf(choice.value?.name));

/** Where the part's origin is in the picture, in screen pixels. */
const originAt = computed(() => {
  const { x, y, width, height } = composition.value.bounds;
  return {
    left: `${(flipX.value ? width + x : -x) * zoom.value}px`,
    top: `${(flipY.value ? height + y : -y) * zoom.value}px`,
  };
});

const thumbnails = computed(() => props.part.frames.map((f) => compose(f.sprites, spriteOf)));

function save() {
  if (!composition.value.placed.length) return;
  const file = frame.value
    ? `${props.part.id}-frame${frame.value.id}.png`
    : `${shownSprite.value?.sheet}-sprite${shownSprite.value?.index}.png`;
  download(compositionCanvas(composition.value, colors.value), file);
}

function showLayer(layer: number, on: boolean) {
  if (on) hidden.delete(layer);
  else hidden.add(layer);
}

useSpriteKeys(player, count, zoom, (key) => {
  if (key === "h") flipX.value = !flipX.value;
  else if (key === "v") flipY.value = !flipY.value;
  else if (key === "f" && props.part.frames.length) strip.value = "frames";
  else if (key === "s" && sprites.value.length) strip.value = "sprites";
});

watchEffect(() => (crumb.value = ["Sprites", name.value.name, label.value].filter(Boolean)));

const zoomOptions = ZOOMS.map((z) => ({ value: z, label: `${z}×` }));
const backgrounds: { value: Background; label: string }[] = [
  { value: "checker", label: "Checks" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
];

const tabClass = (on: boolean) => (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink");
</script>

<template>
  <section :aria-label="`${name.name} detail`" class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3">
      <span class="text-title font-semibold">{{ name.name }}</span>
      <span class="font-mono text-muted">{{ part.id }}</span>
      <span class="font-mono text-muted">#{{ part.type }}</span>
      <div class="flex-1"></div>
      <LabBadge
        v-if="part.frames.length"
        status="decoded"
        :label="`${part.frames.length} ${part.frames.length === 1 ? 'frame' : 'frames'}`"
      />
      <LabBadge
        v-else
        status="unsupported"
        label="no frames yet"
        title="The program draws this part its own way, so the list has no frames for it yet. Its sprites are shown instead."
      />
    </div>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <SpriteStage :background="background">
          <div v-if="composition.placed.length" class="relative">
            <PartPicture
              :composition="composition"
              :palette="colors"
              :scale="zoom"
              :flip-x="flipX"
              :flip-y="flipY"
              class="outline-1 outline-accent/40 outline-dashed"
            />
            <div v-if="grid && zoom >= 3" class="pointer-events-none absolute inset-0" :style="gridStyle(zoom)"></div>
            <div v-if="origin && frame" class="pointer-events-none absolute size-0" :style="originAt">
              <span class="absolute -top-px -left-[7px] h-0.5 w-[15px] bg-accent"></span>
              <span class="absolute -top-[7px] -left-px h-[15px] w-0.5 bg-accent"></span>
            </div>
          </div>
          <p v-else-if="!part.sheets.length" class="max-w-[300px] text-center text-muted">
            The program draws this part with lines, so it has no sprites to show.
          </p>
          <p v-else-if="missingSheets.length" class="max-w-[300px] text-center text-muted">
            <span class="font-mono text-ink">{{ missingSheets.map(sheetFile).join(", ") }}</span> isn’t in the loaded
            files.
          </p>
          <p v-else class="text-muted">Nothing to show for this frame.</p>
          <template #topLeft>{{ label || "—" }} · {{ zoom }}×</template>
          <template #topRight
            >{{ composition.bounds.width }} × {{ composition.bounds.height }}
            <template v-if="frame"> at {{ composition.bounds.x }}, {{ composition.bounds.y }}</template></template
          >
          <template v-if="composition.missing.length" #bottomLeft>
            <LabIcon name="warning" :size="12" :stroke="2" class="text-error" />
            {{ composition.missing.length }} {{ composition.missing.length === 1 ? "sprite" : "sprites" }} not in the
            loaded files
          </template>
        </SpriteStage>

        <div class="flex shrink-0 flex-col gap-2 border-t border-line bg-sunken px-3 py-2.5">
          <div class="flex items-center gap-1.5">
            <LabButton
              icon
              :aria-label="`Previous ${strip === 'frames' ? 'frame' : 'sprite'}`"
              :disabled="count < 2"
              @click="move(-1)"
            >
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
            <LabButton
              icon
              :aria-label="`Next ${strip === 'frames' ? 'frame' : 'sprite'}`"
              :disabled="count < 2"
              @click="move(1)"
            >
              <LabIcon name="chevronRight" :size="13" :stroke="2.5" />
            </LabButton>
            <label class="flex min-w-0 flex-1 items-center">
              <span class="sr-only">{{ strip === "frames" ? "Frame" : "Sprite" }}</span>
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
            <span class="min-w-16 text-right font-mono whitespace-nowrap"
              >{{ count ? position + 1 : 0 }} / {{ count }}</span
            >
          </div>
          <p class="text-meta text-muted">
            <template v-if="strip === 'frames'"
              >Steps through the frames in order, {{ FPS }} a second. Which frame follows which in the game isn’t known
              yet.</template
            >
            <template v-else>Steps through the sprites in file order, which isn’t an animation by itself.</template>
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <LabSegmented v-model="zoom" label="Zoom" :options="zoomOptions" />
            <LabButton
              :aria-pressed="flipX"
              :class="toggle(flipX)"
              title="Mirror left to right (H)"
              @click="flipX = !flipX"
            >
              <LabIcon name="flip" :size="13" :stroke="2" />Flip H
            </LabButton>
            <LabButton
              :aria-pressed="flipY"
              :class="toggle(flipY)"
              title="Mirror top to bottom (V)"
              @click="flipY = !flipY"
            >
              <LabIcon name="flip" :size="13" :stroke="2" class="rotate-90" />Flip V
            </LabButton>
            <LabButton
              :aria-pressed="origin"
              :class="toggle(origin)"
              :disabled="!frame"
              title="Mark the part’s origin, where the positions in the list start"
              @click="origin = !origin"
              >Origin</LabButton
            >
            <LabButton
              :aria-pressed="grid"
              :class="toggle(grid)"
              :disabled="zoom < 3"
              title="Pixel grid, from 3×"
              @click="grid = !grid"
              >Grid</LabButton
            >
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <LabSegmented v-model="background" label="Background" :options="backgrounds" />
            <label
              class="flex items-center gap-2 pl-1 text-meta text-muted"
              :class="layers.length < 2 && 'opacity-40'"
              title="Moves each layer further down than the one drawn before it"
            >
              Pull layers apart
              <input
                v-model.number="spread"
                class="w-24 accent-accent"
                type="range"
                min="0"
                max="40"
                :disabled="layers.length < 2"
              />
            </label>
            <div class="flex-1"></div>
            <LabSelect
              v-model="detailPalette"
              label="Palette for this part"
              :options="options('Palette: as gallery')"
            />
            <LabButton :disabled="!composition.placed.length" @click="save">Save PNG</LabButton>
          </div>
        </div>

        <div class="flex h-[150px] shrink-0 flex-col border-t border-line bg-sunken">
          <div class="flex shrink-0 items-center gap-1 border-b border-line px-3" role="tablist">
            <button
              v-for="t in ['frames', 'sprites'] as const"
              :key="t"
              type="button"
              role="tab"
              :aria-selected="strip === t"
              :disabled="t === 'frames' ? !part.frames.length : !sprites.length"
              class="-mb-px h-8 cursor-pointer border-b-2 px-2 text-label font-semibold tracking-[.07em] uppercase disabled:cursor-default disabled:opacity-40"
              :class="tabClass(strip === t)"
              @click="strip = t"
            >
              {{ t === "frames" ? `Frames · ${part.frames.length}` : `Sprites · ${sprites.length}` }}
            </button>
            <div class="flex-1"></div>
            <span class="text-meta text-muted"
              ><LabKbd>F</LabKbd> frames <LabKbd>S</LabKbd> sprites <LabKbd>←</LabKbd> <LabKbd>→</LabKbd> step
              <LabKbd>Space</LabKbd> play</span
            >
          </div>
          <div class="flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 py-2">
            <template v-if="strip === 'frames'">
              <button
                v-for="(f, i) in part.frames"
                :key="f.id"
                type="button"
                class="flex w-[76px] shrink-0 cursor-pointer flex-col gap-1 rounded-md border bg-surface p-1"
                :class="
                  i === position
                    ? 'border-accent bg-accent/12 ring-1 ring-accent'
                    : 'border-line hover:border-line-strong'
                "
                :data-item="i === position ? 'selected' : ''"
                :aria-label="`Frame ${f.id}`"
                @click="position = i"
              >
                <span class="flex h-[60px] items-center justify-center overflow-hidden rounded-[3px] checker">
                  <PartPicture
                    :composition="thumbnails[i]!"
                    :palette="colors"
                    :scale="fitScale(thumbnails[i]!.bounds.width, thumbnails[i]!.bounds.height, 66, 56)"
                  />
                </span>
                <span class="text-center font-mono text-2xs text-muted">{{ f.id }}</span>
              </button>
            </template>
            <template v-else>
              <button
                v-for="(s, i) in sprites"
                :key="`${s.sheet}/${s.index}`"
                type="button"
                class="flex w-[76px] shrink-0 cursor-pointer flex-col gap-1 rounded-md border bg-surface p-1"
                :class="
                  i === position
                    ? 'border-accent bg-accent/12 ring-1 ring-accent'
                    : 'border-line hover:border-line-strong'
                "
                :data-item="i === position ? 'selected' : ''"
                :aria-label="`${s.sheet} sprite ${s.index}`"
                @click="position = i"
              >
                <span class="flex h-[60px] items-center justify-center overflow-hidden rounded-[3px] checker">
                  <PixelFrame
                    :frame="s.image"
                    :palette="colors"
                    :scale="fitScale(s.image.width, s.image.height, 66, 56)"
                  />
                </span>
                <span class="truncate text-center font-mono text-2xs text-muted"
                  >{{ part.sheets.length > 1 ? `${s.sheet} ` : "" }}{{ s.index }}</span
                >
              </button>
            </template>
          </div>
        </div>
      </div>

      <aside aria-label="Frame data" class="flex w-[300px] shrink-0 flex-col border-l border-line bg-sunken">
        <div class="flex h-8 shrink-0 items-center border-b border-line px-3">
          <PanelTitle>{{ strip === "frames" ? "Frame" : "Sprite" }}</PanelTitle>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-3 py-2.5">
          <div class="flex flex-col gap-3.5">
            <template v-if="frame">
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <PanelTitle>Layers</PanelTitle>
                  <div class="flex-1"></div>
                  <LabBadge
                    v-if="layers.length > 1"
                    status="hypothesis"
                    label="order guessed"
                    title="Which layer the game draws on top isn’t known. The Sprite Lab research suggests the highest layer first and layer 0 last, so it is drawn that way here."
                  />
                </div>
                <label
                  v-for="(layer, rank) in layers"
                  :key="layer"
                  class="flex h-[26px] cursor-pointer items-center gap-2 rounded px-1.5 hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    class="accent-accent"
                    :checked="!hidden.has(layer)"
                    @change="showLayer(layer, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="font-mono text-ink">Layer {{ layer }}</span>
                  <span class="text-muted">{{
                    layers.length > 1
                      ? rank === 0
                        ? "drawn first"
                        : rank === layers.length - 1
                          ? "drawn last"
                          : ""
                      : ""
                  }}</span>
                  <div class="flex-1"></div>
                  <span class="font-mono text-meta text-muted"
                    >{{ placements.filter((p) => p.layer === layer).length }} sprites</span
                  >
                </label>
              </div>
              <div class="flex flex-col gap-1.5">
                <PanelTitle>Sprites in this frame</PanelTitle>
                <table class="w-full font-mono text-meta">
                  <thead class="text-muted">
                    <tr>
                      <th class="py-1 text-left font-normal">sheet</th>
                      <th class="pl-2 text-right font-normal">sprite</th>
                      <th class="pl-2 text-right font-normal">x</th>
                      <th class="pl-2 text-right font-normal">y</th>
                      <th class="pl-2 text-right font-normal">layer</th>
                      <th class="pl-2 text-right font-normal">size</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(p, i) in placements"
                      :key="i"
                      class="border-t border-line-soft"
                      :class="hidden.has(p.layer) && 'text-faint'"
                    >
                      <td class="py-1">{{ p.sheet }}</td>
                      <td class="pl-2 text-right">{{ p.sprite }}</td>
                      <td class="pl-2 text-right">{{ p.x }}</td>
                      <td class="pl-2 text-right">{{ p.y }}</td>
                      <td class="pl-2 text-right">{{ p.layer }}</td>
                      <td class="pl-2 text-right whitespace-nowrap">
                        <template v-if="spriteOf(p.sheet, p.sprite)"
                          >{{ spriteOf(p.sheet, p.sprite)!.width }}×{{ spriteOf(p.sheet, p.sprite)!.height }}</template
                        ><span v-else class="text-error">missing</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p class="text-meta text-muted">
                  Positions are in pixels of the original game, from the part’s origin. In TIM 1 and Even More, the
                  game’s state {{ frame.id }} shows this frame.
                </p>
              </div>
            </template>
            <template v-else-if="shownSprite">
              <dl class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-[5px] font-mono text-ui">
                <dt class="text-muted">sheet</dt>
                <dd>{{ shownSprite.sheet }}</dd>
                <dt class="text-muted">sprite</dt>
                <dd>{{ shownSprite.index }}</dd>
                <dt class="text-muted">size</dt>
                <dd>{{ shownSprite.image.width }} × {{ shownSprite.image.height }}</dd>
              </dl>
              <div>
                <LabButton @click="emit('openSheet', sheetFile(shownSprite.sheet))"
                  >Open {{ sheetFile(shownSprite.sheet) }}</LabButton
                >
              </div>
            </template>
            <p v-else class="text-muted">Nothing selected.</p>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
