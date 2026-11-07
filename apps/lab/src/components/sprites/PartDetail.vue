<script setup lang="ts">
import type { Part, Placement, TypeRecord } from "@opentim/content";
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, nextTick, reactive, ref, watch, watchEffect } from "vue";
import type { BehaviourResult, WalksResult } from "../../behaviour.ts";
import { outlineShape } from "../../behaviour-view.ts";
import { download } from "../../export.ts";
import { compose, drawOrder, partName, sheetFile, type SpriteOf } from "../../parts.ts";
import { crumb } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabCard from "../LabCard.vue";
import LabFact from "../LabFact.vue";
import LabFacts from "../LabFacts.vue";
import LabSlider from "../LabSlider.vue";
import LabTable, { type Column } from "../LabTable.vue";
import LabTabs from "../LabTabs.vue";
import LabToggle from "../LabToggle.vue";
import LabIcon from "../LabIcon.vue";
import LabHints from "../LabHints.vue";
import LabStrip from "../LabStrip.vue";
import LabPanelBody from "../LabPanelBody.vue";
import LabSegmented from "../LabSegmented.vue";
import LabSelect from "../LabSelect.vue";
import PartPicture from "../PartPicture.vue";
import PixelFrame from "../PixelFrame.vue";
import { compositionCanvas } from "../pixels.ts";
import { AUTO, usePalettes } from "./palettes.ts";
import BehaviourPanel from "./BehaviourPanel.vue";
import FrameStepper from "./FrameStepper.vue";
import RecordPanel from "./RecordPanel.vue";
import { FPS, ZOOMS, fitScale, gridStyle, usePlayer, useSpriteKeys } from "./player.ts";
import { BACKGROUNDS, background } from "../backgrounds.ts";
import SpriteStage from "./SpriteStage.vue";
import LabPanelHeader from "../LabPanelHeader.vue";
import LabPicture from "../LabPicture.vue";
import LabSidePanel from "../LabSidePanel.vue";
import LabToolbar from "../LabToolbar.vue";
import LabSection from "../LabSection.vue";
import LabCaption from "../LabCaption.vue";
import LabOpenIn from "../LabOpenIn.vue";
import LabListRow from "../LabListRow.vue";

const props = defineProps<{
  part: Part;
  /** The sprites of a sheet in the loaded files, or undefined when it isn't there. */
  sheetSprites: (sheet: string) => Bitmap[] | undefined;
  /** The palette setting of the gallery. */
  galleryPalette: string;
  /** The part's record in the program's type table, when the parts were read from the program. */
  record?: TypeRecord;
  /** The analysis of what the program does with the parts. */
  behaviour?: BehaviourResult | { status: "reading" };
  /** The walks from the parts' triggers, read after the rest. */
  walks?: WalksResult | { status: "reading" };
  /** Why there is no analysis, when there can't be one. */
  noBehaviour?: string;
  /** The names of the parts, by type. */
  partNames?: ReadonlyMap<number, string>;
}>();
const emit = defineEmits<{ openSheet: [file: string, sprite: number]; viewBytes: [file: string] }>();

type Strip = "frames" | "sprites";

const strip = ref<Strip>("frames");
const zoom = ref(3);
const flipX = ref(false);
const flipY = ref(false);
const grid = ref(false);
const origin = ref(true);
const outline = ref(false);
const spread = ref(0);
const hidden = reactive(new Set<number>());
const detailPalette = ref(AUTO);
const side = ref<"frame" | "behaviour" | "record">("frame");

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
/**
 * The sprite the panel's buttons open, with its sheet: the shown sprite, or the first loaded sprite of the shown frame,
 * or else the first sprite of the part's first loaded sheet.
 */
const opened = computed(() => {
  const shown = shownSprite.value;
  if (shown) return { sheet: shown.sheet, sprite: shown.index };
  const placed = placements.value.find((p) => spriteOf(p.sheet, p.sprite));
  if (placed) return { sheet: placed.sheet, sprite: placed.sprite };
  const first = props.part.sheets.find((s) => props.sheetSprites(s)?.length);
  return first === undefined ? undefined : { sheet: first, sprite: 0 };
});
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

