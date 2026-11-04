<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import LabCard from "../components/LabCard.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabIcon from "../components/LabIcon.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabSearch from "../components/LabSearch.vue";
import PageHeader from "../components/PageHeader.vue";
import PixelFrame from "../components/PixelFrame.vue";
import ImageDetail from "../components/sprites/ImageDetail.vue";
import { AUTO, usePalettes } from "../components/sprites/palettes.ts";
import { fitScale } from "../components/sprites/player.ts";
import type { Resource } from "../importer.ts";
import { resources, selected } from "../library.ts";
import { decode, isImage, type Decoded } from "../sprites.ts";
import { crumb, openAt, openSprite } from "../ui.ts";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabPicture from "../components/LabPicture.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabToolbar from "../components/LabToolbar.vue";

const router = useRouter();
const query = ref("");
const startSprite = openSprite.value;
openSprite.value = undefined;

const { colorsOf, choose } = usePalettes();

const entries = computed(() =>
  resources.value.filter(isImage).map((resource) => ({ resource, decoded: decode(resource) })),
);
/** The number of sprites in an image file, or of images in a screen. */
const imageCount = (d: Decoded) => (d.status === "decoded" ? d.image.frames.length : 0);
const totalSprites = computed(() => entries.value.reduce((sum, e) => sum + imageCount(e.decoded), 0));
const errors = computed(() => entries.value.filter((e) => e.decoded.status === "error").length);

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

/** The cards use the palette with the image's name, or else the game's main palette. */
const galleryColors = (image: string) => colorsOf(choose(image, AUTO)?.name);

function pick(file: string) {
  selected.value = file;
}

function viewBytes(r: Resource, offset?: number) {
  selected.value = r.name;
  openAt.value = offset;
  void router.push("/files");
}

const hasContent = computed(() => entries.value.length > 0);

watch(
  () => currentImage.value?.resource.name,
  () => void nextTick(() => document.querySelector('[data-card="selected"]')?.scrollIntoView({ block: "nearest" })),
  { immediate: true },
);

onBeforeUnmount(() => (crumb.value = []));
</script>

<template>
  <PageHeader title="Sprites">
    <template #subtitle>
      <span class="font-mono text-ink">{{ entries.length }}</span> images ·
      <span class="font-mono text-ink">{{ totalSprites }}</span> sprites
      <template v-if="errors">
        · <span class="text-error">{{ errors }} decode {{ errors === 1 ? "error" : "errors" }}</span></template
      >
    </template>
  </PageHeader>

  <div v-if="hasContent" class="flex min-h-0 flex-1">
    <LabSidePanel side="left" width="404px" aria-label="Images">
      <LabToolbar>
        <LabSearch v-model="query" label="Search images by name" placeholder="File name…" class="min-w-0 flex-1" />
      </LabToolbar>
      <div class="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        <div class="grid grid-cols-3 gap-2">
          <LabListHeading title="Images" :meta="`${images.length} of ${entries.length}`" class="col-span-3 -mx-2.5" />
          <LabCard
            v-for="e in images"
            :key="e.resource.name"
            :selected="e.resource.name === currentImage?.resource.name"
            :data-card="e.resource.name === currentImage?.resource.name ? 'selected' : ''"
            :aria-label="e.resource.name"
            @click="pick(e.resource.name)"
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
          <LabNoMatch v-if="!images.length" what="images" :query="query" class="col-span-3" />
        </div>
      </div>
    </LabSidePanel>

    <ImageDetail
      v-if="currentImage"
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
    :title="resources.length ? 'No images in these files' : 'No files loaded'"
    :text="
      resources.length
        ? 'The loaded files have no sprite sheets (.BMP) or screens (.SCR).'
        : 'Import the game’s RESOURCE files to see their sprites.'
    "
    :import-link="!resources.length"
  />
</template>
