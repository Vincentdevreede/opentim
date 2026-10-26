<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabField from "../components/LabField.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import LabSelect from "../components/LabSelect.vue";
import PageHeader from "../components/PageHeader.vue";
import PanelTitle from "../components/PanelTitle.vue";
import PixelFrame from "../components/PixelFrame.vue";
import type { Resource } from "../importer.ts";
import { resources, selected } from "../library.ts";
import { autoPalette, badgeOf, decode, isImage, paletteColors, type Decoded, type PaletteChoice } from "../sprites.ts";
import { crumb, formatBytes, hex, openAt, openFrame } from "../ui.ts";

type Kind = "all" | "sprites" | "screen";

const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sprites", label: "Sprite sheets" },
  { id: "screen", label: "Screens" },
];
const ZOOMS = [1, 2, 3, 4];
/** Speed of the preview. The game's own animation timing isn't known yet. */
const FPS = 8;
const AUTO = "auto";
const AUTO_HINT =
  "Automatic: the palette with the image’s name, like TITLE.PAL for TITLE.SCR, or else the game’s main palette. Guessed from the names, not read from the file.";

const router = useRouter();
const search = useTemplateRef<InstanceType<typeof LabField>>("search");
const query = ref("");
const kind = ref<Kind>("all");
const galleryPalette = ref(AUTO);
const detailPalette = ref(AUTO);
const collapsed = reactive(new Set<string>());
const frameIndex = ref(openFrame.value ?? 0);
openFrame.value = undefined;
const zoom = ref(2);
const flip = ref(false);
const playing = ref(false);

const entries = computed(() =>
  resources.value.filter(isImage).map((resource) => ({ resource, decoded: decode(resource) })),
);
const frameCount = (d: Decoded) => (d.status === "decoded" ? d.image.frames.length : 0);
const totalFrames = computed(() => entries.value.reduce((sum, e) => sum + frameCount(e.decoded), 0));
const errors = computed(() => entries.value.filter((e) => e.decoded.status === "error").length);

const shown = computed(() => {
  const q = query.value.trim().toUpperCase();
  return entries.value.filter(
    (e) => (kind.value === "all" || e.resource.group === kind.value) && (!q || e.resource.name.includes(q)),
  );
});

const palettes = computed(() => resources.value.filter((r) => r.group === "palette" && paletteColors(r)));
const paletteNames = computed(() => palettes.value.map((r) => r.name));
const colorsOf = (name?: string) => {
  const r = palettes.value.find((p) => p.name === name);
  return r && paletteColors(r);
};

function choose(image: string, setting: string): PaletteChoice | undefined {
  if (paletteNames.value.includes(setting)) return { name: setting, reason: "chosen" };
  return autoPalette(image, paletteNames.value);
}

const galleryOptions = computed(() => [
  { value: AUTO, label: "Automatic (by file name)" },
  ...paletteNames.value.map((n) => ({ value: n, label: n })),
]);
const detailOptions = computed(() => [
  { value: AUTO, label: "Palette: as gallery" },
  ...paletteNames.value.map((n) => ({ value: n, label: n })),
]);

const current = computed(
  () =>
    entries.value.find((e) => e.resource.name === selected.value) ??
    entries.value.find((e) => e.decoded.status === "decoded") ??
    entries.value[0],
);
const frames = computed(() => (current.value?.decoded.status === "decoded" ? current.value.decoded.image.frames : []));
const frame = computed(() => Math.min(frameIndex.value, Math.max(0, frames.value.length - 1)));
const shownFrame = computed(() => frames.value[frame.value]);
const galleryChoice = (name: string) => choose(name, galleryPalette.value);
const detailChoice = computed(() => {
  const name = current.value?.resource.name ?? "";
  return detailPalette.value === AUTO ? galleryChoice(name) : choose(name, detailPalette.value);
});

function pick(name: string, index = 0) {
  selected.value = name;
  frameIndex.value = index;
}

