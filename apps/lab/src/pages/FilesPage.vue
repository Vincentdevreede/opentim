<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabField from "../components/LabField.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import PageHeader from "../components/PageHeader.vue";
import PanelTitle from "../components/PanelTitle.vue";
import PixelFrame from "../components/PixelFrame.vue";
import { inspectByte } from "../inspect.ts";
import { DOT } from "../kinds.ts";
import { resources, selected } from "../library.ts";
import { headerBytes, markerAt, markersOf } from "../markers.ts";
import { decode, imagePalette, isImage, paletteColors, statusOf } from "../sprites.ts";
import { crumb, formatBytes, hex, openAt, openFrame } from "../ui.ts";

/** Bytes per row grow with the available width, in groups of this size. */
const GROUP = 8;
const MAX_ROW = 64;
// Widths in px of the parts of a row, matching the classes in the template.
const OFFSET_WIDTH = 92;
const GROUP_GAP = 10;
const ASCII_GUTTER = 25;
const ASCII_WIDTH = 9;
const ROW_HEIGHT = 20;
/** Height of the sticky column header and its margin, which cover the top of the scroll area. */
const STICKY_HEIGHT = 32;
/** Rows rendered above and below the visible area, so fast scrolling doesn't show gaps. */
const OVERSCAN = 10;

const query = ref("");
const cursor = ref(0);
const goto = ref("");
const gotoInvalid = ref(false);
const decimal = ref(false);
const gotoField = useTemplateRef<InstanceType<typeof LabField>>("gotoField");
const viewport = useTemplateRef<HTMLDivElement>("viewport");
const body = useTemplateRef<HTMLDivElement>("body");
const scrollTop = ref(0);
const viewHeight = ref(0);
const viewWidth = ref(0);

const list = computed(() => {
  const q = query.value.trim().toUpperCase();
  return resources.value.filter((r) => !q || r.name.includes(q));
});
const current = computed(() => resources.value.find((r) => r.name === selected.value) ?? resources.value[0]);
const bytes = computed(() => current.value?.data ?? new Uint8Array());
const marked = computed(() => (current.value ? markersOf(current.value) : { markers: [] }));
const headers = computed(() => headerBytes(marked.value.markers));
const stoppedAt = computed(() => marked.value.markers.find((m) => m.error)?.offset);
/** Colours for the swatches: a palette's own colours, or the palette an image gets in Sprites. */
const swatchPalette = computed(() => {
  const r = current.value;
  if (!r) return undefined;
  if (r.group === "palette") return paletteColors(r);
  return isImage(r) ? imagePalette(r, resources.value) : undefined;
});
/** What the selected byte means. */
const info = computed(() =>
  current.value ? inspectByte(current.value, cursor.value, swatchPalette.value) : undefined,
);
/** The frame the selected byte belongs to, for the preview of an image. */
const preview = computed(() => {
  const r = current.value;
  const result = r && isImage(r) ? decode(r) : undefined;
  if (result?.status !== "decoded") return undefined;
  const frames = result.image.frames;
  const index = Math.min(info.value?.frame ?? 0, frames.length - 1);
  const frame = frames[index]!;
  const fit = Math.min(260 / frame.width, 96 / frame.height);
  return { index, count: frames.length, frame, scale: fit >= 1 ? Math.min(4, Math.floor(fit)) : fit };
});

const router = useRouter();
function openInSprites() {
  if (!current.value) return;
  selected.value = current.value.name;
  openFrame.value = preview.value?.index;
  void router.push("/sprites");
}
const inRange = (offset: number) =>
  !!info.value?.range && offset >= info.value.range[0] && offset < info.value.range[1];
/** The chunk the selected byte is in. */
const here = computed(() => markerAt(marked.value.markers, cursor.value));
const cellWidth = computed(() => (decimal.value ? 28 : 22));
const rowWidth = (n: number) =>
  OFFSET_WIDTH + n * cellWidth.value + (n / GROUP - 1) * GROUP_GAP + ASCII_GUTTER + n * ASCII_WIDTH;
