<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { editionHint, editionLanguages, editionName } from "../../edition.ts";
import { GROUPS, SUPPORT, type KindGroup } from "../../kinds.ts";
import { listIdOf, readLoadedParts } from "../../parts.ts";
import { decode, imagePalette, isImage, statusOf } from "../../sprites.ts";
import {
  archives,
  canPersist,
  edition,
  forget,
  program,
  readSeconds,
  resources,
  selected,
  type Resource,
} from "../../library.ts";
import { firstSoundOf } from "../../audio.ts";
import { crumb, formatBytes, hex, openSprite, selectedLevel, selectedSound } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabSearch from "../LabSearch.vue";
import LabHints from "../LabHints.vue";
import LabConfirm from "../LabConfirm.vue";
import LabPanelBody from "../LabPanelBody.vue";
import PageHeader from "../PageHeader.vue";
import LabFact from "../LabFact.vue";
import LabFacts from "../LabFacts.vue";
import LabTable, { type Column } from "../LabTable.vue";
import PixelFrame from "../PixelFrame.vue";
import StorageNotice from "./StorageNotice.vue";
import LabNoMatch from "../LabNoMatch.vue";
import LabPanelHeader from "../LabPanelHeader.vue";
import LabPicture from "../LabPicture.vue";
import LabSidePanel from "../LabSidePanel.vue";
import LabTag from "../LabTag.vue";
import LabOpenIn, { type OpenTarget } from "../LabOpenIn.vue";
import LabListRow from "../LabListRow.vue";

type SortKey = "name" | "kind" | "size";

const router = useRouter();
const group = ref<KindGroup | "all">("all");
const query = ref("");
const sortKey = ref<SortKey>("name");
const sortDir = ref<1 | -1>(1);
const COLUMNS: Column[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "kind", label: "Kind", width: "120px", sortable: true },
  { key: "size", label: "Size (bytes)", width: "130px", align: "right", sortable: true },
  { key: "source", label: "Source", width: "200px" },
  { key: "status", label: "Status", width: "140px" },
];

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

/** The parts of the loaded game, read from its program or from INFO.RES, for the Parts card. */
const loadedParts = computed(
  () => program.value && readLoadedParts(listIdOf(edition.value), resources.value, program.value),
);
/** The badge of the Parts card: where the parts were read from, or why the lab has none for this game. */
const partsBadge = computed(() => {
  const l = loadedParts.value;
  if (!l)
    return {
      status: "unsupported" as const,
      title: "The lab can’t read the parts of these files yet. It reads those of TIM 1, Even More, TIM 2 and Toons.",
    };
  if (l.source === undefined) return { status: "error" as const, title: l.problem };
  const from = l.source === "program" ? (program.value?.name ?? "the program") : "INFO.RES";
  // Parts OpenTIM has no id for yet make the list incomplete.
  if (l.unknown.length)
    return {
      status: "partial" as const,
      title: `Read from ${from}. OpenTIM has no id for parts ${l.unknown.join(", ")} yet.`,
    };
  return { status: "decoded" as const, title: `Read from ${from}.` };
});

/** The badge of a kind: what its decoder made of the loaded files of that kind, or what the lab can do with it. */
function cardStatus(id: KindGroup) {
  const support = SUPPORT[id].status;
  if (support === "unsupported") return { status: support };
  const statuses = resources.value.filter((r) => r.group === id).map((r) => statusOf(r).status);
  const failed = statuses.filter((s) => s === "error").length;
  if (!statuses.length || !failed) return { status: support };
  return failed === statuses.length
    ? { status: "error" as const, label: "can’t read" }
    : { status: "partial" as const, label: `${failed} can’t be read` };
}

const rows = computed(() => {
  const q = query.value.trim().toUpperCase();
  return resources.value
    .filter((r) => (group.value === "all" || r.group === group.value) && (!q || r.name.includes(q)))
    .sort((a, b) => COMPARE[sortKey.value](a, b) * sortDir.value);
});

const current = computed(() => resources.value.find((r) => r.name === selected.value));
const groupLabel = (id: KindGroup) => GROUPS.find((g) => g.id === id)?.label ?? id;

