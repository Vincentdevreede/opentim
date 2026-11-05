<script setup lang="ts">
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import LabCaption from "../components/LabCaption.vue";
import LabCard from "../components/LabCard.vue";
import LabDot from "../components/LabDot.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabPicture from "../components/LabPicture.vue";
import LabSearch from "../components/LabSearch.vue";
import LabSelect from "../components/LabSelect.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabTag from "../components/LabTag.vue";
import LabToolbar from "../components/LabToolbar.vue";
import PageHeader from "../components/PageHeader.vue";
import PartPicture from "../components/PartPicture.vue";
import { AUTO, usePalettes } from "../components/sprites/palettes.ts";
import PartDetail from "../components/sprites/PartDetail.vue";
import { fitScale } from "../components/sprites/player.ts";
import { readBehaviourInBackground, type BehaviourResult, type WalksResult } from "../behaviour.ts";
import { edition, program, resources, selected } from "../library.ts";
import {
  compose,
  coverSprites,
  findParts,
  listIdOf,
  partName,
  readLoadedParts,
  sheetFile,
  type PartOrder,
  type SpriteOf,
} from "../parts.ts";
import { decode, isImage } from "../sprites.ts";
import { crumb, openAt, openSprite, selectedPart } from "../ui.ts";

/** The parts of the game: what each looks like, how the program treats it, and its record in the program. */

const ORDERS: { value: PartOrder; label: string }[] = [
  { value: "number", label: "By number" },
  { value: "name", label: "By name" },
];

const router = useRouter();
const query = ref("");
const order = ref<PartOrder>("number");

const { colorsOf, choose } = usePalettes();

const loaded = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value));
const list = computed(() => loaded.value?.list);
/** The names of the parts, by type. */
const partNames = computed(() => new Map(list.value?.parts.map((p) => [p.type, partName(p).name])));
/** What the program does with the parts, read in the background once the parts come from the program. */
const behaviour = shallowRef<BehaviourResult | { status: "reading" }>();
/** The walks from the parts' triggers, which come a few seconds after the rest. */
const walks = shallowRef<WalksResult | { status: "reading" }>();
watch(
  () => [program.value?.data, loaded.value?.program] as const,
  ([data, parts]) => {
    behaviour.value = undefined;
    walks.value = undefined;
    if (!data || !parts) return;
    behaviour.value = { status: "reading" };
    walks.value = { status: "reading" };
    const reading = readBehaviourInBackground(data, parts);
    void reading.result.then((result) => {
      if (program.value?.data === data) behaviour.value = result;
    });
    void reading.walks.then((result) => {
      if (program.value?.data === data) walks.value = result;
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

/** The decoded image files, which the parts draw their frames from. */
const sheets = computed(() => {
  const byName = new Map(resources.value.filter(isImage).map((r) => [r.name, decode(r)]));
  return (sheet: string): Bitmap[] | undefined => {
    const d = byName.get(sheetFile(sheet));
    return d?.status === "decoded" ? d.image.frames : undefined;
  };
});
const spriteOf = computed<SpriteOf>(() => (sheet, sprite) => sheets.value(sheet)?.[sprite]);

const parts = computed(() => (list.value ? findParts(list.value.parts, query.value, order.value) : []));
const withFrames = computed(() => list.value?.parts.filter((p) => p.frames.length).length ?? 0);
/** The file the parts were read from, when they were read from the loaded files and compared with our list. */
const readFrom = computed(() => {
  const l = loaded.value;
  if (!l || l.source === "committed") return undefined;
  return l.source === "program" ? (program.value?.name ?? "the program") : "INFO.RES";
});
/** The numbers of the parts that aren't the same as in our list. */
const differs = computed(() => new Set(loaded.value?.differs ?? []));
const currentPart = computed(
  () => list.value?.parts.find((p) => p.id === selectedPart.value) ?? parts.value[0] ?? list.value?.parts[0],
);
const covers = computed(() => new Map(parts.value.map((p) => [p.id, compose(coverSprites(p), spriteOf.value)])));

/** The cards use the palette with the image's name, or else the game's main palette. */
const galleryColors = (image: string) => colorsOf(choose(image, AUTO)?.name);

function pick(id: string) {
  selectedPart.value = id;
}

/** Opens an image file of the part on the Sprites page, at one of its sprites. */
function openSheet(file: string, sprite: number) {
  selected.value = file;
  openSprite.value = sprite;
  void router.push("/sprites");
}

function viewBytes(file: string) {
  selected.value = file;
  openAt.value = undefined;
  void router.push("/files");
}

watch(
  () => currentPart.value?.id,
  () => void nextTick(() => document.querySelector('[data-card="selected"]')?.scrollIntoView({ block: "nearest" })),
  { immediate: true },
);

onBeforeUnmount(() => (crumb.value = []));
</script>

<template>
  <PageHeader title="Parts">
    <template v-if="list" #subtitle>
      <span class="font-mono text-ink">{{ list.parts.length }}</span> parts ·
      <span class="font-mono text-ink">{{ withFrames }}</span> with frames
      <template v-if="readFrom">
        · read from <span class="font-mono text-ink">{{ readFrom }}</span> ·
        <template v-if="differs.size">
          <span class="font-mono text-ink">{{ differs.size }}</span> differ from our list</template
        >
        <template v-else>the same as our list</template>
      </template>
      <template v-else-if="loaded?.problem"> · from our list: {{ loaded.problem }}</template>
    </template>
  </PageHeader>

  <div v-if="list && currentPart" class="flex min-h-0 flex-1">
    <LabSidePanel side="left" width="404px" aria-label="Parts">
      <LabToolbar>
        <LabSearch
          v-model="query"
          label="Search parts by name, id or number"
          placeholder="Name, id or number…"
          class="min-w-0 flex-1"
        />
        <LabSelect v-model="order" label="Order of the parts" :options="ORDERS" />
      </LabToolbar>
      <div class="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        <div class="grid grid-cols-3 gap-2">
          <LabListHeading title="Parts" :meta="`${parts.length} of ${list.parts.length}`" class="col-span-3 -mx-2.5" />
          <LabCard
            v-for="p in parts"
            :key="p.id"
            :selected="p.id === currentPart.id"
            :data-card="p.id === currentPart.id ? 'selected' : ''"
            :aria-label="`${partName(p).name}, number ${p.type}`"
            @click="pick(p.id)"
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
                v-if="differs.has(p.type)"
                status="partial"
                class="absolute top-1.5 right-1.5"
                :title="`Not the same as in our list${p.frames.length ? '' : '. No frames in the list yet'}`"
              />
              <LabDot
                v-else-if="!p.frames.length"
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
      </div>
    </LabSidePanel>

    <PartDetail
      :part="currentPart"
      :sheet-sprites="sheets"
      :record="loaded?.records.get(currentPart.type)"
      :behaviour="behaviour"
      :walks="walks"
      :no-behaviour="noBehaviour"
      :part-names="partNames"
      :gallery-palette="AUTO"
      @open-sheet="openSheet"
      @view-bytes="viewBytes"
    />
  </div>

  <LabEmpty
    v-else
    icon="parts"
    title="No parts list for these files"
    text="The lab has parts lists for TIM 1, Even More and TIM 2, and these files aren’t from one of them."
  />
</template>
