<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { GROUPS, SUPPORT, type KindGroup } from "../../kinds.ts";
import {
  archives,
  canPersist,
  forget,
  pickFiles,
  readSeconds,
  resources,
  selected,
  type Resource,
} from "../../library.ts";
import { crumb, formatBytes, hex } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabField from "../LabField.vue";
import LabIcon from "../LabIcon.vue";
import LabKbd from "../LabKbd.vue";
import PageHeader from "../PageHeader.vue";
import PanelTitle from "../PanelTitle.vue";
import StorageNotice from "./StorageNotice.vue";

type SortKey = "name" | "kind" | "size";

const router = useRouter();
const filterField = useTemplateRef<InstanceType<typeof LabField>>("filterField");
const group = ref<KindGroup | "all">("all");
const query = ref("");
const sortKey = ref<SortKey>("name");
const sortDir = ref(1);

const byName = (a: Resource, b: Resource) => a.name.localeCompare(b.name, "en", { numeric: true });
const COMPARE: Record<SortKey, (a: Resource, b: Resource) => number> = {
  name: byName,
  kind: (a, b) => a.group.localeCompare(b.group) || byName(a, b),
  size: (a, b) => a.data.length - b.data.length,
};

const cards = computed(() => [
  { id: "all" as const, label: "All kinds", count: resources.value.length },
  ...GROUPS.map((g) => ({ ...g, count: resources.value.filter((r) => r.group === g.id).length })),
]);

const rows = computed(() => {
  const q = query.value.trim().toUpperCase();
  return resources.value
    .filter((r) => (group.value === "all" || r.group === group.value) && (!q || r.name.includes(q)))
    .sort((a, b) => COMPARE[sortKey.value](a, b) * sortDir.value);
});

const current = computed(() => resources.value.find((r) => r.name === selected.value));
const groupLabel = (id: KindGroup) => GROUPS.find((g) => g.id === id)?.label ?? id;

function sort(key: SortKey) {
  if (sortKey.value === key) sortDir.value = -sortDir.value;
  else [sortKey.value, sortDir.value] = [key, 1];
}

const ariaSort = (key: SortKey) =>
  sortKey.value === key ? (sortDir.value === 1 ? "ascending" : "descending") : "none";
const arrow = (key: SortKey) => (sortKey.value === key ? (sortDir.value === 1 ? "▲" : "▼") : "");

const openBytes = () => router.push("/files");

async function remove() {
  if (confirm("Remove the loaded game files from this browser?")) await forget();
}