function sort(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else [sortKey.value, sortDir.value] = [key, 1];
}

const openBytes = () => router.push("/files");

/** The decoded image of the selected resource, with its first frame for the preview. */
const image = computed(() => {
  const r = current.value;
  if (!r || !isImage(r)) return undefined;
  const result = decode(r);
  if (result.status !== "decoded") return undefined;
  const frame = result.image.frames[0]!;
  const fit = Math.min(292 / frame.width, 120 / frame.height);
  return {
    frame,
    count: result.image.frames.length,
    palette: imagePalette(r, resources.value),
    scale: fit >= 1 ? Math.min(4, Math.floor(fit)) : fit,
  };
});

/** What the lab's decoder made of the selected resource. */
const decoderNote = computed(() => {
  const r = current.value;
  if (!r) return "";
  const result = isImage(r) ? decode(r) : undefined;
  if (result?.status === "text") return "Text with an image name, so not an image.";
  if (result?.status === "error") return `Couldn’t decode it: ${result.message}`;
  return SUPPORT[r.group].note;
});

/** The pages that can open the selected resource: Files always, Sprites for images, Levels for levels and scenes. */
const openTargets = computed<OpenTarget[]>(() => {
  const r = current.value;
  if (!r) return [];
  return [
    "files",
    ...(image.value ? (["sprites"] as const) : []),
    ...(r.group === "level" || r.group === "scene" ? (["levels"] as const) : []),
    ...(firstSoundOf(r, resources.value) ? (["audio"] as const) : []),
  ];
});

function openIn(target: OpenTarget) {
  if (!current.value) return;
  if (target === "sprites") openSprite.value = 0;
  if (target === "levels") selectedLevel.value = current.value.name;
  if (target === "audio") selectedSound.value = firstSoundOf(current.value, resources.value);
  void router.push(`/${target}`);
}

const confirmRemove = ref(false);