/** The outline the part's reset routine sets, on the stage: its points, and each edge's number outside it. */
const shape = computed(() => {
  // The points start at the part's position, which only a frame places.
  if (props.behaviour?.status !== "done" || !frame.value) return undefined;
  const summary = props.behaviour.summary.parts[props.part.type];
  const { x, y, width, height } = composition.value.bounds;
  const points = summary && outlineShape(summary, { width, height });
  if (!points) return undefined;
  const z = zoom.value;
  const at = points.map((p) => ({ x: (p.x - x + 0.5) * z, y: (p.y - y + 0.5) * z }));
  const edges = at.map((p, k) => {
    const next = at[(k + 1) % at.length]!;
    const length = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    // Outlines run clockwise on screen, so the outside of an edge is to its left.
    const out = { x: (next.y - p.y) / length, y: -(next.x - p.x) / length };
    return { k, x: (p.x + next.x) / 2 + out.x * 9, y: (p.y + next.y) / 2 + out.y * 9 };
  });
  return { points: at, edges, line: at.map((p) => `${p.x},${p.y}`).join(" "), source: points };
});

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

/** Shows the frame with this id, like the target of a state change. */
function showFrame(id: number) {
  const index = props.part.frames.findIndex((f) => f.id === id);
  if (index < 0) return;
  if (strip.value === "frames") position.value = index;
  else {
    strip.value = "frames";
    // Changing the strip starts it at its first item; go to the frame after that.
    void nextTick(() => (position.value = index));
  }
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
  else if (key === "o" && shape.value) outline.value = !outline.value;
});

watchEffect(() => (crumb.value = ["Parts", name.value.name, label.value].filter(Boolean)));

const zoomOptions = ZOOMS.map((z) => ({ value: z, label: `${z}×` }));
const SPRITE_COLUMNS: Column[] = [
  { key: "sheet", label: "Sheet" },
  { key: "sprite", label: "Sprite", align: "right" },
  { key: "x", label: "X", align: "right" },
  { key: "y", label: "Y", align: "right" },
  { key: "layer", label: "Layer", align: "right" },
  { key: "size", label: "Size", align: "right" },
];

const stripTabs = computed(() => [
  { value: "frames" as const, label: `Frames · ${props.part.frames.length}`, disabled: !props.part.frames.length },
  { value: "sprites" as const, label: `Sprites · ${sprites.value.length}`, disabled: !sprites.value.length },
]);
const sideTabs = computed(() => [
  { value: "frame" as const, label: strip.value === "frames" ? "Frame" : "Sprite" },
  { value: "behaviour" as const, label: "Behaviour" },
  { value: "record" as const, label: "Record" },
]);
</script>

