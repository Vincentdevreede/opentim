<script setup lang="ts">
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import LabCard from "../components/LabCard.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabIcon from "../components/LabIcon.vue";
import LabSearch from "../components/LabSearch.vue";
import LabSelect from "../components/LabSelect.vue";
import PageHeader from "../components/PageHeader.vue";
import PartPicture from "../components/PartPicture.vue";
import PixelFrame from "../components/PixelFrame.vue";
import ImageDetail from "../components/sprites/ImageDetail.vue";
import { AUTO, usePalettes } from "../components/sprites/palettes.ts";
import PartDetail from "../components/sprites/PartDetail.vue";
import { fitScale } from "../components/sprites/player.ts";
import { readBehaviourInBackground, type BehaviourResult } from "../behaviour.ts";
import type { Resource } from "../importer.ts";
import { edition, program, resources, selected } from "../library.ts";
import {
  compose,
  coverSprites,
  findParts,
  listIdOf,
  partName,
  readLoadedParts,
  sheetFile,
  type SpriteOf,
  type PartOrder,
} from "../parts.ts";
import { decode, isImage, type Decoded } from "../sprites.ts";
import { crumb, openAt, openSprite, selectedPart, spritesView } from "../ui.ts";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabPicture from "../components/LabPicture.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabTag from "../components/LabTag.vue";
import LabToolbar from "../components/LabToolbar.vue";
import LabCaption from "../components/LabCaption.vue";
import LabDot from "../components/LabDot.vue";

const ORDERS: { value: PartOrder; label: string }[] = [
  { value: "number", label: "By number" },
  { value: "name", label: "By name" },
];

const router = useRouter();
const query = ref("");
const order = ref<PartOrder>("number");
const startSprite = openSprite.value;
openSprite.value = undefined;

const { colorsOf, choose } = usePalettes();

const loaded = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value));
const list = computed(() => loaded.value?.list);
/** The names of the parts, by type. */
const partNames = computed(() => new Map(list.value?.parts.map((p) => [p.type, partName(p).name])));
/** What the program does with the parts, read in the background once the parts come from the program. */
const behaviour = shallowRef<BehaviourResult | { status: "reading" }>();
watch(
  () => [program.value?.data, loaded.value?.program] as const,
  ([data, parts]) => {
    behaviour.value = undefined;
    if (!data || !parts) return;
    behaviour.value = { status: "reading" };
    void readBehaviourInBackground(data, parts).then((result) => {
      if (program.value?.data === data) behaviour.value = result;
    });
  },
  { immediate: true },
);
/** Why there is no behaviour to show, when there can't be any. */
const noBehaviour = computed(() => {
  const l = loaded.value;
  if (!l || l.program) return undefined;
  if (l.list.id === "tim2") return "The lab reads behaviour from the programs of TIM 1 and Even More only, so far.";
  return l.problem ?? "The parts weren’t read from the program.";
});

// A link to a sprite of an image file opens that file.
if (startSprite !== undefined) spritesView.value = "images";
/** Which detail is shown: the selected part, or the selected image file. */
const view = computed(() => (list.value ? spritesView.value : "images"));

const entries = computed(() =>
  resources.value.filter(isImage).map((resource) => ({ resource, decoded: decode(resource) })),
);
/** The number of sprites in an image file, or of images in a screen. */
const imageCount = (d: Decoded) => (d.status === "decoded" ? d.image.frames.length : 0);
const totalSprites = computed(() => entries.value.reduce((sum, e) => sum + imageCount(e.decoded), 0));
const errors = computed(() => entries.value.filter((e) => e.decoded.status === "error").length);

/** The sprites of a sheet in the loaded files, or undefined when it isn't there. */
const sheetSprites = computed(() => {
  const byName = new Map(entries.value.map((e) => [e.resource.name, e.decoded]));
  return (sheet: string): Bitmap[] | undefined => {
    const d = byName.get(sheetFile(sheet));
    return d?.status === "decoded" ? d.image.frames : undefined;
  };
});
const spriteOf = computed<SpriteOf>(() => (sheet, sprite) => sheetSprites.value(sheet)?.[sprite]);