function step(by: number) {
  const n = frames.value.length;
  if (n) frameIndex.value = (frame.value + by + n) % n;
}

function viewBytes(r: Resource, offset?: number) {
  selected.value = r.name;
  openAt.value = offset;
  void router.push("/files");
}

/** Scales a frame to fit a card: whole steps up to 2× for small frames, smaller for large ones. */
function cardScale(width: number, height: number, screen: boolean) {
  const fit = screen ? Math.min(216 / width, 124 / height) : Math.min(100 / width, 76 / height);
  return fit >= 1 ? Math.min(2, Math.floor(fit)) : fit;
}

let timer: ReturnType<typeof setInterval> | undefined;
watch(playing, (on) => {
  clearInterval(timer);
  if (on) timer = setInterval(() => step(1), 1000 / FPS);
});
watch(frames, (list) => {
  if (list.length < 2) playing.value = false;
});
watch(
  () => current.value?.resource.name,
  (name) =>
    name &&
    void nextTick(() => {
      document.querySelector(`[data-image="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" });
      document.querySelector('[data-card="selected"]')?.scrollIntoView({ block: "nearest" });
    }),
  { immediate: true },
);

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    search.value?.focus();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    step(e.key === "ArrowLeft" ? -1 : 1);
    // Keep the focus ring on the selected card, not on the one that was clicked.
    if (e.target.closest("[data-card]"))
      void nextTick(() => document.querySelector<HTMLElement>('[data-card="selected"]')?.focus());
  } else if (e.key === " ") {
    // A focused button already presses itself on Space.
    if (e.target.closest("button")) return;
    e.preventDefault();
    if (!e.repeat && frames.value.length > 1) playing.value = !playing.value;
  } else if (ZOOMS.includes(Number(e.key))) zoom.value = Number(e.key);
  else if (e.key.toLowerCase() === "h") flip.value = !flip.value;
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  clearInterval(timer);
  crumb.value = [];
});
watchEffect(
  () => (crumb.value = current.value ? ["Sprites", current.value.resource.name, `frame ${frame.value}`] : []),
);

const segment = (on: boolean) =>
  on ? "bg-accent font-semibold text-accent-ink" : "text-soft hover:bg-hover hover:text-ink";
</script>

<template>
  <PageHeader title="Sprites">
    <template #subtitle>
      <span class="font-mono text-ink">{{ entries.length }}</span> image files ·
      <span class="font-mono text-ink">{{ totalFrames }}</span> frames
      <template v-if="errors">
        · <span class="text-error">{{ errors }} decode {{ errors === 1 ? "error" : "errors" }}</span></template
      >
    </template>
    <LabField
      ref="search"
      v-model="query"
      label="Search image files by name"
      type="search"
      placeholder="File name… PART, SIERRA"
      class="w-[240px]"
    >
      <template #prefix><LabIcon name="search" :size="14" :stroke="2" /></template>
      <template #suffix><LabKbd>/</LabKbd></template>
    </LabField>
    <div
      class="inline-flex overflow-hidden rounded-[5px] border border-line-strong bg-sunken"
      role="group"
      aria-label="Image type"
    >
      <button
        v-for="k in KINDS"
        :key="k.id"
        type="button"
        class="h-6 min-w-[30px] cursor-pointer border-r border-line px-[9px] text-ui last:border-r-0"
        :class="segment(kind === k.id)"
        :aria-pressed="kind === k.id"
        @click="kind = k.id"
      >
        {{ k.label }}
      </button>
    </div>
    <div class="h-5 w-px bg-line"></div>
    <LabSelect v-model="galleryPalette" label="Palette for the gallery" :options="galleryOptions" />
    <LabBadge v-if="galleryPalette === AUTO" status="hypothesis" label="name-based guess" :title="AUTO_HINT" />
  </PageHeader>

  <div v-if="current" class="flex min-h-0 flex-1">
    <aside aria-label="Image files" class="flex w-[208px] shrink-0 flex-col border-r border-line bg-sunken">
      <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <PanelTitle>Files</PanelTitle>
        <div class="flex-1"></div>
        <span class="font-mono text-meta text-muted">{{ shown.length }} of {{ entries.length }}</span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto py-1">
        <button
          v-for="e in shown"
          :key="e.resource.name"
          type="button"
          :data-image="e.resource.name"
          class="flex h-[26px] w-full cursor-pointer items-center gap-2 pr-2.5 pl-3 text-left focus-visible:-outline-offset-2"
          :class="
            e.resource.name === current.resource.name
              ? 'bg-accent/12 text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
              : 'text-soft hover:bg-hover hover:text-ink'
          "
          @click="
            pick(e.resource.name);
            collapsed.delete(e.resource.name);
          "
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="{ decoded: 'bg-decoded', text: 'bg-faint', error: 'bg-error' }[e.decoded.status]"
          ></span>
          <span class="min-w-0 flex-1 truncate font-mono">{{ e.resource.name }}</span>
          <span class="font-mono text-meta text-muted">{{
            e.decoded.status === "decoded" ? frameCount(e.decoded) : e.decoded.status === "error" ? "!" : "–"
          }}</span>
        </button>
      </div>
    </aside>

    <section aria-label="Gallery" class="min-w-0 flex-1 overflow-auto px-3.5 pt-1 pb-5">
      <div v-for="e in shown" :key="e.resource.name" class="border-b border-line-soft py-2">
        <div class="flex h-[26px] items-center gap-2.5">
          <button
            type="button"
            class="flex cursor-pointer items-center gap-1.5 rounded py-0.5 pr-1 pl-0.5 font-semibold hover:bg-hover"
            :aria-expanded="!collapsed.has(e.resource.name)"
            @click="collapsed.has(e.resource.name) ? collapsed.delete(e.resource.name) : collapsed.add(e.resource.name)"
          >
            <LabIcon
              name="chevronRight"
              :size="12"
              :stroke="2.5"
              class="text-muted transition-transform"
              :class="!collapsed.has(e.resource.name) && 'rotate-90'"
            />
            <span class="font-mono">{{ e.resource.name }}</span>
          </button>
          <span class="text-muted">{{ e.resource.group === "screen" ? "screen" : "sprite sheet" }}</span>
          <span v-if="e.decoded.status === 'decoded'" class="font-mono text-muted"
            >{{ frameCount(e.decoded) }} {{ frameCount(e.decoded) === 1 ? "frame" : "frames" }}</span
          >
          <span class="font-mono text-muted">{{ formatBytes(e.resource.data.length) }} B</span>
          <div class="flex-1"></div>
          <span v-if="e.decoded.status === 'decoded'" class="text-muted"
            >{{ galleryChoice(e.resource.name)?.name ?? "no palette"
            }}{{ galleryPalette === AUTO ? " · auto" : "" }}</span
          >
          <LabBadge v-bind="badgeOf(e.decoded)" />
        </div>

        <template v-if="!collapsed.has(e.resource.name)">
          <div
            v-if="e.decoded.status !== 'decoded'"
            role="alert"
            class="mt-2 mb-0.5 ml-5 flex items-start gap-2.5 rounded-md border px-3 py-2.5"
            :class="e.decoded.status === 'error' ? 'border-error/40 bg-error/7' : 'border-line-strong bg-sunken'"
          >
            <LabIcon
              name="warning"
              :size="15"
              :stroke="2"
              class="mt-px"
              :class="e.decoded.status === 'error' ? 'text-error' : 'text-muted'"
            />
            <div class="flex flex-1 flex-col gap-[3px]">
              <template v-if="e.decoded.status === 'error'">
                <span class="font-semibold text-error">Couldn’t decode this file</span>
                <span class="font-mono text-meta text-ink">{{ e.decoded.message }}</span>
                <span class="text-muted">Other files are unaffected.</span>
              </template>
              <template v-else>
                <span class="font-semibold text-ink">Not an image</span>
                <span class="text-muted"
                  >This file is text, even though its name ends in .{{ e.resource.name.split(".").pop() }}.</span
                >
              </template>
            </div>
            <LabButton @click="viewBytes(e.resource, e.decoded.status === 'error' ? e.decoded.offset : undefined)"
              >View bytes{{
                e.decoded.status === "error" && e.decoded.offset !== undefined ? ` at ${hex(e.decoded.offset, 4)}` : ""
              }}</LabButton
            >
          </div>
          <div v-else class="mt-2 mb-1 ml-5 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            <button
              v-for="(f, i) in e.decoded.image.frames"
              :key="i"
              type="button"
              class="flex min-w-0 cursor-pointer flex-col gap-[5px] rounded-md border bg-sunken p-1"
              :class="[
                e.resource.group === 'screen' && 'col-span-2',
                e.resource.name === current.resource.name && i === frame
                  ? 'border-accent bg-accent/12 ring-1 ring-accent'
                  : 'border-line hover:border-line-strong',
              ]"
              :data-card="e.resource.name === current.resource.name && i === frame ? 'selected' : ''"
              :aria-label="`${e.resource.name} frame ${i}, ${f.width} × ${f.height}`"
              @click="pick(e.resource.name, i)"
            >
              <span
                class="flex items-center justify-center overflow-hidden rounded-[3px] checker"
                :class="e.resource.group === 'screen' ? 'h-[132px]' : 'h-[84px]'"
              >
                <PixelFrame
                  :frame="f"
                  :palette="colorsOf(galleryChoice(e.resource.name)?.name)"
                  :scale="cardScale(f.width, f.height, e.resource.group === 'screen')"
                />
              </span>
              <span class="flex justify-between gap-1 px-0.5 pb-px text-2xs whitespace-nowrap">
                <span class="text-ink">Frame {{ i }}</span>
                <span class="min-w-0 truncate font-mono text-muted">{{ f.width }} × {{ f.height }}</span>
              </span>
            </button>
          </div>
        </template>
      </div>
      <p v-if="!shown.length" class="px-5 py-15 text-center text-muted">
        No image files match “<span class="font-mono text-ink">{{ query }}</span
        >”.
      </p>
    </section>

    <aside aria-label="Frame detail" class="flex w-[392px] shrink-0 flex-col border-l border-line bg-sunken">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3">
        <span class="font-mono font-semibold">{{ current.resource.name }}</span>
        <span v-if="shownFrame" class="text-muted"
          >Frame <span class="font-mono text-ink">{{ frame }}</span></span
        >
        <div class="flex-1"></div>
        <LabBadge v-bind="badgeOf(current.decoded)" />
      </div>

      <div class="relative flex h-[300px] shrink-0 overflow-auto border-b border-line checker">
        <div class="m-auto p-6">
          <PixelFrame
            v-if="shownFrame"
            :frame="shownFrame"
            :palette="colorsOf(detailChoice?.name)"
            :scale="zoom"
            :flip="flip"
            class="outline-1 outline-accent/55 outline-dashed"
          />
          <p v-else class="text-muted">Nothing to show for this file.</p>
        </div>
        <template v-if="shownFrame">
          <span class="absolute top-2 left-2 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-label text-ink"
            >{{ zoom }}× · nearest</span
          >
          <span class="absolute top-2 right-2 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-label text-ink"
            >{{ shownFrame.width }} × {{ shownFrame.height }}</span
          >
        </template>
      </div>

      <div class="flex flex-col gap-2.5 border-b border-line px-3 py-2.5">
        <div class="flex items-center gap-1.5">
          <LabButton icon aria-label="Previous frame" :disabled="frames.length < 2" @click="step(-1)">
            <LabIcon name="chevronLeft" :size="13" :stroke="2.5" />
          </LabButton>
          <LabButton
            icon
            :aria-label="playing ? 'Pause preview' : 'Play preview'"
            :aria-pressed="playing"
            :disabled="frames.length < 2"
            :class="playing && 'border-accent! bg-accent/12! text-accent!'"
            @click="playing = !playing"
          >
            <LabIcon :name="playing ? 'pause' : 'play'" :size="12" :stroke="0" class="fill-current" />
          </LabButton>
          <LabButton icon aria-label="Next frame" :disabled="frames.length < 2" @click="step(1)">
            <LabIcon name="chevronRight" :size="13" :stroke="2.5" />
          </LabButton>
          <label class="flex min-w-0 flex-1 items-center">
            <span class="sr-only">Frame</span>
            <input
              v-model.number="frameIndex"
              class="w-full accent-accent"
              type="range"
              min="0"
              :max="Math.max(0, frames.length - 1)"
              step="1"
              :disabled="frames.length < 2"
            />
          </label>
          <span class="min-w-11 text-right font-mono whitespace-nowrap"
            >{{ frame }} / {{ Math.max(0, frames.length - 1) }}</span
          >
        </div>
        <p class="text-meta text-muted">
          Preview runs at a fixed {{ FPS }} fps — not the original game’s animation timing.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <div
            class="inline-flex overflow-hidden rounded-[5px] border border-line-strong bg-sunken"
            role="group"
            aria-label="Zoom"
          >
            <button
              v-for="z in ZOOMS"
              :key="z"
              type="button"
              class="h-6 min-w-[30px] cursor-pointer border-r border-line px-[9px] text-ui last:border-r-0"
              :class="segment(zoom === z)"
              :aria-pressed="zoom === z"
              @click="zoom = z"
            >
              {{ z }}×
            </button>
          </div>
          <LabButton
            :aria-pressed="flip"
            :class="flip && 'border-accent! bg-accent/12! text-accent!'"
            @click="flip = !flip"
          >
            <LabIcon name="flip" :size="13" :stroke="2" />Flip H
          </LabButton>
          <div class="flex-1"></div>
          <LabSelect v-model="detailPalette" label="Palette for this frame" :options="detailOptions" />
        </div>
      </div>

      <div class="flex flex-col gap-2 px-3 py-2.5">
        <PanelTitle>Metadata</PanelTitle>
        <dl class="grid grid-cols-[90px_minmax(0,1fr)] gap-x-2 gap-y-[5px] font-mono text-ui">
          <dt class="text-muted">file</dt>
          <dd>
            {{ current.resource.name }} <span class="text-muted">in {{ current.resource.archive }}</span>
          </dd>
          <template v-if="current.decoded.status === 'decoded' && shownFrame">
            <dt class="text-muted">frame</dt>
            <dd>{{ frame }} of {{ frames.length }}</dd>
            <dt class="text-muted">size</dt>
            <dd>{{ shownFrame.width }} × {{ shownFrame.height }}</dd>
            <dt class="text-muted">encoding</dt>
            <dd>{{ current.decoded.image.encoding }}</dd>
            <dt class="text-muted">palette</dt>
            <dd>
              {{ detailChoice?.name ?? "none, shown in grey" }}
              <span v-if="detailChoice" class="text-muted">({{ detailChoice.reason }})</span>
            </dd>
            <dt class="text-muted">flip</dt>
            <dd>{{ flip ? "horizontal" : "none" }}</dd>
          </template>
        </dl>
      </div>

      <div class="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-meta text-muted">
        <span><LabKbd>←</LabKbd> <LabKbd>→</LabKbd> frame</span>
        <span><LabKbd>Space</LabKbd> play</span>
        <span><LabKbd>1</LabKbd>–<LabKbd>4</LabKbd> zoom</span>
        <span><LabKbd>H</LabKbd> flip</span>
      </div>
    </aside>
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