<template>
  <section :aria-label="`${name.name} detail`" class="flex min-w-0 flex-1">
    <div class="flex min-w-0 flex-1 flex-col">
      <LabToolbar>
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
      </LabToolbar>

      <LabToolbar>
        <LabToggle v-model="flipX" title="Mirror left to right (H)"> <LabIcon name="flip" />Flip H </LabToggle>
        <LabToggle v-model="flipY" title="Mirror top to bottom (V)">
          <LabIcon name="flip" class="rotate-90" />Flip V
        </LabToggle>
        <LabToggle
          v-model="origin"
          :disabled="!frame"
          title="Mark the part’s origin, where the positions in the list start"
          >Origin</LabToggle
        >
        <LabToggle
          v-model="outline"
          :disabled="!shape || flipX || flipY"
          :title="
            !shape
              ? frame
                ? 'The analysis has no outline points for this part: its reset doesn’t write each one as a number'
                : 'Only a frame places the outline, and this part has no frames'
              : flipX || flipY
                ? 'The outline is the one reset sets for the part as placed, not mirrored'
                : `The outline reset sets, ${shape.source.length} points, with each edge’s number (O)`
          "
          >Outline</LabToggle
        >
        <LabToggle v-model="grid" :disabled="zoom < 3" title="Pixel grid, from 3×">Grid</LabToggle>
        <div class="flex-1"></div>
        <LabSegmented v-model="background" label="Background" :options="BACKGROUNDS" />
        <LabSegmented v-model="zoom" label="Zoom" :options="zoomOptions" />
      </LabToolbar>

      <div class="flex min-h-0 flex-1 flex-col">
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
            <svg
              v-if="outline && shape && !flipX && !flipY"
              class="pointer-events-none absolute top-0 left-0 overflow-visible"
              :width="composition.bounds.width * zoom"
              :height="composition.bounds.height * zoom"
              aria-hidden="true"
            >
              <polygon :points="shape.line" fill="none" class="stroke-decoded" stroke-width="1.5" />
              <circle v-for="(p, i) in shape.points" :key="i" :cx="p.x" :cy="p.y" r="2.5" class="fill-decoded" />
              <text
                v-for="e in shape.edges"
                :key="e.k"
                :x="e.x"
                :y="e.y"
                text-anchor="middle"
                dominant-baseline="central"
                class="fill-decoded stroke-sunken font-mono text-[11px] font-semibold"
                stroke-width="3"
                paint-order="stroke"
              >
                {{ e.k }}
              </text>
            </svg>
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
            <LabIcon name="warning" :size="12" class="text-error" />
            {{ composition.missing.length }} {{ composition.missing.length === 1 ? "sprite" : "sprites" }} not in the
            loaded files
          </template>
        </SpriteStage>

        <FrameStepper
          v-model:position="position"
          v-model:playing="playing"
          :count="count"
          :noun="strip === 'frames' ? 'frame' : 'sprite'"
          :counter="`${count ? position + 1 : 0} / ${count}`"
          @move="move"
        >
          <p class="text-meta text-muted">
            <template v-if="strip === 'frames'"
              >Steps through the frames in order, {{ FPS }} a second. Which frame follows which in the game isn’t known
              yet.</template
            >
            <template v-else>Steps through the sprites in file order, which isn’t an animation by itself.</template>
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <LabSlider
              v-model="spread"
              label="Pull layers apart"
              :max="40"
              :disabled="layers.length < 2"
              title="Moves each layer further down than the one drawn before it"
              class="w-52 pl-1"
            />
            <div class="flex-1"></div>
            <LabSelect v-model="detailPalette" label="Palette for this part" :options="options('Palette: automatic')" />
            <LabButton :disabled="!composition.placed.length" @click="save">Save PNG</LabButton>
          </div>
        </FrameStepper>

        <LabStrip>
          <template #header>
            <LabTabs v-model="strip" label="Frames or sprites" :options="stripTabs">
              <LabHints
                :hints="[
                  [['F'], 'frames'],
                  [['S'], 'sprites'],
                  [['←', '→'], 'step'],
                  [['Space'], 'play'],
                ]"
              />
            </LabTabs>
          </template>
          <template v-if="strip === 'frames'">
            <LabCard
              v-for="(f, i) in part.frames"
              :key="f.id"
              class="w-[76px] shrink-0"
              :selected="i === position"
              :data-item="i === position ? 'selected' : ''"
              :aria-label="`Frame ${f.id}`"
              @click="position = i"
            >
              <LabPicture height="60px">
                <PartPicture
                  :composition="thumbnails[i]!"
                  :palette="colors"
                  :scale="fitScale(thumbnails[i]!.bounds.width, thumbnails[i]!.bounds.height, 66, 56)"
                />
              </LabPicture>
              <LabCaption center>{{ f.id }}</LabCaption>
            </LabCard>
          </template>
          <template v-else>
            <LabCard
              v-for="(s, i) in sprites"
              :key="i"
              class="w-[76px] shrink-0"
              :selected="i === position"
              :data-item="i === position ? 'selected' : ''"
              :aria-label="`${s.sheet} sprite ${s.index}`"
              @click="position = i"
            >
              <LabPicture height="60px">
                <PixelFrame
                  :frame="s.image"
                  :palette="colors"
                  :scale="fitScale(s.image.width, s.image.height, 66, 56)"
                />
              </LabPicture>
              <LabCaption center>{{ part.sheets.length > 1 ? `${s.sheet} ` : "" }}{{ s.index }}</LabCaption>
            </LabCard>
          </template>
        </LabStrip>
      </div>
    </div>

    <LabSidePanel aria-label="Part data">
      <LabPanelHeader title="Part" :meta="part.id" />
      <LabOpenIn
        v-if="opened"
        :targets="['sprites', 'files']"
        @open="
          $event === 'sprites'
            ? emit('openSheet', sheetFile(opened.sheet), opened.sprite)
            : emit('viewBytes', sheetFile(opened.sheet))
        "
      />
      <LabTabs v-model="side" label="Part data" :options="sideTabs" />

      <LabPanelBody :key="side">
        <BehaviourPanel
          v-if="side === 'behaviour'"
          :result="behaviour"
          :walks="walks"
          :unavailable="noBehaviour"
          :type="part.type"
          :frames="part.frames.map((f) => f.id)"
          :current="frame?.id"
          :names="partNames"
          @show-frame="showFrame"
        />
        <RecordPanel v-else-if="side === 'record'" :record="record" />
        <template v-else-if="frame">
          <LabSection title="Layers">
            <template v-if="layers.length > 1" #action>
              <LabBadge
                status="hypothesis"
                label="order guessed"
                title="Which layer the game draws on top isn’t known. The Sprite Lab research suggests the highest layer first and layer 0 last, so it is drawn that way here."
              />
            </template>
            <div class="-mx-3">
              <LabListRow
                v-for="(layer, rank) in layers"
                :key="layer"
                :name="`Layer ${layer}`"
                name-width="4.5rem"
                :text="
                  layers.length > 1 ? (rank === 0 ? 'drawn first' : rank === layers.length - 1 ? 'drawn last' : '') : ''
                "
                :aria-pressed="!hidden.has(layer)"
                inset
                @click="showLayer(layer, hidden.has(layer))"
              >
                <template #lead>
                  <input
                    type="checkbox"
                    :checked="!hidden.has(layer)"
                    tabindex="-1"
                    aria-hidden="true"
                    class="pointer-events-none accent-accent"
                  />
                </template>
                <template #end>
                  <span class="font-mono text-meta text-muted"
                    >{{ placements.filter((p) => p.layer === layer).length }} sprites</span
                  >
                </template>
              </LabListRow>
            </div>
          </LabSection>
          <LabSection title="Sprites in this frame">
            <LabTable
              compact
              class="-mx-3 w-[calc(100%+1.5rem)]! font-mono text-meta"
              :columns="SPRITE_COLUMNS"
              :rows="placements"
              :row-key="(_, i) => String(i)"
              :row-class="(p) => (hidden.has(p.layer) ? 'text-faint' : undefined)"
            >
              <template #cell-size="{ row }">
                <template v-if="spriteOf(row.sheet, row.sprite)"
                  >{{ spriteOf(row.sheet, row.sprite)!.width }}×{{ spriteOf(row.sheet, row.sprite)!.height }}</template
                ><span v-else class="text-error">missing</span>
              </template>
            </LabTable>
            <p class="text-meta text-muted">
              Positions are in pixels of the original game, from the part’s origin. In TIM 1 and Even More, the game’s
              state {{ frame.id }} shows this frame.
            </p>
          </LabSection>
        </template>
        <template v-else-if="shownSprite">
          <LabFacts>
            <LabFact label="Sheet">{{ shownSprite.sheet }}</LabFact>
            <LabFact label="Sprite">{{ shownSprite.index }}</LabFact>
            <LabFact label="Size">{{ shownSprite.image.width }} × {{ shownSprite.image.height }}</LabFact>
          </LabFacts>
        </template>
        <p v-else class="text-muted">Nothing selected.</p>
      </LabPanelBody>
    </LabSidePanel>
  </section>
</template>