const parts = computed(() => (list.value ? findParts(list.value.parts, query.value, order.value) : []));
const withFrames = computed(() => list.value?.parts.filter((p) => p.frames.length).length ?? 0);
const currentPart = computed(
  () => list.value?.parts.find((p) => p.id === selectedPart.value) ?? parts.value[0] ?? list.value?.parts[0],
);
const covers = computed(() => new Map(parts.value.map((p) => [p.id, compose(coverSprites(p), spriteOf.value)])));

const images = computed(() => {
  const q = query.value.trim().toUpperCase();
  return entries.value.filter((e) => !q || e.resource.name.includes(q));
});
const currentImage = computed(
  () =>
    entries.value.find((e) => e.resource.name === selected.value) ??
    entries.value.find((e) => e.decoded.status === "decoded") ??
    entries.value[0],
);

/** The gallery's palette for an image. */
/** The cards use the palette with the image's name, or else the game's main palette. */
const galleryColors = (image: string) => colorsOf(choose(image, AUTO)?.name);

function pickPart(id: string) {
  selectedPart.value = id;
  spritesView.value = "parts";
}

function openSheet(file: string) {
  selected.value = file;
  spritesView.value = "images";
}

function viewBytes(r: Resource, offset?: number) {
  selected.value = r.name;
  openAt.value = offset;
  void router.push("/files");
}

const hasContent = computed(() => entries.value.length > 0);

watch(
  [view, () => currentPart.value?.id, () => currentImage.value?.resource.name],
  () => void nextTick(() => document.querySelector('[data-card="selected"]')?.scrollIntoView({ block: "nearest" })),
  { immediate: true },
);

onBeforeUnmount(() => (crumb.value = []));
</script>

