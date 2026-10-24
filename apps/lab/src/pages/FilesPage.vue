<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch, watchEffect } from "vue";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabField from "../components/LabField.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import PageHeader from "../components/PageHeader.vue";
import PanelTitle from "../components/PanelTitle.vue";
import { DOT, SUPPORT } from "../kinds.ts";
import { resources, selected } from "../library.ts";
import { crumb, formatBytes, hex } from "../ui.ts";

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
    cursor.value = 0;
    goto.value = "";
    if (viewport.value) viewport.value.scrollTop = 0;
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
          <span class="size-1.5 shrink-0 rounded-full" :class="DOT[SUPPORT[r.group].status]"></span>
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
        <LabBadge :status="SUPPORT[current.group].status" />
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
      <dl
        class="grid grid-cols-[86px_minmax(0,1fr)] gap-x-2 gap-y-[5px] border-b border-line px-3 py-2.5 font-mono text-ui"
      >
        <template v-for="[label, value] in values" :key="label">
          <dt class="text-muted">{{ label }}</dt>
          <dd class="whitespace-pre">{{ value }}</dd>
        </template>
      </dl>
      <div class="flex flex-col gap-2 px-3 py-2.5">
        <PanelTitle>Markers in this file</PanelTitle>
        <p class="text-meta text-muted">
          Markers come from decoders that ran on this file, such as the point where a decoder stopped. No decoders run
          in the lab yet, so no bytes are marked.
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
