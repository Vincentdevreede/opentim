<script setup lang="ts">
import { computed, ref, useId, watch, watchEffect } from "vue";
import { download, sheetCanvas } from "../../export.ts";
import type { Resource } from "../../importer.ts";
import { badgeOf, colorCounts, type Decoded } from "../../sprites.ts";
import { crumb, hex } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabCard from "../LabCard.vue";
import LabFact from "../LabFact.vue";
import LabFacts from "../LabFacts.vue";
import LabTabs from "../LabTabs.vue";
import { tabPanel } from "../tabs.ts";
import LabToggle from "../LabToggle.vue";
import LabIcon from "../LabIcon.vue";
import LabHints from "../LabHints.vue";
import LabStrip from "../LabStrip.vue";
import LabPanelBody from "../LabPanelBody.vue";
import LabAlert from "../LabAlert.vue";
import LabSegmented from "../LabSegmented.vue";
import LabSelect from "../LabSelect.vue";
import PaletteGrid from "../PaletteGrid.vue";
import PixelFrame from "../PixelFrame.vue";
import { frameCanvas } from "../pixels.ts";
import { AUTO, usePalettes } from "./palettes.ts";
import FrameStepper from "./FrameStepper.vue";
import { FPS, ZOOMS, fitScale, gridStyle, usePlayer, useSpriteKeys } from "./player.ts";
import { BACKGROUNDS, background } from "../backgrounds.ts";
import SpriteStage from "./SpriteStage.vue";
import LabPanelHeader from "../LabPanelHeader.vue";
import LabPicture from "../LabPicture.vue";
import LabSidePanel from "../LabSidePanel.vue";
import LabToolbar from "../LabToolbar.vue";
import LabSection from "../LabSection.vue";
import LabCaption from "../LabCaption.vue";
import LabSwatch from "../LabSwatch.vue";
import LabOpenIn from "../LabOpenIn.vue";

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
const grid = ref(false);
const onion = ref(false);
const tab = ref<"details" | "colours">("details");
const tabsId = useId();
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
// The colour grid only clears its highlight when the pointer leaves it, which doesn't happen when the tab is left.
watch(tab, () => (highlight.value = undefined));

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
const DATA_TABS = [
  { value: "details" as const, label: "Details" },
  { value: "colours" as const, label: "Colours" },
];
</script>

