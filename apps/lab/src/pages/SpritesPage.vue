<script setup lang="ts">
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import LabBadge from "../components/LabBadge.vue";
import LabField from "../components/LabField.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import LabSelect from "../components/LabSelect.vue";
import PageHeader from "../components/PageHeader.vue";
import PartPicture from "../components/PartPicture.vue";
import PixelFrame from "../components/PixelFrame.vue";
import ImageDetail from "../components/sprites/ImageDetail.vue";
import { AUTO, AUTO_HINT, usePalettes } from "../components/sprites/palettes.ts";
import PartDetail from "../components/sprites/PartDetail.vue";
import { fitScale } from "../components/sprites/player.ts";
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

const ORDERS: { value: PartOrder; label: string }[] = [
  { value: "number", label: "By number" },
  { value: "name", label: "By name" },
];

const router = useRouter();
const search = useTemplateRef<InstanceType<typeof LabField>>("search");
const query = ref("");
const order = ref<PartOrder>("number");
const galleryPalette = ref(AUTO);
const startSprite = openSprite.value;
openSprite.value = undefined;

const { colorsOf, choose, options } = usePalettes();

const loaded = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value));
const list = computed(() => loaded.value?.list);
/** Where the parts were read, for the header. */
const sourceBadge = computed(() => {
  const l = loaded.value;
  if (!l) return undefined;
  if (l.source === "committed")
    return {
      status: "unsupported" as const,
      label: "from the committed list",
      title: `Not read from the loaded files. ${l.problem}`,
    };
  const from = l.source === "program" ? (program.value?.name ?? "the program") : "INFO.RES";
  return l.differs.length
    ? {
        status: "partial" as const,
        label: `read from ${from} · ${l.differs.length} differ`,
        title: `Read from ${from}. Parts ${l.differs.join(", ")} differ from the list committed to OpenTIM.`,
      }
    : {
        status: "decoded" as const,
        label: `read from ${from}`,
        title: `Read from ${from}: the same as the committed list.`,
      };
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
const galleryColors = (image: string) => colorsOf(choose(image, galleryPalette.value)?.name);

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

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  search.value?.focus();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  crumb.value = [];
});

/** The heading of a section of the card list, which stays in view while it scrolls. */
const sectionClass =
  "sticky top-0 z-10 col-span-3 -mx-2.5 flex h-8 items-center gap-1.5 border-b border-line bg-surface/95 px-3 backdrop-blur";
