<script setup lang="ts">
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, onBeforeUnmount, ref, useTemplateRef, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import LabBadge from "../components/LabBadge.vue";
import LabCheckbox from "../components/LabCheckbox.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabListRow from "../components/LabListRow.vue";
import LabFact from "../components/LabFact.vue";
import LabFacts from "../components/LabFacts.vue";
import LabIcon from "../components/LabIcon.vue";
import LabSearch from "../components/LabSearch.vue";
import LabSegmented from "../components/LabSegmented.vue";
import PageHeader from "../components/PageHeader.vue";
import { BACKGROUND_CLASSES, BACKGROUNDS, background } from "../components/backgrounds.ts";
import LevelCanvas from "../components/levels/LevelCanvas.vue";
import LevelStructure from "../components/levels/LevelStructure.vue";
import { AUTO, usePalettes } from "../components/sprites/palettes.ts";
import type { Confidence } from "../kinds.ts";
import { edition, program, resources, selected as selectedFile } from "../library.ts";
import { MARGIN, PLAY_AREA, layoutOf, layoutScene, readLevels, type LevelEntry } from "../levels.ts";
import { listIdOf, readLoadedParts, sheetFile, type SpriteOf } from "../parts.ts";
import { decode } from "../sprites.ts";
import { crumb, openAt, selectedLevel } from "../ui.ts";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabPanelHeader from "../components/LabPanelHeader.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabToolbar from "../components/LabToolbar.vue";

const ZOOMS = [
  { value: "fit", label: "Fit", title: "As large as the space allows" },
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
];
/** Room around the drawing inside its area, in screen pixels. */
const PADDING = 32;

const router = useRouter();
const query = ref("");
const zoomSetting = ref("fit");
const stage = useTemplateRef<HTMLDivElement>("stage");
const room = ref({ width: 0, height: 0 });
const observer = new ResizeObserver(([entry]) => {
  if (entry) room.value = { width: entry.contentRect.width, height: entry.contentRect.height };
});
/** The zoom: fitted to the space, but never below 1, or a fixed one. */
const zoom = computed(() => {
  if (zoomSetting.value !== "fit") return Number(zoomSetting.value);
  const fit = Math.min(
    (room.value.width - PADDING) / (PLAY_AREA.width + 2 * MARGIN),
    (room.value.height - PADDING) / (PLAY_AREA.height + 2 * MARGIN),
  );
  return Math.max(1, fit);
});
const showBounds = ref(true);
const selectedPart = ref<number>();

const entries = computed(() => readLevels(resources.value, layoutOf(edition.value)));
const levelCount = computed(() => entries.value.filter((e) => e.kind === "level").length);
const sceneCount = computed(() => entries.value.filter((e) => e.kind === "scene").length);
const unreadable = computed(() => entries.value.filter((e) => e.error).length);

const matches = (e: LevelEntry) => {
  const q = query.value.trim().toLowerCase();
  return !q || e.resource.name.toLowerCase().includes(q) || (e.level?.title ?? "").toLowerCase().includes(q);
};
const sections = computed(() => [
  { label: "Levels", ext: ".LEV", items: entries.value.filter((e) => e.kind === "level" && matches(e)) },
  { label: "Scenes", ext: ".GKC", items: entries.value.filter((e) => e.kind === "scene" && matches(e)) },
]);

const current = computed(
  () => entries.value.find((e) => e.resource.name === selectedLevel.value) ?? entries.value.find((e) => e.level),
);
const level = computed(() => current.value?.level);

const list = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value)?.list);

/** The decoded sprites of each sheet, as the Sprites page reads them. */
const sheets = computed(() => {
  const byName = new Map(resources.value.map((r) => [r.name, r]));
  const cache = new Map<string, Bitmap[] | undefined>();
  return (sheet: string) => {
    if (!cache.has(sheet)) {
      const r = byName.get(sheetFile(sheet));
      const d = r && decode(r);
      cache.set(sheet, d?.status === "decoded" ? d.image.frames : undefined);
    }
    return cache.get(sheet);
  };
});
const spriteOf = computed<SpriteOf>(() => (sheet, sprite) => sheets.value(sheet)?.[sprite]);

const { colorsOf, choose } = usePalettes();
const paletteOf = (sheet: string) => colorsOf(choose(sheetFile(sheet), AUTO)?.name);

const scene = computed(() => (level.value ? layoutScene(level.value, list.value, spriteOf.value) : undefined));

const stats = computed(() => {
  const s = scene.value;
  if (!s) return [];
  const count = (how: string[]) => s.parts.filter((p) => how.includes(p.how)).length;
  return [
    { label: "Layout", value: level.value!.layout === "toons" ? "Toons" : "TIM 1, Even More" },
    { label: "Version", value: `0x${level.value!.version.toString(16)}` },
    { label: "Play area", value: `${PLAY_AREA.width} × ${PLAY_AREA.height}` },
    { label: "Put together from frames", value: String(count(["frame"])) },
    { label: "One sprite by state", value: String(count(["sprite"])) },
    { label: "Tiled", value: String(count(["tiles"])) },
    { label: "Drawn as a box", value: String(count(["outline"])) },
    { label: "Ropes and belts", value: String(s.lines.length) },
    { label: "In the parts bin", value: `${s.bin.length}, not drawn` },
  ];
});

/** How well the level is drawn, for the badge next to its name. */
const status = computed<{ status: Confidence; label?: string }>(() => {
  if (current.value?.error) return { status: "error", label: "can’t read" };
  const s = scene.value;
  if (!s) return { status: "unsupported", label: "no level" };
  if (s.parts.some((p) => p.how === "outline") || s.lines.some((l) => l.broken)) return { status: "partial" };
  return { status: "decoded" };
});