function select(name: string) {
  selected.value = name;
  void nextTick(() => document.querySelector(`[data-row="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" }));
}

function onKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable))
    return;
  if (e.key === "/") {
    e.preventDefault();
    filterField.value?.focus();
  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.value.length) {
    e.preventDefault();
    const i = rows.value.findIndex((r) => r.name === selected.value);
    const next = rows.value[Math.max(0, Math.min(rows.value.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(next.name);
  } else if (e.key === "Enter" && current.value && !(e.target instanceof HTMLButtonElement)) {
    void openBytes();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  crumb.value = [];
});
watchEffect(() => (crumb.value = ["Overview", ...(selected.value ? [selected.value] : [])]));
</script>

<template>
  <PageHeader title="Overview">
    <template #subtitle>
      <span class="font-mono text-ink">{{ resources.length }}</span> resources from
      <span class="font-mono text-ink">{{ archives.length }}</span> files · read in {{ readSeconds.toFixed(1) }} s
    </template>
    <LabButton variant="ghost" @click="pickFiles"
      ><LabIcon name="folder" :size="14" :stroke="2" />Load other files…</LabButton
    >
  </PageHeader>

  <div class="flex min-h-0 flex-1">
    <section class="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3.5">
      <div role="group" aria-label="Filter by kind" class="grid shrink-0 grid-cols-8 gap-2">
        <button
          v-for="card in cards"
          :key="card.id"
          type="button"
          class="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left"
          :class="
            group === card.id
              ? 'border-accent bg-accent/8'
              : 'border-line bg-sunken hover:border-line-strong hover:bg-hover'
          "
          :aria-pressed="group === card.id"
          @click="group = card.id"
        >
          <span class="text-ui text-soft">{{ card.label }}</span>
          <span class="font-mono text-stat leading-none">{{ card.count }}</span>
          <span v-if="card.id === 'all'" class="font-mono text-muted">{{ archives.length }} files</span>
          <LabBadge v-else :status="SUPPORT[card.id].status" class="self-start" />
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <LabField
          ref="filterField"
          v-model="query"
          label="Filter resources by name"
          type="search"
          placeholder="Filter by name…  e.g. PART, L12, .PAL"
          class="w-[300px]"
        >
          <template #prefix><LabIcon name="search" :size="14" :stroke="2" /></template>
          <template #suffix><LabKbd>/</LabKbd></template>
        </LabField>
        <span class="text-muted"
          ><span class="font-mono text-ink">{{ rows.length }}</span> of
          <span class="font-mono">{{ resources.length }}</span> shown</span
        >
        <div class="flex-1"></div>
        <span class="text-meta text-muted"
          >Click a header to sort · <LabKbd>↑</LabKbd> <LabKbd>↓</LabKbd> move · <LabKbd>↵</LabKbd> view bytes</span
        >
      </div>

      <div class="min-h-0 flex-1 overflow-auto rounded-t-lg border border-b-0 border-line bg-well">
        <table class="w-full border-separate border-spacing-0">
          <thead>
            <tr
              class="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-line [&_th]:bg-sunken [&_th]:p-0"
            >
              <th
                v-for="col in [
                  { key: 'name', label: 'Name', class: '' },
                  { key: 'kind', label: 'Kind', class: 'w-[120px]' },
                  { key: 'size', label: 'Size (bytes)', class: 'w-[130px]' },
                ] as const"
                :key="col.key"
                :class="col.class"
                :aria-sort="ariaSort(col.key)"
              >
                <button
                  type="button"
                  class="flex h-7 w-full cursor-pointer items-center gap-1 px-2.5 text-label font-semibold tracking-[.06em] text-muted uppercase hover:text-ink focus-visible:-outline-offset-2"
                  :class="col.key === 'size' && 'justify-end'"
                  @click="sort(col.key)"
                >
                  {{ col.label }} <span class="font-mono text-accent">{{ arrow(col.key) }}</span>
                </button>
              </th>
              <th class="w-[200px]">
                <span
                  class="flex h-7 items-center px-2.5 text-label font-semibold tracking-[.06em] text-muted uppercase"
                  >Source</span
                >
              </th>
              <th class="w-[140px]">
                <span
                  class="flex h-7 items-center px-2.5 text-label font-semibold tracking-[.06em] text-muted uppercase"
                  >Status</span
                >
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.name"
              :data-row="r.name"
              class="group cursor-pointer [&_td]:h-[26px] [&_td]:border-b [&_td]:border-line-soft [&_td]:px-2.5 [&_td]:whitespace-nowrap"
              :class="
                r.name === selected
                  ? '[&_td]:bg-accent/12 [&_td:first-child]:shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'hover:[&_td]:bg-hover'
              "
              @click="select(r.name)"
              @dblclick="openBytes"
            >
              <td>
                <button
                  type="button"
                  class="cursor-pointer rounded-xs font-mono"
                  @click.stop="select(r.name)"
                  @keydown.enter.prevent.stop="openBytes"
                >
                  {{ r.name }}
                </button>
              </td>
              <td class="text-soft">{{ r.group }}</td>
              <td class="text-right font-mono">{{ formatBytes(r.data.length) }}</td>
              <td class="font-mono text-muted">{{ r.archive }} @ {{ hex(r.offset, 6) }}</td>
              <td><LabBadge :status="SUPPORT[r.group].status" /></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="p-10 text-center text-muted">
          No resources match “<span class="font-mono text-ink">{{ query }}</span
          >”.
          <button type="button" class="cursor-pointer text-accent" @click="((query = ''), (group = 'all'))">
            Clear filters
          </button>
        </div>
      </div>
    </section>

    <aside aria-label="Resource details" class="flex w-80 shrink-0 flex-col border-l border-line bg-sunken">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <PanelTitle>Resource</PanelTitle>
        <div class="flex-1"></div>
        <LabBadge v-if="current" :status="SUPPORT[current.group].status" />
      </div>
      <div v-if="current" class="flex flex-col gap-3.5 px-3 py-3.5">
        <div class="flex flex-col gap-0.5">
          <span class="font-mono text-heading font-semibold break-all">{{ current.name }}</span>
          <span class="text-muted">{{ groupLabel(current.group) }} · {{ current.kind }}</span>
        </div>
        <dl class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
          <dt class="text-muted">Size</dt>
          <dd class="font-mono">
            {{ formatBytes(current.data.length) }} B <span class="text-muted">· {{ hex(current.data.length, 4) }}</span>
          </dd>
          <dt class="text-muted">Archive</dt>
          <dd class="font-mono">{{ current.archive }}</dd>
          <dt class="text-muted">Offset</dt>
          <dd class="font-mono">{{ hex(current.offset) }}</dd>
          <dt class="text-muted">Decoder</dt>
          <dd class="text-soft">{{ SUPPORT[current.group].note }}</dd>
        </dl>
        <div class="flex flex-wrap gap-2">
          <LabButton variant="primary" @click="openBytes"
            ><LabIcon name="bytes" :size="14" :stroke="2" />View bytes</LabButton
          >
        </div>
      </div>
      <p v-else class="p-3 text-muted">Select a resource to see its details.</p>

      <div v-if="!canPersist" class="mt-auto px-3 pb-3"><StorageNotice /></div>
      <div :class="canPersist && 'mt-auto'" class="flex flex-col gap-2 border-t border-line p-3">
        <div class="flex items-center">
          <PanelTitle>Loaded files</PanelTitle>
          <div class="flex-1"></div>
          <button
            v-if="canPersist"
            type="button"
            class="cursor-pointer text-meta text-muted hover:text-error"
            @click="remove"
          >
            Remove from browser
          </button>
        </div>
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 font-mono text-meta text-soft">
          <template v-for="a in archives" :key="a.name">
            <span>{{ a.name }}</span
            ><span class="text-muted">{{ formatBytes(a.size) }} B</span>
          </template>
        </div>
      </div>
    </aside>
  </div>
</template>