<template>
  <section :aria-label="`${resource.name} detail`" class="flex min-w-0 flex-1">
    <div class="flex min-w-0 flex-1 flex-col">
      <LabToolbar>
        <span class="font-mono text-title font-semibold">{{ resource.name }}</span>
        <span class="text-muted">{{ screen ? "screen" : "sprite sheet" }}</span>
        <span v-if="shownSprite && !screen" class="text-muted"
          >Sprite <span class="font-mono text-ink">{{ position }}</span></span
        >
        <div class="flex-1"></div>
        <LabBadge v-bind="badgeOf(decoded)" />
      </LabToolbar>

      <LabToolbar>
        <LabToggle v-model="flip" title="Flip horizontally (H)"> <LabIcon name="flip" />Flip </LabToggle>
        <LabToggle v-model="onion" title="Show the previous sprite faintly behind (O)">Onion</LabToggle>
        <LabToggle v-model="grid" :disabled="zoom < 3" title="Pixel grid, from 3×">Grid</LabToggle>
        <div class="flex-1"></div>
        <LabSegmented v-model="background" label="Background" :options="BACKGROUNDS" />
        <LabSegmented v-model="zoom" label="Zoom" :options="zoomOptions" />
      </LabToolbar>

      <div class="flex min-h-0 flex-1 flex-col">
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
          <LabAlert
            v-else-if="decoded.status !== 'decoded'"
            class="max-w-[420px]"
            :tone="decoded.status === 'error' ? 'error' : 'note'"
            :title="decoded.status === 'error' ? 'Couldn’t decode this file' : 'Not an image'"
          >
            <template v-if="decoded.status === 'error'">
              <span class="font-mono text-meta text-ink">{{ decoded.message }}</span>
              <span class="text-muted">Other files are unaffected.</span>
            </template>
            <span v-else class="text-muted"
              >This file is text, even though its name ends in .{{ resource.name.split(".").pop() }}.</span
            >
            <div class="mt-1.5">
              <LabButton @click="emit('viewBytes', resource, decoded.status === 'error' ? decoded.offset : undefined)"
                >View bytes{{
                  decoded.status === "error" && decoded.offset !== undefined ? ` at ${hex(decoded.offset, 4)}` : ""
                }}</LabButton
              >
            </div>
          </LabAlert>
          <p v-else class="text-muted">Nothing to show for this file.</p>
          <template #topLeft>{{ zoom }}× · nearest</template>
          <template #topRight>{{ shownSprite?.width ?? 0 }} × {{ shownSprite?.height ?? 0 }}</template>
          <template v-if="hover" #bottomLeft>
            x {{ hover.x }}, y {{ hover.y }} ·
            <template v-if="hover.index !== undefined">
              <LabSwatch small :color="css(hover.index)" />
              colour {{ hover.index }} · {{ rgb(hover.index).join(" ") }}
            </template>
            <template v-else>transparent</template>
          </template>
        </SpriteStage>

        <FrameStepper
          v-model:position="position"
          v-model:playing="playing"
          :count="count"
          :noun="noun"
          :counter="`${position} / ${Math.max(0, count - 1)}`"
          @move="move"
        >
          <p class="text-meta text-muted">
            Steps through the sprites in file order, {{ FPS }} a second, which isn’t an animation by itself.
          </p>
        </FrameStepper>

        <LabStrip>
          <template #header>
            <LabPanelHeader :title="screen ? 'Images' : 'Sprites'" :meta="count">
              <LabHints
                :hints="[
                  [['←', '→'], noun],
                  [['Space'], 'play'],
                  [['H'], 'flip'],
                  [['O'], 'onion'],
                ]"
              />
            </LabPanelHeader>
          </template>
          <LabCard
            v-for="(f, i) in sprites"
            :key="i"
            class="shrink-0"
            :class="screen ? 'w-[140px]' : 'w-[76px]'"
            :selected="i === position"
            :data-item="i === position ? 'selected' : ''"
            :aria-label="`${screen ? 'Image' : 'Sprite'} ${i}, ${f.width} × ${f.height}`"
            @click="position = i"
          >
            <LabPicture height="60px">
              <PixelFrame
                :frame="f"
                :palette="colors"
                :scale="screen ? fitScale(f.width, f.height, 130, 56) : fitScale(f.width, f.height, 66, 56)"
              />
            </LabPicture>
            <LabCaption class="flex justify-between gap-1">
              <span>{{ i }}</span>
              <span class="truncate">{{ f.width }}×{{ f.height }}</span>
            </LabCaption>
          </LabCard>
        </LabStrip>
      </div>
    </div>

    <LabSidePanel aria-label="Image file data">
      <LabPanelHeader title="Image file" :meta="resource.name" />
      <LabOpenIn :targets="['files']" @open="emit('viewBytes', resource)" />
      <LabTabs :id="tabsId" v-model="tab" label="Image file data" :options="DATA_TABS" />

      <LabPanelBody v-bind="tabPanel(tabsId, tab)">
        <template v-if="tab === 'details'">
          <LabFacts>
            <LabFact label="File">
              {{ resource.name }} <span class="text-muted">in {{ resource.archive }}</span>
            </LabFact>
            <template v-if="decoded.status === 'decoded' && shownSprite">
              <LabFact :label="noun.charAt(0).toUpperCase() + noun.slice(1)"
                >{{ position }} of {{ sprites.length }}</LabFact
              >
              <LabFact label="Size">{{ shownSprite.width }} × {{ shownSprite.height }}</LabFact>
              <LabFact label="Encoding">{{ decoded.image.encoding }}</LabFact>
            </template>
            <LabFact label="Palette">
              {{ choice?.name ?? "none, shown in grey" }}
              <span v-if="choice" class="text-muted">({{ choice.reason }})</span>
            </LabFact>
          </LabFacts>
          <LabSelect v-model="detailPalette" label="Palette for this image" :options="options('Palette: automatic')" />
          <div v-if="shownSprite" class="flex flex-wrap gap-2">
            <LabButton @click="exportSprite">Save {{ noun }} as PNG</LabButton>
            <LabButton @click="exportSheet">Save sheet as PNG</LabButton>
          </div>
        </template>

        <template v-else>
          <p class="text-meta text-muted">
            <span class="font-mono text-ink">{{ counts.size }}</span> colours used · indexes
            <span class="font-mono text-ink">{{ usedRange }}</span
            >. Hover a colour to find its pixels.
          </p>
          <PaletteGrid v-model:highlight="highlight" :palette="colors" :counts="counts" />
          <LabSection title="Try another palette">
            <div class="grid grid-cols-3 gap-1.5">
              <LabCard
                v-for="name in names"
                :key="name"
                class="items-center"
                :selected="choice?.name === name"
                :title="`Use ${name} for this image`"
                @click="detailPalette = name"
              >
                <LabPicture height="56px" class="w-full">
                  <PixelFrame
                    v-if="shownSprite"
                    :frame="shownSprite"
                    :palette="colorsOf(name)"
                    :scale="compareScale(shownSprite.width, shownSprite.height)"
                  />
                </LabPicture>
                <LabCaption center class="w-full">{{ name.replace(/\.PAL$/, "") }}</LabCaption>
              </LabCard>
            </div>
          </LabSection>
        </template>
      </LabPanelBody>
    </LabSidePanel>
  </section>
</template>