<template>
  <PageHeader title="Sprites">
    <template #subtitle>
      <template v-if="list">
        <span class="font-mono text-ink">{{ list.parts.length }}</span> parts ·
        <span class="font-mono text-ink">{{ withFrames }}</span> with frames ·
      </template>
      <span class="font-mono text-ink">{{ entries.length }}</span> image files ·
      <span class="font-mono text-ink">{{ totalSprites }}</span> sprites
      <template v-if="errors">
        · <span class="text-error">{{ errors }} decode {{ errors === 1 ? "error" : "errors" }}</span></template
      >
    </template>
  </PageHeader>

  <div v-if="hasContent" class="flex min-h-0 flex-1">
    <LabSidePanel side="left" width="404px" aria-label="Parts and image files">
      <LabToolbar>
        <LabSearch
          v-model="query"
          label="Search parts by name, id or number, and image files by name"
          placeholder="Name, number or file…"
          class="min-w-0 flex-1"
        />
        <LabSelect v-if="list" v-model="order" label="Order of the parts" :options="ORDERS" />
      </LabToolbar>
      <div class="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        <div v-if="list" class="grid grid-cols-3 gap-2 pb-3">
          <LabListHeading title="Parts" :meta="`${parts.length} of ${list.parts.length}`" class="col-span-3 -mx-2.5" />
          <LabCard
            v-for="p in parts"
            :key="p.id"
            :selected="view === 'parts' && p.id === currentPart?.id"
            :data-card="view === 'parts' && p.id === currentPart?.id ? 'selected' : ''"
            :aria-label="`${partName(p).name}, number ${p.type}`"
            @click="pickPart(p.id)"
          >
            <LabPicture height="84px">
              <PartPicture
                v-if="covers.get(p.id)?.placed.length"
                :composition="covers.get(p.id)!"
                :palette="galleryColors(sheetFile(p.sheets[0] ?? ''))"
                :scale="fitScale(covers.get(p.id)!.bounds.width, covers.get(p.id)!.bounds.height, 104, 76)"
              />
              <span v-else class="px-2 text-center text-2xs text-muted">{{
                p.sheets.length ? "sheet not loaded" : "drawn with lines"
              }}</span>
              <LabTag class="absolute top-1 left-1">{{ p.type }}</LabTag>
              <LabDot
                v-if="!p.frames.length"
                status="unsupported"
                class="absolute top-1.5 right-1.5"
                title="No frames in the list yet"
              />
            </LabPicture>
            <span class="flex flex-col px-0.5 pb-px">
              <span class="truncate text-ui font-medium text-ink">{{ partName(p).name }}</span>
              <LabCaption class="px-0!">{{
                p.frames.length ? `${p.frames.length} ${p.frames.length === 1 ? "frame" : "frames"}` : "no frames"
              }}</LabCaption>
            </span>
          </LabCard>
          <LabNoMatch v-if="!parts.length" what="parts" :query="query" class="col-span-3" />
        </div>

        <div class="grid grid-cols-3 gap-2">
          <LabListHeading
            title="Image files"
            :meta="`${images.length} of ${entries.length}`"
            class="col-span-3 -mx-2.5"
          />
          <LabCard
            v-for="e in images"
            :key="e.resource.name"
            :selected="view === 'images' && e.resource.name === currentImage?.resource.name"
            :data-card="view === 'images' && e.resource.name === currentImage?.resource.name ? 'selected' : ''"
            :aria-label="e.resource.name"
            @click="openSheet(e.resource.name)"
          >
            <LabPicture height="84px">
              <PixelFrame
                v-if="e.decoded.status === 'decoded' && e.decoded.image.frames[0]"
                :frame="e.decoded.image.frames[0]"
                :palette="galleryColors(e.resource.name)"
                :scale="fitScale(e.decoded.image.frames[0].width, e.decoded.image.frames[0].height, 104, 76)"
              />
              <span
                v-else
                class="flex items-center gap-1 text-2xs"
                :class="e.decoded.status === 'error' ? 'text-error' : 'text-muted'"
              >
                <LabIcon name="warning" :size="12" />{{
                  e.decoded.status === "error" ? "decode error" : "not an image"
                }}</span
              >
            </LabPicture>
            <span class="flex flex-col px-0.5 pb-px">
              <span class="truncate font-mono text-ui text-ink">{{ e.resource.name }}</span>
              <span class="truncate text-2xs text-muted"
                ><template v-if="e.resource.group === 'screen'">screen</template
                ><template v-else
                  >sprite sheet · <span class="font-mono">{{ imageCount(e.decoded) }}</span>
                  {{ imageCount(e.decoded) === 1 ? "sprite" : "sprites" }}</template
                ></span
              >
            </span>
          </LabCard>
          <LabNoMatch v-if="!images.length" what="image files" :query="query" class="col-span-3" />
        </div>
      </div>
    </LabSidePanel>

    <PartDetail
      v-if="view === 'parts' && list && currentPart"
      :part="currentPart"
      :sheet-sprites="sheetSprites"
      :record="loaded?.records.get(currentPart.type)"
      :behaviour="behaviour"
      :no-behaviour="noBehaviour"
      :part-names="partNames"
      :gallery-palette="AUTO"
      @open-sheet="openSheet"
      @view-bytes="(file) => viewBytes(resources.find((r) => r.name === file)!)"
    />
    <ImageDetail
      v-else-if="view === 'images' && currentImage"
      :key="currentImage.resource.name"
      :resource="currentImage.resource"
      :decoded="currentImage.decoded"
      :gallery-palette="AUTO"
      :start-sprite="currentImage.resource.name === selected ? startSprite : undefined"
      @view-bytes="viewBytes"
    />
  </div>

  <LabEmpty
    v-else
    icon="sprites"
    title="No images in these files"
    text="The loaded files have no sprite sheets (.BMP) or screens (.SCR)."
  />
</template>