watch(
  () => current.value?.resource.name,
  () => (selectedPart.value = undefined),
);
watchEffect(() => {
  const name = current.value?.resource.name;
  const part = selectedPart.value;
  crumb.value = ["Levels", name, part === undefined ? undefined : `#${part}`].filter((c): c is string => !!c);
});

function pick(name: string) {
  selectedLevel.value = name;
}

function viewBytes(offset = 0) {
  if (!current.value) return;
  selectedFile.value = current.value.resource.name;
  openAt.value = offset;
  void router.push("/files");
}

watch(stage, (el, old) => {
  if (old) observer.unobserve(old);
  if (el) observer.observe(el);
});
onBeforeUnmount(() => {
  observer.disconnect();
  crumb.value = [];
});
</script>

<template>
  <PageHeader title="Levels">
    <template #subtitle>
      <span class="font-mono text-ink">{{ levelCount }}</span> levels ·
      <span class="font-mono text-ink">{{ sceneCount }}</span> scenes
      <template v-if="unreadable">
        · <span class="text-error">{{ unreadable }} can’t be read</span></template
      >
    </template>
  </PageHeader>

  <div v-if="entries.length" class="flex min-h-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1">
      <LabSidePanel side="left" aria-label="Level files">
        <LabToolbar>
          <LabSearch
            v-model="query"
            label="Filter levels by file name or title"
            placeholder="L12, title…"
            class="flex-1"
          />
        </LabToolbar>
        <div class="min-h-0 flex-1 overflow-auto pb-2">
          <template v-for="section in sections" :key="section.label">
            <LabListHeading v-if="section.items.length" :title="section.label" :meta="section.ext" />
            <LabListRow
              v-for="e in section.items"
              :key="e.resource.name"
              :name="e.resource.name"
              name-width="76px"
              :text="e.error ? 'can’t be read' : e.level?.title || (e.kind === 'scene' ? 'scene' : 'untitled')"
              :status="e.error ? 'error' : 'decoded'"
              :selected="e.resource.name === current?.resource.name"
              :title="e.error ?? e.level?.goal"
              @click="pick(e.resource.name)"
            />
          </template>
          <LabNoMatch v-if="!sections.some((s) => s.items.length)" what="levels" :query="query" />
        </div>
      </LabSidePanel>

      <section v-if="current" class="flex min-w-0 flex-1 flex-col">
        <LabToolbar>
          <span class="font-mono font-semibold">{{ current.resource.name }}</span>
          <span v-if="level?.title" class="min-w-0 truncate text-soft">“{{ level.title }}”</span>
          <LabBadge v-bind="status" />
          <div class="flex-1"></div>
          <LabCheckbox v-model="showBounds">Part boxes</LabCheckbox>
          <LabSegmented v-model="background" label="Background" :options="BACKGROUNDS" />
          <LabSegmented v-model="zoomSetting" label="Zoom" :options="ZOOMS" />
        </LabToolbar>

        <div class="min-h-0 flex-1 overflow-auto">
          <div v-if="current.error" class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <LabIcon name="warning" :size="24" :stroke="1.75" class="text-error" />
            <p class="font-semibold">This file can’t be read</p>
            <p class="max-w-md text-soft">{{ current.error }}</p>
          </div>
          <div v-else-if="level && scene" class="flex h-full flex-col">
            <div ref="stage" class="flex min-h-0 flex-1 overflow-auto p-4" :class="BACKGROUND_CLASSES[background]">
              <LevelCanvas
                :scene="scene"
                :palette-of="paletteOf"
                :line-palette="paletteOf('PART0')"
                :zoom="zoom"
                :bounds="showBounds"
                :selected="selectedPart"
                @select="selectedPart = $event"
              />
            </div>
          </div>
        </div>

        <!-- The panel is as tall as the drawing facts, so they never scroll; long notes scroll inside it. -->
        <div v-if="scene" class="flex shrink-0 border-t border-line bg-sunken">
          <div class="flex w-[340px] shrink-0 flex-col border-r border-line">
            <LabPanelHeader title="Drawing" />
            <LabFacts label-width="auto" class="px-3 py-1.5">
              <LabFact v-for="s in stats" :key="s.label" :label="s.label" align="right">{{ s.value }}</LabFact>
            </LabFacts>
          </div>
          <div class="relative min-w-0 flex-1">
            <div class="absolute inset-0 flex flex-col">
              <LabPanelHeader title="Limits and guesses" :meta="scene.notes.length" />
              <div class="min-h-0 flex-1 overflow-auto">
                <LabListRow v-for="n in scene.notes" :key="n.title" inset>
                  <p class="min-w-0 flex-1 text-soft">
                    <span class="font-semibold text-ink">{{ n.title }}</span> {{ n.detail }}
                  </p>
                  <template #end>
                    <LabBadge :status="n.status" :label="n.status === 'unsupported' ? 'not done' : n.status" />
                  </template>
                </LabListRow>
                <p v-if="!scene.notes.length" class="px-3 py-[5px] text-muted">
                  Nothing left out: every part is drawn by the rules of the game’s program.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <LevelStructure
        v-if="level && current"
        :level="level"
        :name="current.resource.name"
        :list="list"
        :selected="selectedPart"
        @select="selectedPart = $event"
        @view-bytes="viewBytes"
      />
    </div>
  </div>

  <LabEmpty
    v-else
    icon="levels"
    :title="resources.length ? 'No levels in these files' : 'No files loaded'"
    :text="
      resources.length
        ? 'The loaded files have no levels (.LEV) or scenes (.GKC).'
        : 'Import the game’s RESOURCE files to see its levels.'
    "
    :import-link="!resources.length"
  />
</template>
