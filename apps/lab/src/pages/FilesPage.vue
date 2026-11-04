<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabListRow from "../components/LabListRow.vue";
import LabSegmented from "../components/LabSegmented.vue";
import LabFact from "../components/LabFact.vue";
import LabFacts from "../components/LabFacts.vue";
import LabField from "../components/LabField.vue";
import LabSearch from "../components/LabSearch.vue";
import LabAlert from "../components/LabAlert.vue";
import PageHeader from "../components/PageHeader.vue";
import PixelFrame from "../components/PixelFrame.vue";
import { bookmarks, bookmarksIn, removeBookmark, toggleBookmark, versionKey, type Bookmark } from "../bookmarks.ts";
import { fieldAt, fieldsOf, firstFieldFrom, type Field, type FieldKind } from "../fields.ts";
import { cssColor, inspectByte } from "../inspect.ts";
import { layoutOf, readLevels } from "../levels.ts";
import { edition, program, resources, selected } from "../library.ts";
import { listIdOf, partName, readLoadedParts } from "../parts.ts";
import { headerBytes, markerAt, markersOf } from "../markers.ts";
import { decode, imagePalette, isImage, paletteColors, statusOf } from "../sprites.ts";
import { crumb, formatBytes, hex, openAt, openSprite, selectedLevel } from "../ui.ts";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabPanelHeader from "../components/LabPanelHeader.vue";
import LabPicture from "../components/LabPicture.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabTag from "../components/LabTag.vue";
import LabToolbar from "../components/LabToolbar.vue";
import LabSwatch from "../components/LabSwatch.vue";
import LabSection from "../components/LabSection.vue";
import LabPanelBody from "../components/LabPanelBody.vue";
import LabOpenIn from "../components/LabOpenIn.vue";
import LabIcon from "../components/LabIcon.vue";

/** Bytes per row grow with the available width, in groups of this size. */
const GROUP = 8;
const MAX_ROW = 64;
// Widths in px of the parts of a row, matching the classes in the template.
const OFFSET_WIDTH = 92;
const GROUP_GAP = 10;
const ASCII_GUTTER = 25;
const ASCII_WIDTH = 9;
const ROW_HEIGHT = 20;
/** A row with names and values under its bytes: bytes, name and value lines, and a little space. */
const TALL_HEIGHT = 58;
/** Height of the sticky column header and its margin, which cover the top of the scroll area. */
const STICKY_HEIGHT = 32;
/** Rows rendered above and below the visible area, so fast scrolling doesn't show gaps. */
const OVERSCAN = 10;

const query = ref("");
const cursor = ref(0);
const goto = ref("");
const gotoInvalid = ref(false);
const FORMATS = [
  { value: "hex" as const, label: "Hex" },
  { value: "dec" as const, label: "Dec" },
];
const format = ref<"hex" | "dec">("hex");
const VIEWS = [
  { value: "fields" as const, label: "Fields", title: "Show what the decoders read under the bytes" },
  { value: "bytes" as const, label: "Bytes", title: "Only the bytes" },
];
const view = ref<"fields" | "bytes">("fields");
const showFields = computed(() => view.value === "fields");
const decimal = computed(() => format.value === "dec");
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
/** Part names for the markers of a level, from the loaded part list. */
const partList = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value)?.list);
/** A level file or scene, read as the Levels page reads it, for the link to that page. */
const levelEntry = computed(() =>
  current.value && (current.value.group === "level" || current.value.group === "scene")
    ? readLevels([current.value], layoutOf(edition.value))[0]
    : undefined,
);
/** Names a part of a level by its number, from the loaded part list. */
const nameOf = computed(() => {
  const list = partList.value;
  return (type: number) => {
    const part = list?.parts.find((p) => p.type === type);
    return part ? partName(part).name : `type ${type}`;
  };
});
const levelLayout = computed(() => levelEntry.value?.level?.layout ?? layoutOf(edition.value));
const marked = computed(() =>
  current.value ? markersOf(current.value, { layout: levelLayout.value, nameOf: nameOf.value }) : { markers: [] },
);
/** What every run of bytes means, as the decoders read it. */
const fields = computed(() =>
  current.value ? fieldsOf(current.value, { layout: levelLayout.value, nameOf: nameOf.value }) : [],
);
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
  current.value ? inspectByte(current.value, cursor.value, fields.value, swatchPalette.value) : undefined,
);
const version = computed(() => versionKey(edition.value));
/** The bookmarks in this file, by offset. */
const marks = computed(() => (current.value ? bookmarksIn(bookmarks.value, version.value, current.value.name) : []));
/** Every bookmarked byte, and the first and last byte of each bookmark, to draw them as bands. */
const bookmarked = computed(() => {
  const bytes = new Set<number>();
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const b of marks.value) {
    for (let o = b.offset; o < b.end; o++) bytes.add(o);
    starts.add(b.offset);
    ends.add(b.end - 1);
  }
  return { bytes, starts, ends };
});
/** The bookmark on the selected bytes, if any. */
const markHere = computed(() => {
  const start = info.value?.range?.[0] ?? cursor.value;
  return marks.value.find((b) => b.offset === start);
});