/** The widest row, in whole groups, that fits the view. */
const perRow = computed(() => {
  let n = GROUP;
  while (n + GROUP <= MAX_ROW && rowWidth(n + GROUP) <= viewWidth.value) n += GROUP;
  return n;
});
const groupEnd = (i: number) => (i + 1) % GROUP === 0 && i < perRow.value - 1;

const rowCount = computed(() => Math.ceil(bytes.value.length / perRow.value));

// Only the rows in view are rendered, so large resources stay fast to scroll.
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN));
const lastRow = computed(() =>
  Math.min(rowCount.value, Math.ceil((scrollTop.value + viewHeight.value) / ROW_HEIGHT) + OVERSCAN),
);

watch(
  () => current.value?.name,
  (name) => {
    cursor.value = openAt.value ?? 0;
    openAt.value = undefined;
    goto.value = "";
    if (viewport.value) viewport.value.scrollTop = 0;
    if (cursor.value) void nextTick(() => moveTo(cursor.value, true));
    if (name)
      void nextTick(() =>
        document.querySelector(`[data-resource="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" }),
      );
  },
  { immediate: true },
);

const pad = (n: number, width: number) =>
  decimal.value ? String(n).padStart(width === 2 ? 3 : width, "0") : n.toString(16).toUpperCase().padStart(width, "0");
const columns = computed(() => Array.from({ length: perRow.value }, (_, c) => pad(c, 2)));

const rows = computed(() => {
  const out: { offset: number; cells: { offset: number; value: number }[] }[] = [];
  const end = bytes.value.length;
  const n = perRow.value;
  for (let offset = firstRow.value * n; offset < Math.min(end, lastRow.value * n); offset += n) {
    const cells = [];
    for (let o = offset; o < Math.min(offset + n, end); o++) cells.push({ offset: o, value: bytes.value[o] ?? 0 });
    out.push({ offset, cells });
  }
  return out;
});

const printable = (v: number) => v >= 0x20 && v < 0x7f;

/** Value interpretations of the bytes at the cursor; "—" when the file ends too early. */
const values = computed(() => {
  const b = bytes.value;
  const o = cursor.value;
  const has = (n: number) => o + n <= b.length;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const both = (n: number, width: number) => `${n}  (${hex(n, width)})`;
  const u8 = b[o];
  return [
    ["u8", u8 === undefined ? "—" : both(u8, 2)],
    ["i8", has(1) ? String(view.getInt8(o)) : "—"],
    ["u16 LE", has(2) ? both(view.getUint16(o, true), 4) : "—"],
    ["u16 BE", has(2) ? both(view.getUint16(o, false), 4) : "—"],
    ["u32 LE", has(4) ? String(view.getUint32(o, true)) : "—"],
    [
      "binary",
      u8 === undefined
        ? "—"
        : u8
            .toString(2)
            .padStart(8, "0")
            .replace(/(....)/, "$1 "),
    ],
    ["char", u8 === undefined ? "—" : printable(u8) ? `"${String.fromCharCode(u8)}"` : "non-printable"],
  ];
});

function moveTo(offset: number, center = false) {
  const max = Math.max(0, bytes.value.length - 1);
  cursor.value = Math.max(0, Math.min(max, offset));
  const el = viewport.value;
  if (!el) return;
  const y = (body.value?.offsetTop ?? 0) + Math.floor(cursor.value / perRow.value) * ROW_HEIGHT;
  if (center) el.scrollTop = y - el.clientHeight / 2;
  else if (y - STICKY_HEIGHT < el.scrollTop) el.scrollTop = y - STICKY_HEIGHT;
  else if (y + ROW_HEIGHT > el.scrollTop + el.clientHeight)
    el.scrollTop = y + ROW_HEIGHT - el.clientHeight + ROW_HEIGHT / 2;
}

/** Bytes in one screen of rows, for PgUp and PgDn. */
const screenBytes = () => Math.max(1, Math.floor((viewHeight.value - STICKY_HEIGHT) / ROW_HEIGHT)) * perRow.value;

function jump() {
  const text = goto.value.trim();
  const n = /^0x/i.test(text) || !decimal.value ? parseInt(text.replace(/^0x/i, ""), 16) : parseInt(text, 10);
  gotoInvalid.value = !/^(0x)?[0-9a-f]+$/i.test(text) || Number.isNaN(n) || n >= bytes.value.length;
  if (!gotoInvalid.value) moveTo(n, true);
}

function onKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -perRow.value,
    ArrowDown: perRow.value,
    PageUp: -screenBytes(),
    PageDown: screenBytes(),
  };
  if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    gotoField.value?.focus();
  } else if (e.key in step) {
    e.preventDefault();
    moveTo(cursor.value + (step[e.key] ?? 0));
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    moveTo(e.key === "Home" ? 0 : bytes.value.length - 1);
  }
}

// The hex view only exists once files are loaded, which can happen after mounting.
const resize = new ResizeObserver(([entry]) => {
  viewHeight.value = entry?.contentRect.height ?? 0;
  viewWidth.value = entry?.contentRect.width ?? 0;
});
// Keep the selected byte in view when the row width changes.
watch(perRow, () => void nextTick(() => moveTo(cursor.value)));
watch(viewport, (el, old) => {
  if (old) resize.unobserve(old);
  if (el) resize.observe(el);
});

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  resize.disconnect();
  crumb.value = [];
});
watchEffect(() => (crumb.value = current.value ? ["Files", current.value.name, hex(cursor.value)] : []));
</script>

<template>
  <PageHeader title="Files">
    <template #subtitle>Raw bytes of any resource</template>
    <span class="text-meta text-muted">
      <LabKbd>G</LabKbd> go to offset · arrows move selection · <LabKbd>PgUp</LabKbd> <LabKbd>PgDn</LabKbd> one screen
    </span>
  </PageHeader>

  <div v-if="current" class="flex min-h-0 flex-1">
    <aside aria-label="Resources" class="flex w-[232px] shrink-0 flex-col border-r border-line bg-sunken">
      <div class="border-b border-line p-2">
        <LabField v-model="query" label="Filter resources" type="search" placeholder="Any resource…">
          <template #prefix><LabIcon name="search" :size="14" :stroke="2" /></template>
        </LabField>
      </div>
      <div class="min-h-0 flex-1 overflow-auto py-1">
        <button
          v-for="r in list"
          :key="r.name"
          type="button"
          :data-resource="r.name"
          class="flex h-6 w-full cursor-pointer items-center gap-2 pr-2.5 pl-3 text-left focus-visible:-outline-offset-2"
          :class="
            r.name === current.name
              ? 'bg-accent/12 text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
              : 'text-soft hover:bg-hover hover:text-ink'
          "
          @click="selected = r.name"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="DOT[statusOf(r).status]"></span>
          <span class="min-w-0 flex-1 truncate font-mono">{{ r.name }}</span>
          <span class="text-meta text-muted">{{ r.group }}</span>
        </button>
        <p v-if="!list.length" class="px-3 py-2 text-muted">No resources match.</p>
      </div>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3">
        <span class="font-mono font-semibold">{{ current.name }}</span>
        <span class="font-mono text-muted">{{ formatBytes(bytes.length) }} B · {{ current.archive }}</span>
        <LabBadge v-bind="statusOf(current)" />
        <div class="flex-1"></div>
        <form class="flex items-center gap-2.5" @submit.prevent="jump">
          <LabField
            ref="gotoField"
            v-model="goto"
            label="Go to offset"
            :placeholder="decimal ? '420' : '0x01A4'"
            class="w-[170px] font-mono"
            :class="gotoInvalid && 'border-error!'"
            :aria-invalid="gotoInvalid"
            @input="gotoInvalid = false"
          >
            <template #prefix><span class="font-sans text-meta text-muted">Go to</span></template>
          </LabField>
          <LabButton type="submit">Go</LabButton>
        </form>
        <div
          class="inline-flex overflow-hidden rounded-[5px] border border-line-strong bg-sunken"
          role="group"
          aria-label="Number format"
        >
          <button
            v-for="mode in [false, true]"
            :key="String(mode)"
            type="button"
            class="h-6 min-w-[30px] cursor-pointer border-r border-line px-[9px] text-ui last:border-r-0"
            :class="decimal === mode ? 'bg-accent font-semibold text-accent-ink' : 'text-soft'"
            :aria-pressed="decimal === mode"
            @click="decimal = mode"
          >
            {{ mode ? "Dec" : "Hex" }}
          </button>
        </div>
      </div>

      <div
        ref="viewport"
        class="relative min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono tabular"
        @scroll="scrollTop = viewport?.scrollTop ?? 0"
      >
        <div
          class="sticky top-0 z-10 mb-1 flex h-7 items-center border-b border-line bg-surface pt-1 text-meta text-muted"
        >
          <span class="w-[92px] shrink-0">offset</span>
          <span
            v-for="(c, i) in columns"
            :key="i"
            class="shrink-0 text-center"
            :class="[decimal ? 'w-[28px]' : 'w-[22px]', groupEnd(i) && 'mr-2.5']"
            >{{ c }}</span
          >
          <span class="ml-3.5">ascii</span>
        </div>
        <div ref="body" class="relative" :style="{ height: `${rowCount * ROW_HEIGHT}px` }">
          <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${firstRow * ROW_HEIGHT}px)` }">
            <div v-for="row in rows" :key="row.offset" class="flex h-5 items-center hover:bg-line-soft">
              <span
                class="w-[92px] shrink-0"
                :class="cursor >= row.offset && cursor < row.offset + perRow ? 'text-accent' : 'text-faint'"
                >{{ pad(row.offset, 8) }}</span
              >
              <button
                v-for="(cell, i) in row.cells"
                :key="cell.offset"
                type="button"
                :data-offset="cell.offset"
                class="h-[18px] shrink-0 cursor-pointer rounded-[2px] text-center leading-[18px] focus-visible:outline-offset-0"
                :class="[
                  decimal ? 'w-[28px]' : 'w-[22px]',
                  groupEnd(i) && 'mr-2.5',
                  cell.offset === cursor
                    ? 'bg-accent font-bold text-accent-ink'
                    : cell.offset === stoppedAt
                      ? 'bg-error/20 font-bold text-error hover:bg-raised-hover'
                      : inRange(cell.offset)
                        ? 'bg-accent/15 text-ink hover:bg-raised-hover'
                        : headers.has(cell.offset)
                          ? 'text-partial hover:bg-raised-hover'
                          : cell.value === 0
                            ? 'text-faint hover:bg-raised-hover'
                            : 'hover:bg-raised-hover',
                ]"
                :aria-label="`Offset ${hex(cell.offset, 4)}, value ${hex(cell.value, 2)}`"
                @click="cursor = cell.offset"
              >
                {{ pad(cell.value, 2) }}
              </button>
              <span class="ml-3.5 flex border-l border-line pl-2.5">
                <span
                  v-for="cell in row.cells"
                  :key="cell.offset"
                  class="h-[18px] w-[9px] text-center leading-[18px]"
                  :class="
                    cell.offset === cursor
                      ? 'rounded-[1px] text-accent outline-1 outline-accent'
                      : printable(cell.value)
                        ? 'text-soft'
                        : 'text-dim'
                  "
                  >{{ printable(cell.value) ? String.fromCharCode(cell.value) : "·" }}</span
                >
              </span>
            </div>
          </div>
        </div>
        <p v-if="!bytes.length" class="py-6 font-sans text-muted">This resource is empty.</p>
      </div>
    </section>

    <aside aria-label="Byte inspector" class="flex w-[300px] shrink-0 flex-col border-l border-line bg-sunken">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <PanelTitle>Selection</PanelTitle>
        <div class="flex-1"></div>
        <span class="font-mono font-semibold text-accent">{{ hex(cursor) }}</span>
      </div>
      <div v-if="info" class="flex flex-col gap-1.5 border-b border-line px-3 py-2.5">
        <p class="text-meta text-muted">
          {{ current.archive }} at <span class="font-mono text-soft">{{ hex(info.archiveOffset) }}</span>
        </p>
        <p v-if="info.chunk" class="text-meta text-muted">
          <span class="font-mono font-semibold text-partial">{{ info.chunk.tag }}</span>
          {{ info.chunk.header ? "header" : "data" }} +
          <span class="font-mono text-soft">{{ hex(info.chunk.relative, 4) }}</span>
        </p>
        <p v-if="info.meaning" class="font-semibold text-ink">{{ info.meaning }}</p>
        <p v-if="info.detail" class="text-meta text-muted">{{ info.detail }}</p>
        <div v-if="info.swatches?.length" class="flex flex-wrap gap-1">
          <span
            v-for="(s, i) in info.swatches"
            :key="i"
            class="size-4 rounded-[3px] border border-line-strong"
            :class="!s.color && 'checker'"
            :style="{ background: s.color }"
            :title="`colour ${s.index}`"
          ></span>
        </div>
        <LabButton v-if="info.jump !== undefined" class="self-start" @click="moveTo(info.jump ?? 0, true)"
          >Jump to {{ hex(info.jump, 4) }}</LabButton
        >
      </div>
      <div v-if="preview" class="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <div class="relative flex h-[104px] items-center justify-center overflow-hidden rounded-[3px] checker">
          <PixelFrame :frame="preview.frame" :palette="swatchPalette" :scale="preview.scale" />
          <span class="absolute top-1.5 right-1.5 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-2xs text-ink"
            >{{ preview.frame.width }} × {{ preview.frame.height }}</span
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="text-meta text-muted"
            >Frame <span class="font-mono text-ink">{{ preview.index }}</span> of {{ preview.count }}</span
          >
          <div class="flex-1"></div>
          <LabButton @click="openInSprites"><LabIcon name="sprites" :size="13" :stroke="2" />Open in Sprites</LabButton>
        </div>
      </div>
      <dl
        class="grid grid-cols-[86px_minmax(0,1fr)] gap-x-2 gap-y-[5px] border-b border-line px-3 py-2.5 font-mono text-ui"
      >
        <template v-for="[label, value] in values" :key="label">
          <dt class="text-muted">{{ label }}</dt>
          <dd class="whitespace-pre">{{ value }}</dd>
        </template>
      </dl>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-2.5">
        <PanelTitle>Markers in this file</PanelTitle>
        <ul v-if="marked.markers.length" class="flex flex-col gap-0.5">
          <li v-for="(m, i) in marked.markers" :key="i">
            <div
              v-if="m.error"
              class="mb-1.5 flex items-start gap-2 rounded-md border border-error/40 bg-error/7 p-2"
              role="alert"
            >
              <LabIcon name="warning" :size="14" :stroke="2" class="mt-px text-error" />
              <div class="flex flex-1 flex-col gap-0.5">
                <span
                  ><span v-if="m.offset !== undefined" class="font-mono text-error">{{ hex(m.offset, 4) }}</span>
                  decoder stopped {{ m.offset !== undefined ? "here" : "" }}</span
                >
                <span class="text-muted">{{ m.detail }}</span>
              </div>
              <LabButton v-if="m.offset !== undefined" class="h-[22px]! text-2xs!" @click="moveTo(m.offset ?? 0, true)"
                >Jump</LabButton
              >
            </div>
            <button
              v-else
              type="button"
              class="flex w-full cursor-pointer items-baseline gap-2 rounded px-1.5 py-0.5 text-left hover:bg-hover"
              :class="here === m && 'bg-accent/12 shadow-[inset_2px_0_0_var(--color-accent)]'"
              :style="{ paddingLeft: `${6 + m.depth * 14}px` }"
              @click="moveTo(m.offset ?? 0, true)"
            >
              <span class="font-mono text-faint">{{ hex(m.offset ?? 0, 4) }}</span>
              <span class="font-mono font-semibold text-partial">{{ m.label }}</span>
              <span class="min-w-0 truncate text-meta text-muted" :title="m.detail">{{ m.detail }}</span>
            </button>
          </li>
        </ul>
        <p class="text-meta text-muted">
          {{
            marked.note ??
            "Markers come from decoders that ran on this file. Chunk headers are tinted blue; click one to jump to it."
          }}
        </p>
      </div>
    </aside>
  </div>

  <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
    <LabIcon name="files" :size="28" class="text-faint" />
    <p class="text-title font-semibold">No files loaded</p>
    <p class="text-muted">Import the game’s RESOURCE files to inspect their bytes.</p>
    <RouterLink
      to="/"
      class="mt-1 inline-flex h-[26px] items-center rounded-[5px] border border-accent bg-accent px-[9px] font-semibold text-accent-ink hover:bg-accent-hover"
    >
      Go to Import
    </RouterLink>
  </div>
</template>