function select(name: string) {
  selected.value = name;
  void nextTick(() => document.querySelector(`[data-row="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" }));
}

function onKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable))
    return;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.value.length) {
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
      <span class="font-mono text-ink">{{ archives.length }}</span> files<template v-if="program">
        including <span class="font-mono text-ink">{{ program.name }}</span></template
      >
      · read in {{ readSeconds.toFixed(1) }} s
    </template>
    <LabButton v-if="canPersist" variant="ghost" tone="danger" @click="confirmRemove = true"
      ><LabIcon name="trash" />Remove from browser</LabButton
    >
  </PageHeader>

  <div class="flex min-h-0 flex-1">
    <section class="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3.5">
      <h2 v-if="edition" class="shrink-0 text-heading font-semibold" :title="editionHint(edition)">
        <span class="font-normal text-muted">Game:</span> {{ editionName(edition)
        }}<span v-if="editionLanguages(edition)" class="font-normal text-muted">
          · {{ editionLanguages(edition) }}</span
        >
      </h2>
      <div role="group" aria-label="Filter by kind" class="grid shrink-0 grid-cols-9 gap-2">
        <template v-for="card in cards" :key="card.id">
          <button
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
            <LabBadge v-else v-bind="cardStatus(card.id)" class="self-start" />
          </button>
          <!-- Parts aren't files, so this card opens their page instead of filtering the table. -->
          <button
            v-if="card.id === 'sprites'"
            type="button"
            class="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-line bg-sunken px-3 py-2.5 text-left hover:border-line-strong hover:bg-hover"
            @click="router.push('/parts')"
          >
            <span class="flex items-center gap-1 text-ui text-soft"
              >Parts<LabIcon name="chevronRight" :size="12" class="text-muted"
            /></span>
            <span class="font-mono text-stat leading-none">{{ loadedParts?.list?.parts.length ?? 0 }}</span>
            <LabBadge v-bind="partsBadge" class="self-start" />
          </button>
        </template>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <LabSearch
          v-model="query"
          label="Filter resources by name"
          placeholder="Filter by name…  e.g. PART, L12, .PAL"
          class="w-[300px]"
        />
        <span class="text-muted"
          ><span class="font-mono text-ink">{{ rows.length }}</span> of
          <span class="font-mono">{{ resources.length }}</span> shown</span
        >
        <div class="flex-1"></div>
        <LabHints
          :hints="[
            [[], 'Click a header to sort'],
            [['↑', '↓'], 'move'],
            [['↵'], 'view bytes'],
          ]"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-auto rounded-t-lg border border-b-0 border-line bg-well">
        <LabTable
          :columns="COLUMNS"
          :rows="rows"
          :row-key="(r) => r.name"
          :selected="selected ?? ''"
          :sort-key="sortKey"
          :sort-dir="sortDir"
          @select="select"
          @open="openBytes"
          @sort="sort($event as SortKey)"
        >
          <template #cell-name="{ row }">
            <button
              type="button"
              class="cursor-pointer rounded-xs font-mono text-meta"
              @click.stop="select(row.name)"
              @keydown.enter.prevent.stop="openBytes"
            >
              {{ row.name }}
            </button>
          </template>
          <template #cell-kind="{ row }"
            ><span class="text-muted">{{ row.group }}</span></template
          >
          <template #cell-size="{ row }"
            ><span class="font-mono text-meta">{{ formatBytes(row.data.length) }}</span></template
          >
          <template #cell-source="{ row }"
            ><span class="font-mono text-meta text-muted">{{ row.archive }} @ {{ hex(row.offset, 6) }}</span></template
          >
          <template #cell-status="{ row }"><LabBadge v-bind="statusOf(row)" /></template>
        </LabTable>
        <LabNoMatch v-if="!rows.length" what="resources" :query="query" class="p-10">
          <LabButton variant="link" tone="accent" @click="((query = ''), (group = 'all'))">Clear filters</LabButton>
        </LabNoMatch>
      </div>
    </section>

    <LabSidePanel aria-label="Resource details">
      <LabPanelHeader title="Resource">
        <LabBadge v-if="current" v-bind="statusOf(current)" />
      </LabPanelHeader>
      <LabOpenIn v-if="current" :targets="openTargets" @open="openIn" />
      <LabPanelBody v-if="current">
        <div class="flex flex-col gap-1">
          <span class="font-mono text-heading font-semibold break-all">{{ current.name }}</span>
          <span class="text-muted">{{ groupLabel(current.group) }} · {{ current.kind }}</span>
        </div>
        <LabFacts>
          <LabFact label="Size"
            >{{ formatBytes(current.data.length) }} B
            <span class="text-muted">· {{ hex(current.data.length, 4) }}</span></LabFact
          >
          <LabFact label="Archive">{{ current.archive }}</LabFact>
          <LabFact label="Offset">{{ hex(current.offset) }}</LabFact>
          <LabFact label="Decoder" prose>{{ decoderNote }}</LabFact>
        </LabFacts>
        <LabPicture v-if="image" height="128px">
          <PixelFrame :frame="image.frame" :palette="image.palette" :scale="image.scale" />
          <LabTag class="absolute top-1.5 right-1.5"
            >frame 0 of {{ image.count }} · {{ image.frame.width }} × {{ image.frame.height }}</LabTag
          >
        </LabPicture>
      </LabPanelBody>
      <p v-else class="p-3 text-muted">Select a resource to see its details.</p>

      <div v-if="!canPersist" class="mt-auto px-3 pb-3"><StorageNotice /></div>
      <section :class="canPersist && 'mt-auto'" class="border-t border-line pb-1">
        <!-- Every loaded file, the program like TIM.EXE among them. -->
        <LabPanelHeader title="Loaded files" :meta="archives.length" />
        <LabListRow v-for="a in archives" :key="a.name" :name="a.name" inset class="last:after:hidden">
          <template #end>
            <span class="font-mono text-meta text-muted">{{ formatBytes(a.size) }} B</span>
          </template>
        </LabListRow>
      </section>
    </LabSidePanel>

    <LabConfirm
      v-model:open="confirmRemove"
      title="Remove from browser?"
      confirm-label="Remove"
      danger
      @confirm="forget"
    >
      The loaded game files are removed from this browser. You can load them again from Import.
    </LabConfirm>
  </div>
</template>