/** Bookmarks the selected field, named after it, and opens the name to change it; or removes its bookmark. */
function toggleMark() {
  if (!current.value || !bytes.value.length) return;
  const [offset, end] = info.value?.range ?? [cursor.value, cursor.value + 1];
  const field = fieldAt(fields.value, cursor.value);
  const part = field?.group?.split(" · ")[0];
  const name = field && field.kind !== "word" ? [part, field.name].filter(Boolean).join(" ") : `at ${hex(offset, 4)}`;
  const adding = !markHere.value;
  toggleBookmark(bookmarks.value, version.value, { file: current.value.name, offset, end, name });
  if (adding)
    void nextTick(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-bookmark="${offset}"]`);
      input?.focus();
      input?.select();
    });
}
const unmark = (b: Bookmark) => removeBookmark(bookmarks.value, version.value, b);

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
  openSprite.value = preview.value?.index;
  void router.push("/sprites");
}
function openInLevels() {
  if (!current.value) return;
  selectedLevel.value = current.value.name;
  void router.push("/levels");
}
const inRange = (offset: number) =>
  !!info.value?.range && offset >= info.value.range[0] && offset < info.value.range[1];
/** The chunk the selected byte is in. */
const here = computed(() => markerAt(marked.value.markers, cursor.value));
const cellWidth = computed(() => (decimal.value ? 28 : 22));
const rowWidth = (n: number) =>
  OFFSET_WIDTH + n * cellWidth.value + (n / GROUP - 1) * GROUP_GAP + ASCII_GUTTER + n * ASCII_WIDTH;
/**
 * The widest row, in whole groups, that fits the Bytes view. The Fields view uses the same rows, so switching between
 * them keeps every byte where it was.
 */
const perRow = computed(() => {
  let n = GROUP;
  while (n + GROUP <= MAX_ROW && rowWidth(n + GROUP) <= viewWidth.value) n += GROUP;
  return n;
});
/**
 * The width of a byte column. The Fields view has no ASCII column, so its columns stretch over that room too, for the
 * names and values under the bytes.
 */
const cellPx = computed(() => {
  if (!showFields.value) return cellWidth.value;
  const n = perRow.value;
  const free = viewWidth.value - OFFSET_WIDTH - (n / GROUP - 1) * GROUP_GAP;
  return Math.max(cellWidth.value, Math.floor((free / n) * 10) / 10);
});
const groupEnd = (i: number) => (i + 1) % GROUP === 0 && i < perRow.value - 1;

const rowCount = computed(() => Math.ceil(bytes.value.length / perRow.value));

/**
 * The row where a field shows its name and value: the one holding most of its bytes, the first on a tie. A field over
 * many rows, like compressed pixels, is labelled once and its other rows stay short.
 */
function labelRow(field: Field, n: number) {
  const first = Math.floor(field.offset / n);
  const end = field.offset + field.size;
  const inFirst = Math.min(end, (first + 1) * n) - field.offset;
  const inSecond = Math.min(end, (first + 2) * n) - (first + 1) * n;
  return inSecond > inFirst ? first + 1 : first;
}

/** Which rows are tall, and the top of every row, so rows can differ in height. */
const rowLayout = computed(() => {
  const n = perRow.value;
  const count = rowCount.value;
  const tall = new Uint8Array(count);
  if (showFields.value)
    for (const f of fields.value) {
      if (f.kind === "text") tall.fill(1, Math.floor(f.offset / n), Math.floor((f.offset + f.size - 1) / n) + 1);
      else tall[labelRow(f, n)] = 1;
    }
  const tops = new Float64Array(count + 1);
  for (let r = 0; r < count; r++) tops[r + 1] = tops[r]! + (tall[r] ? TALL_HEIGHT : ROW_HEIGHT);
  return { tall, tops };
});
const topOf = (row: number) => rowLayout.value.tops[row] ?? 0;

/** The row at a height in the body, found by halving. */
function rowAt(y: number) {
  const tops = rowLayout.value.tops;
  let low = 0;
  let high = rowCount.value;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (tops[mid]! <= y) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, Math.max(0, rowCount.value - 1));
}

// Only the rows in view are rendered, so large resources stay fast to scroll.
const firstRow = computed(() => Math.max(0, rowAt(scrollTop.value) - OVERSCAN));
const lastRow = computed(() => Math.min(rowCount.value, rowAt(scrollTop.value + viewHeight.value) + 1 + OVERSCAN));

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

interface Cell {
  offset: number;
  value: number;
  /** The cell's column in its row. */
  column: number;
}

/** A run of cells in a row that belong to one field, or to none. */
interface Segment {
  cells: Cell[];
  field?: Field;
  /** Set where the field shows its name and value. */
  label: boolean;
}

const rows = computed(() => {
  const out: { offset: number; index: number; tall: boolean; cells: Cell[]; segments: Segment[] }[] = [];
  const end = bytes.value.length;
  const n = perRow.value;
  const list = fields.value;
  for (let index = firstRow.value; index < lastRow.value; index++) {
    const offset = index * n;
    const until = Math.min(offset + n, end);
    const cells: Cell[] = [];
    for (let o = offset; o < until; o++) cells.push({ offset: o, value: bytes.value[o] ?? 0, column: o - offset });
    const segments: Segment[] = [];
    if (showFields.value) {
      let next = firstFieldFrom(list, offset);
      let at = offset;
      while (at < until) {
        const field = list[next];
        if (field && field.offset <= at) {
          const stop = Math.min(field.offset + field.size, until);
          segments.push({ cells: cells.slice(at - offset, stop - offset), field, label: labelRow(field, n) === index });
          if (field.offset + field.size <= until) next++;
          at = stop;
        } else {
          const stop = Math.min(field?.offset ?? until, until);
          segments.push({ cells: cells.slice(at - offset, stop - offset), label: false });
          at = stop;
        }
      }
    }
    out.push({ offset, index, tall: rowLayout.value.tall[index] === 1, cells, segments });
  }
  return out;
});

/** The colour of each kind of field, from the theme. */
const KIND_COLORS: Record<FieldKind, string> = {
  id: "var(--color-error)",
  text: "var(--color-ink)",
  setting: "var(--color-partial)",
  size: "var(--color-decoded)",
  position: "var(--color-accent)",
  flags: "var(--color-hypothesis)",
  link: "var(--color-faint)",
  colour: "var(--color-hypothesis)",
  data: "var(--color-dim)",
  word: "var(--color-soft)",
};
/** A field's colour; a palette colour shows as itself. */
const fieldColor = (field: Field) =>
  (field.kind === "colour" && field.colors?.length === 1 && cssColor(swatchPalette.value, field.colors[0]!)) ||
  KIND_COLORS[field.kind];

const printable = (v: number) => v >= 0x20 && v < 0x7f;
const cellWidthClass = (cell: Cell) => ["w-(--cell)", groupEnd(cell.column) && "mr-2.5"];
/** Whether a row holds a bookmarked byte, to flag it next to its offset. */
function rowMarked(offset: number) {
  const end = Math.min(offset + perRow.value, bytes.value.length);
  for (let o = offset; o < end; o++) if (bookmarked.value.bytes.has(o)) return true;
  return false;
}
/** Whether a byte is in a band: a bookmark or the selected field, drawn as one block over its bytes. */
const inBand = (offset: number) => bookmarked.value.bytes.has(offset) || inRange(offset);
/** The rounded sides of a byte: a band only rounds at its ends, at the end of a row and around the gap of a group. */
function corners(cell: Cell) {
  const { offset, column } = cell;
  if (!inBand(offset)) return "rounded-[2px]";
  const { starts, ends } = bookmarked.value;
  const left = column % GROUP === 0 || !inBand(offset - 1) || starts.has(offset);
  const right = groupEnd(column) || column === perRow.value - 1 || !inBand(offset + 1) || ends.has(offset);
  return [left && "rounded-l-[2px]", right && "rounded-r-[2px]"];
}
const cellClass = (cell: Cell) => [
  ...cellWidthClass(cell),
  corners(cell),
  cell.offset === cursor.value
    ? "bg-accent font-bold text-accent-ink"
    : cell.offset === stoppedAt.value
      ? "bg-error/20 font-bold text-error hover:bg-raised-hover"
      : bookmarked.value.bytes.has(cell.offset)
        ? inRange(cell.offset)
          ? "bg-accent/60 font-semibold text-ink"
          : "bg-accent/40 font-semibold text-ink hover:bg-accent/50"
        : inRange(cell.offset)
          ? "bg-accent/15 text-ink hover:bg-raised-hover"
          : headers.value.has(cell.offset) && !showFields.value
            ? "text-partial hover:bg-raised-hover"
            : cell.value === 0
              ? "text-faint hover:bg-raised-hover"
              : "hover:bg-raised-hover",
];
/** Letters of a text field, one under each byte. */
const letter = (v: number) => (printable(v) ? String.fromCharCode(v) : v === 0 ? "∅" : "·");

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
  const row = Math.floor(cursor.value / perRow.value);
  const y = (body.value?.offsetTop ?? 0) + topOf(row);
  const height = topOf(row + 1) - topOf(row);
  if (center) el.scrollTop = y - el.clientHeight / 2;
  else if (y - STICKY_HEIGHT < el.scrollTop) el.scrollTop = y - STICKY_HEIGHT;
  else if (y + height > el.scrollTop + el.clientHeight) el.scrollTop = y + height - el.clientHeight + ROW_HEIGHT / 2;
}

/** Bytes in about one screen of rows, for PgUp and PgDn. Rows differ in height, so this uses their average. */
function screenBytes() {
  const average = rowCount.value ? topOf(rowCount.value) / rowCount.value : ROW_HEIGHT;
  return Math.max(1, Math.floor((viewHeight.value - STICKY_HEIGHT) / average)) * perRow.value;
}

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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    gotoField.value?.focus();
  } else if (e.key === "b" || e.key === "B") {
    e.preventDefault();
    toggleMark();
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
/** The first byte in view, kept while scrolling, so the view can come back to it when the rows change. */
let topByte = 0;
function onScroll() {
  const el = viewport.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  topByte = rowAt(el.scrollTop + STICKY_HEIGHT - (body.value?.offsetTop ?? 0)) * perRow.value;
}
// A resize changes the bytes per row and switching views changes the row heights. Either way, scroll so the byte that
// was at the top is at the top again.
watch([perRow, view], () => {
  const byte = topByte;
  void nextTick(() => {
    const row = Math.floor(byte / perRow.value);
    if (viewport.value) viewport.value.scrollTop = (body.value?.offsetTop ?? 0) + topOf(row) - STICKY_HEIGHT;
  });
});
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
  </PageHeader>

  <div v-if="current" class="flex min-h-0 flex-1">
    <LabSidePanel side="left" aria-label="Resources">
      <LabToolbar>
        <LabSearch v-model="query" label="Filter resources" placeholder="Any resource…" class="flex-1" />
      </LabToolbar>
      <div class="min-h-0 flex-1 overflow-auto pb-2">
        <LabListRow
          v-for="r in list"
          :key="r.name"
          :name="r.name"
          :meta="r.group"
          :status="statusOf(r).status"
          :selected="r.name === current.name"
          :data-resource="r.name"
          @click="selected = r.name"
        />
        <LabNoMatch v-if="!list.length" what="resources" :query="query" />
      </div>
    </LabSidePanel>

    <section class="flex min-w-0 flex-1 flex-col">
      <LabToolbar>
        <span class="font-mono font-semibold">{{ current.name }}</span>
        <span class="font-mono text-muted">{{ formatBytes(bytes.length) }} B · {{ current.archive }}</span>
        <LabBadge v-bind="statusOf(current)" />
        <div class="flex-1"></div>
        <form class="flex items-center gap-2" @submit.prevent="jump">
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
        <LabSegmented v-model="view" label="View" :options="VIEWS" />
        <LabSegmented v-model="format" label="Number format" :options="FORMATS" />
      </LabToolbar>

      <div
        ref="viewport"
        class="relative min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono tabular"
        :style="{ '--cell': `${cellPx}px` }"
        @scroll="onScroll"
      >
        <div
          class="sticky top-0 z-10 mb-1 flex h-7 items-center border-b border-line bg-surface pt-1 text-meta text-muted"
        >
          <span class="w-[92px] shrink-0">offset</span>
          <span
            v-for="(c, i) in columns"
            :key="i"
            class="shrink-0 text-center"
            :class="['w-(--cell)', groupEnd(i) && 'mr-2.5']"
            >{{ c }}</span
          >
          <span v-if="!showFields" class="ml-3.5">ascii</span>
        </div>
        <div ref="body" class="relative" :style="{ height: `${topOf(rowCount)}px` }">
          <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${topOf(firstRow)}px)` }">
            <div
              v-for="row in rows"
              :key="row.offset"
              class="flex items-start hover:bg-line-soft"
              :style="{ height: `${row.tall ? TALL_HEIGHT : ROW_HEIGHT}px` }"
            >
              <span
                class="flex h-5 w-[92px] shrink-0 items-center gap-1.5 leading-5"
                :class="cursor >= row.offset && cursor < row.offset + perRow ? 'text-accent' : 'text-faint'"
                >{{ pad(row.offset, 8) }}
                <LabIcon v-if="rowMarked(row.offset)" name="bookmark" filled :size="11" class="text-accent"
              /></span>
              <template v-if="showFields">
                <div
                  v-for="(seg, s) in row.segments"
                  :key="s"
                  class="flex shrink-0 flex-col"
                  :class="
                    seg.field && [
                      'field',
                      info?.range?.[0] === seg.field.offset && 'is-selected',
                      bookmarked.bytes.has(seg.field.offset) && 'is-bookmarked',
                      `kind-${seg.field.kind}`,
                    ]
                  "
                  :style="seg.field && { '--k': fieldColor(seg.field) }"
                  :title="seg.field && `${seg.field.name} · ${seg.field.type}`"
                >
                  <div class="flex h-5 items-center">
                    <button
                      v-for="cell in seg.cells"
                      :key="cell.offset"
                      type="button"
                      :data-offset="cell.offset"
                      class="h-[18px] shrink-0 cursor-pointer text-center leading-[18px] focus-visible:outline-offset-0"
                      :class="cellClass(cell)"
                      :aria-label="`Offset ${hex(cell.offset, 4)}, value ${hex(cell.value, 2)}`"
                      @click="cursor = cell.offset"
                    >
                      {{ pad(cell.value, 2) }}
                    </button>
                  </div>
                  <div
                    v-if="row.tall && seg.field"
                    class="flex cursor-pointer flex-col"
                    @click="seg.field && moveTo(seg.field.offset)"
                  >
                    <span class="h-3.5 w-0 min-w-full truncate px-px text-2xs leading-3.5 tracking-tight text-faint">{{
                      seg.label ? seg.field.label : ""
                    }}</span>
                    <span v-if="seg.field.kind === 'text'" class="flex h-[18px] leading-[18px] font-semibold">
                      <span
                        v-for="cell in seg.cells"
                        :key="cell.offset"
                        class="shrink-0 text-center"
                        :class="[cellWidthClass(cell), printable(cell.value) ? 'value' : 'text-dim']"
                        >{{ letter(cell.value) }}</span
                      >
                    </span>
                    <span
                      v-else
                      class="h-[18px] w-0 min-w-full truncate px-px leading-[18px] tracking-tight"
                      :class="seg.label && seg.field.value !== '0' ? 'value font-semibold' : 'text-dim'"
                      >{{ seg.label ? seg.field.value : "…" }}</span
                    >
                  </div>
                </div>
              </template>
              <template v-else>
                <button
                  v-for="cell in row.cells"
                  :key="cell.offset"
                  type="button"
                  :data-offset="cell.offset"
                  class="mt-px h-[18px] shrink-0 cursor-pointer text-center leading-[18px] focus-visible:outline-offset-0"
                  :class="cellClass(cell)"
                  :aria-label="`Offset ${hex(cell.offset, 4)}, value ${hex(cell.value, 2)}`"
                  @click="cursor = cell.offset"
                >
                  {{ pad(cell.value, 2) }}
                </button>
              </template>
              <span v-if="!showFields" class="mt-px ml-3.5 flex border-l border-line pl-2.5">
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

    <LabSidePanel aria-label="Byte inspector">
      <LabPanelHeader title="Selection">
        <span class="font-mono font-semibold text-accent">{{ hex(cursor) }}</span>
        <LabButton
          variant="ghost"
          icon
          :class="markHere && 'text-accent!'"
          :title="markHere ? 'Remove the bookmark (B)' : 'Bookmark the selected bytes (B)'"
          :aria-pressed="!!markHere"
          @click="toggleMark"
          ><LabIcon name="bookmark" :filled="!!markHere"
        /></LabButton>
      </LabPanelHeader>
      <LabOpenIn
        :targets="[...(preview ? (['sprites'] as const) : []), ...(levelEntry ? (['levels'] as const) : [])]"
        @open="$event === 'sprites' ? openInSprites() : openInLevels()"
      />
      <div v-if="info" class="flex flex-col gap-1.5 border-b border-line px-3 py-2.5">
        <p class="text-meta text-muted">
          {{ current.archive }} at <span class="font-mono text-soft">{{ hex(info.archiveOffset) }}</span>
        </p>
        <p v-if="info.chunk" class="text-meta text-muted">
          <span class="font-mono font-semibold text-partial">{{ info.chunk.tag }}</span>
          {{ info.chunk.header ? "header" : "data" }} +
          <span class="font-mono text-soft">{{ hex(info.chunk.relative, 4) }}</span>
        </p>
        <p v-if="info.group" class="text-meta text-muted">{{ info.group }}</p>
        <p v-if="info.meaning" class="font-semibold text-ink">{{ info.meaning }}</p>
        <p v-if="info.type" class="font-mono text-meta text-muted">{{ info.type }}</p>
        <p v-if="info.detail" class="text-meta text-muted">{{ info.detail }}</p>
        <div v-if="info.swatches?.length" class="flex flex-wrap gap-1">
          <LabSwatch v-for="(s, i) in info.swatches" :key="i" :color="s.color" :title="`colour ${s.index}`" />
        </div>
        <LabButton v-if="info.jump !== undefined" class="self-start" @click="moveTo(info.jump ?? 0, true)"
          >Jump to {{ hex(info.jump, 4) }}</LabButton
        >
      </div>
      <div v-if="preview" class="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <LabPicture height="104px">
          <PixelFrame :frame="preview.frame" :palette="swatchPalette" :scale="preview.scale" />
          <LabTag class="absolute top-1.5 right-1.5">{{ preview.frame.width }} × {{ preview.frame.height }}</LabTag>
        </LabPicture>
        <div class="flex items-center gap-2">
          <span class="text-meta text-muted"
            >Frame <span class="font-mono text-ink">{{ preview.index }}</span> of {{ preview.count }}</span
          >
        </div>
      </div>
      <div v-if="levelEntry" class="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <template v-if="levelEntry.level">
          <p class="font-semibold text-ink">{{ levelEntry.level.title || "Scene without a title" }}</p>
          <p class="text-meta text-muted">
            <span class="font-mono text-ink">{{ levelEntry.level.parts.length }}</span> parts · version
            <span class="font-mono text-ink">0x{{ levelEntry.level.version.toString(16) }}</span>
          </p>
        </template>
        <p v-else class="text-meta text-error">Can’t be read: {{ levelEntry.error }}</p>
      </div>
      <LabFacts class="border-b border-line px-3 py-1.5">
        <LabFact v-for="[label, value] in values" :key="label" :label="label"
          ><span class="whitespace-pre">{{ value }}</span></LabFact
        >
      </LabFacts>
      <LabPanelBody>
        <LabSection title="Bookmarks">
          <ul v-if="marks.length" class="-mx-3 flex flex-col">
            <li
              v-for="b in marks"
              :key="b.offset"
              class="flex h-8 items-center gap-2 border-b border-line-soft pr-3"
              :class="markHere === b ? 'bg-accent/12' : 'hover:bg-hover'"
              :aria-current="markHere === b || undefined"
            >
              <!-- Only the selected bookmark can be renamed, so clicking another one never edits its name. -->
              <template v-if="markHere === b">
                <span class="w-[calc(3.25rem+12px)] shrink-0 pl-3 font-mono text-meta text-accent">{{
                  hex(b.offset, 4)
                }}</span>
                <input
                  v-model="b.name"
                  :data-bookmark="b.offset"
                  class="h-6 min-w-0 flex-1 rounded-[4px] border border-line bg-sunken px-1.5 text-meta text-ink hover:border-line-strong focus:border-line-strong focus:outline-none"
                  :aria-label="`Name of the bookmark at ${hex(b.offset, 4)}`"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </template>
              <button
                v-else
                type="button"
                class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pl-3 text-left focus-visible:-outline-offset-2"
                :title="`Jump to ${hex(b.offset, 4)}`"
                @click="moveTo(b.offset, true)"
              >
                <span class="w-[3.25rem] shrink-0 font-mono text-meta text-accent">{{ hex(b.offset, 4) }}</span>
                <span
                  class="h-6 min-w-0 flex-1 truncate border border-transparent px-1.5 text-meta leading-[22px] text-soft"
                  >{{ b.name }}</span
                >
              </button>
              <LabButton variant="ghost" icon :title="`Remove ${b.name}`" @click="unmark(b)"
                ><LabIcon name="x"
              /></LabButton>
            </li>
          </ul>
          <p v-else class="text-meta text-muted">No bookmarks yet</p>
        </LabSection>
        <LabSection title="Markers in this file">
          <ul v-if="marked.markers.length" class="-mx-3 flex flex-col">
            <li v-for="(m, i) in marked.markers" :key="i">
              <LabAlert v-if="m.error" class="mx-3 my-1.5">
                <span
                  ><span v-if="m.offset !== undefined" class="font-mono text-error">{{ hex(m.offset, 4) }}</span>
                  decoder stopped {{ m.offset !== undefined ? "here" : "" }}</span
                >
                <span class="text-muted">{{ m.detail }}</span>
                <template v-if="m.offset !== undefined" #action>
                  <LabButton class="h-[22px]! text-2xs!" @click="moveTo(m.offset ?? 0, true)">Jump</LabButton>
                </template>
              </LabAlert>
              <LabListRow
                v-else
                :name="hex(m.offset ?? 0, 4)"
                name-width="3.25rem"
                :selected="here === m"
                :indent="m.depth"
                inset
                @click="moveTo(m.offset ?? 0, true)"
              >
                <span class="shrink-0 font-mono text-meta font-semibold text-partial">{{ m.label }}</span>
                <span class="min-w-0 truncate text-meta text-muted" :title="m.detail">{{ m.detail }}</span>
              </LabListRow>
            </li>
          </ul>
        </LabSection>
        <p class="text-meta text-muted">
          {{
            marked.note ??
            (showFields
              ? "Markers come from decoders that ran on this file. Click one to jump to it."
              : "Markers come from decoders that ran on this file. Chunk headers are tinted blue; click one to jump to it.")
          }}
        </p>
      </LabPanelBody>
    </LabSidePanel>
  </div>

  <LabEmpty
    v-else
    icon="files"
    title="No files loaded"
    text="Import the game’s RESOURCE files to inspect their bytes."
    import-link
  />
</template>

<style scoped>
/* A field's bytes are tinted in its colour, with a line on top and a hairline between neighbouring fields. */
.field {
  border-radius: 2px;
  background: color-mix(in srgb, var(--k) 11%, transparent);
  box-shadow:
    inset 0 2px 0 color-mix(in srgb, var(--k) 70%, transparent),
    inset 1px 0 0 var(--color-surface);
}
/* A bookmarked field gets a frame in the accent colour, so it stands out from the fields around it. */
.field.is-bookmarked {
  box-shadow:
    inset 0 0 0 1px var(--color-accent),
    inset 0 2px 0 var(--color-accent);
}
.field.is-selected {
  background: color-mix(in srgb, var(--k) 26%, transparent);
}
.field .value {
  color: var(--k);
}
/* A palette colour can be as dark as the page, so its value keeps the text colour. */
.field.kind-colour .value {
  color: var(--color-ink);
}
</style>