const card = (on: boolean) =>
  on ? "border-accent bg-accent/12 ring-1 ring-accent" : "border-line bg-sunken hover:border-line-strong";
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
    <LabBadge v-if="sourceBadge" v-bind="sourceBadge" />
    <div class="h-5 w-px bg-line"></div>
    <LabSelect
      v-model="galleryPalette"
      label="Palette for the gallery"
      :options="options('Automatic (by file name)')"
    />
    <LabBadge v-if="galleryPalette === AUTO" status="hypothesis" label="name-based guess" :title="AUTO_HINT" />
  </PageHeader>

  <div v-if="hasContent" class="flex min-h-0 flex-1">
    <aside aria-label="Parts and image files" class="flex w-[404px] shrink-0 flex-col border-r border-line bg-surface">
      <div class="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
        <LabField
          ref="search"
          v-model="query"
          label="Search parts by name, id or number, and image files by name"
          type="search"
          placeholder="Name, number or file…"
          class="min-w-0 flex-1"
        >
          <template #prefix><LabIcon name="search" :size="14" :stroke="2" /></template>
          <template #suffix><LabKbd>/</LabKbd></template>
        </LabField>
        <LabSelect v-if="list" v-model="order" label="Order of the parts" :options="ORDERS" />
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        <div v-if="list" class="grid grid-cols-3 gap-2 pb-3">
          <div :class="sectionClass">
            <span class="text-label font-semibold tracking-[.07em] text-muted uppercase">Parts</span>
            <div class="flex-1"></div>
            <span class="font-mono text-meta text-muted">{{ parts.length }} of {{ list.parts.length }}</span>
          </div>
          <button
            v-for="p in parts"
            :key="p.id"
            type="button"
            class="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border p-1 text-left"
            :class="card(view === 'parts' && p.id === currentPart?.id)"
            :data-card="view === 'parts' && p.id === currentPart?.id ? 'selected' : ''"
            :aria-label="`${partName(p).name}, number ${p.type}`"
            @click="pickPart(p.id)"
          >
            <span class="relative flex h-[84px] items-center justify-center overflow-hidden rounded-[3px] checker">
              <PartPicture
                v-if="covers.get(p.id)?.placed.length"
                :composition="covers.get(p.id)!"
                :palette="galleryColors(sheetFile(p.sheets[0] ?? ''))"
                :scale="fitScale(covers.get(p.id)!.bounds.width, covers.get(p.id)!.bounds.height, 104, 76)"
              />
              <span v-else class="px-2 text-center text-2xs text-muted">{{
                p.sheets.length ? "sheet not loaded" : "drawn with lines"
              }}</span>
              <span class="absolute top-1 left-1 rounded-[3px] bg-sunken/85 px-1 font-mono text-2xs text-muted">{{
                p.type
              }}</span>
              <span
                v-if="!p.frames.length"
                class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-faint"
                title="No frames in the list yet"
              ></span>
            </span>
            <span class="flex flex-col px-0.5 pb-px">
              <span class="truncate text-ui font-medium text-ink">{{ partName(p).name }}</span>
              <span class="truncate font-mono text-2xs text-muted">{{
                p.frames.length ? `${p.frames.length} ${p.frames.length === 1 ? "frame" : "frames"}` : "no frames"
              }}</span>
            </span>
          </button>
          <p v-if="!parts.length" class="col-span-3 px-3 py-4 text-center text-muted">
            No parts match “<span class="font-mono text-ink">{{ query }}</span
            >”.
          </p>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div :class="sectionClass">
            <span class="text-label font-semibold tracking-[.07em] text-muted uppercase">Image files</span>
            <div class="flex-1"></div>
            <span class="font-mono text-meta text-muted">{{ images.length }} of {{ entries.length }}</span>
          </div>
          <button
            v-for="e in images"
            :key="e.resource.name"
            type="button"
            class="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border p-1 text-left"
            :class="card(view === 'images' && e.resource.name === currentImage?.resource.name)"
            :data-card="view === 'images' && e.resource.name === currentImage?.resource.name ? 'selected' : ''"
            :aria-label="e.resource.name"
            @click="openSheet(e.resource.name)"
          >
            <span class="relative flex h-[84px] items-center justify-center overflow-hidden rounded-[3px] checker">
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
                <LabIcon name="warning" :size="12" :stroke="2" />{{
                  e.decoded.status === "error" ? "decode error" : "not an image"
                }}</span
              >
            </span>
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
          </button>
          <p v-if="!images.length" class="col-span-3 px-3 py-4 text-center text-muted">
            No image files match “<span class="font-mono text-ink">{{ query }}</span
            >”.
          </p>
        </div>
      </div>
    </aside>

    <PartDetail
      v-if="view === 'parts' && list && currentPart"
      :part="currentPart"
      :sheet-sprites="sheetSprites"
      :gallery-palette="galleryPalette"
      @open-sheet="openSheet"
    />
    <ImageDetail
      v-else-if="view === 'images' && currentImage"
      :key="currentImage.resource.name"
      :resource="currentImage.resource"
      :decoded="currentImage.decoded"
      :gallery-palette="galleryPalette"
      :start-sprite="currentImage.resource.name === selected ? startSprite : undefined"
      @view-bytes="viewBytes"
    />
  </div>

  <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
    <LabIcon name="sprites" :size="28" class="text-faint" />
    <template v-if="resources.length">
      <p class="text-title font-semibold">No images in these files</p>
      <p class="text-muted">The loaded files have no sprite sheets (.BMP) or screens (.SCR).</p>
    </template>
    <template v-else>
      <p class="text-title font-semibold">No files loaded</p>
      <p class="text-muted">Import the game’s RESOURCE files to see their sprites.</p>
      <RouterLink
        to="/"
        class="mt-1 inline-flex h-[26px] items-center rounded-[5px] border border-accent bg-accent px-[9px] font-semibold text-accent-ink hover:bg-accent-hover"
      >
        Go to Import
      </RouterLink>
    </template>
  </div>
</template>
