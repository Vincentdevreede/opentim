<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import {
  AFFECT_COLOURS as COLOURS,
  AFFECT_KINDS,
  AFFECT_LABELS,
  affectPairs,
  type AffectKind,
  type AffectPair,
} from "../affects.ts";
import { readBehaviourInBackground, readingPerType, walksAfterPerType, type WalksResult } from "../behaviour.ts";
import AffectsLists from "../components/AffectsLists.vue";
import LabButton from "../components/LabButton.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabIcon from "../components/LabIcon.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabOpenIn from "../components/LabOpenIn.vue";
import LabPanelHeader from "../components/LabPanelHeader.vue";
import LabSearch from "../components/LabSearch.vue";
import LabSegmented from "../components/LabSegmented.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabToolbar from "../components/LabToolbar.vue";
import PageHeader from "../components/PageHeader.vue";
import BehaviourEffect from "../components/sprites/BehaviourEffect.vue";
import BehaviourRow from "../components/sprites/BehaviourRow.vue";
import { edition, program, resources } from "../library.ts";
import { listIdOf, partName, readLoadedParts } from "../parts.ts";
import { crumb, selectedAffect as selection, selectedPart } from "../ui.ts";

/**
 * Who affects whom: a grid of every part against every other, with a square where the part of the column changes the
 * part of the row, coloured by what it does, from what the walks say other parts do to each part. A part or a square
 * opens on the right: what the part does and has done to it, or each way one part changes the other, as the
 * Behaviour tab says it.
 */
const router = useRouter();

const HOWS = [
  { value: "all", label: "All" },
  { value: "reach", label: "Reaches", title: "A part that reaches another, like a fan's wind or a vacuum's pull" },
  { value: "touch", label: "Touches", title: "A part that changes another when the two touch" },
] as const;
const ORDERS = [
  { value: "number", label: "Number" },
  { value: "active", label: "Most active", title: "The parts that do and have done most first" },
] as const;

const loaded = computed(() => readLoadedParts(listIdOf(edition.value), resources.value, program.value));

const list = computed(() => loaded.value?.list);
const names = computed(() => new Map(list.value?.parts.map((p) => [p.type, partName(p).name])));
const nameOf = (type: number) => names.value.get(type) ?? `Type ${type}`;

/** The walks, which say what other parts do to each part; the loops read per type come last and add more. */
const walks = shallowRef<WalksResult | { status: "reading" }>();
watch(
  () => [program.value?.data, loaded.value?.program] as const,
  ([data, parts]) => {
    walks.value = undefined;
    if (!data || !parts) return;
    walks.value = { status: "reading" };
    const reading = readBehaviourInBackground(data, parts);
    void reading.walks.then((result) => {
      if (program.value?.data === data) walks.value = result;
    });
    void reading.perType.then((result) => {
      if (program.value?.data === data) walks.value = walksAfterPerType(walks.value, result);
    });
  },
  { immediate: true },
);

const pairs = computed<AffectPair[]>(() =>
  walks.value?.status === "done" ? affectPairs(walks.value.effects, walks.value.doings) : [],
);

const kinds = ref(new Set<AffectKind>(AFFECT_KINDS));
const how = ref<(typeof HOWS)[number]["value"]>("all");
const order = ref<(typeof ORDERS)[number]["value"]>("number");
const query = ref("");

const shows = (p: AffectPair) =>
  p.kinds.some((k) => kinds.value.has(k)) && (how.value === "all" || p.how === how.value || p.how === "both");
const shown = computed(() => pairs.value.filter(shows));
const byKey = computed(() => new Map(shown.value.map((p) => [`${p.source}:${p.target}`, p])));
const firstKind = (p: AffectPair) => AFFECT_KINDS.find((k) => p.kinds.includes(k) && kinds.value.has(k)) ?? p.kinds[0]!;
const kindCounts = computed(() => {
  const n = new Map<AffectKind, number>();
  for (const p of pairs.value) for (const k of p.kinds) n.set(k, (n.get(k) ?? 0) + 1);
  return n;
});
function toggleKind(k: AffectKind) {
  const next = new Set(kinds.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  kinds.value = next;
}

/** The columns: every part, by number or with the most active first. */
const columns = computed(() => {
  const parts = [...(list.value?.parts ?? [])].map((p) => p.type);
  if (order.value === "active") {
    const n = new Map(parts.map((t) => [t, 0]));
    for (const p of shown.value) {
      n.set(p.source, (n.get(p.source) ?? 0) + 1);
      n.set(p.target, (n.get(p.target) ?? 0) + 1);
    }
    parts.sort((a, b) => n.get(b)! - n.get(a)! || a - b);
  }
  return parts;
});
/** The rows: the same parts, those that match the filter. */
const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? columns.value.filter((t) => nameOf(t).toLowerCase().includes(q) || String(t) === q) : columns.value;
});

/** What the panel shows: one part, or one pair. It starts on the vacuum cleaner when there is one. */
watchEffect(() => {
  if (selection.value || !list.value) return;
  const start = list.value.parts.find((p) => p.id === "vacuum-cleaner") ?? list.value.parts[0];
  if (start) selection.value = { part: start.type };
});
const selectedType = computed(() => (selection.value && "part" in selection.value ? selection.value.part : undefined));
const selectedPair = computed(() =>
  selection.value && "source" in selection.value
    ? pairs.value.find((p) => {
        const s = selection.value as { source: number; target: number };
        return p.source === s.source && p.target === s.target;
      })
    : undefined,
);
const rowLit = computed(() => selectedType.value ?? selectedPair.value?.target);
const columnLit = computed(() => selectedType.value ?? selectedPair.value?.source);

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const howWords = (p: AffectPair) => (p.how === "touch" ? "touching" : p.how === "both" ? "both" : "reaching");
const kindWords = (p: AffectPair) => p.kinds.map((k) => AFFECT_LABELS[k]).join(", ");

function openInParts(type: number) {
  const id = list.value?.parts.find((p) => p.type === type)?.id;
  if (!id) return;
  selectedPart.value = id;
  void router.push("/parts");
}

/** Why there is nothing to show, when there can't be anything. */
const nothing = computed(() => {
  const l = loaded.value;
  if (!l) return "Load a game’s files to see what its parts do to each other.";
  if (!l.program)
    return l.list.id === "tim2"
      ? "The lab reads behaviour from the programs of TIM 1 and Even More only, so far."
      : (l.problem ?? "The parts weren’t read from the program.");
  if (walks.value?.status === "error") return `The walks couldn’t be read: ${walks.value.message}`;
  return undefined;
});

watchEffect(() => {
  const s = selection.value;
  crumb.value = [
    "Who affects whom",
    s === undefined ? undefined : "part" in s ? nameOf(s.part) : `${nameOf(s.source)} → ${nameOf(s.target)}`,
  ].filter((c): c is string => !!c);
});
onBeforeUnmount(() => (crumb.value = []));
</script>

<template>
  <PageHeader title="Who affects whom">
    <template #subtitle>
      <template v-if="walks?.status === 'done'">
        <span class="font-mono text-ink">{{ pairs.length }}</span> pairs of
        <span class="font-mono text-ink">{{ columns.length }}</span> parts
        <span v-if="readingPerType(walks)" class="text-faint"> · reading more…</span>
      </template>
    </template>
  </PageHeader>

  <LabEmpty v-if="nothing" icon="parts" title="Nothing to show" :text="nothing" />
  <LabEmpty
    v-else-if="walks?.status !== 'done'"
    icon="spinner"
    title="Reading what the parts do"
    text="The walks from every part’s triggers take a minute to read from the program."
  />

  <div v-else class="flex min-h-0 flex-1">
    <section class="flex min-w-0 flex-1 flex-col">
      <LabToolbar>
        <LabSearch v-model="query" label="Find a part" placeholder="Part…" class="w-44" />
        <div class="flex-1"></div>
        <LabSegmented v-model="how" label="How" :options="[...HOWS]" />
        <LabSegmented v-model="order" label="Order" :options="[...ORDERS]" />
      </LabToolbar>
      <!-- What a part does, as switches that also tell how many pairs do it. -->
      <div class="flex shrink-0 flex-wrap gap-1.5 border-b border-line px-3 py-2">
        <div class="contents" role="group" aria-label="What a part does">
          <button
            v-for="k in AFFECT_KINDS.filter((k) => kindCounts.get(k))"
            :key="k"
            type="button"
            class="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pr-2.5 pl-2 text-meta text-soft hover:border-line-strong"
            :class="!kinds.has(k) && 'opacity-45'"
            :aria-pressed="kinds.has(k)"
            @click="toggleKind(k)"
          >
            <span class="size-2.5 rounded-[2px]" :style="{ background: COLOURS[k] }"></span>{{ AFFECT_LABELS[k] }}
            <span class="font-mono text-2xs text-faint">{{ kindCounts.get(k) }}</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="border-separate border-spacing-0 text-meta">
          <thead>
            <tr>
              <th
                class="sticky top-0 left-0 z-30 h-48 min-w-44 border-b border-line bg-sunken px-3 pb-2 text-left align-bottom text-2xs font-normal text-faint"
              >
                ↓ happens to · does it →
              </th>
              <th
                v-for="c in columns"
                :key="c"
                class="sticky top-0 z-20 w-[15px] min-w-[15px] border-b border-line bg-sunken p-0 align-bottom"
              >
                <button
                  type="button"
                  class="w-[15px] rotate-180 cursor-pointer py-1 text-left whitespace-nowrap [writing-mode:vertical-rl] hover:text-ink"
                  :class="c === columnLit ? 'text-accent' : 'text-muted'"
                  :title="nameOf(c)"
                  @click="selection = { part: c }"
                >
                  <span class="font-mono text-dim">{{ c }}</span> {{ nameOf(c) }}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r" :class="r === rowLit && 'bg-hover'">
              <th
                class="sticky left-0 z-10 h-[15px] bg-sunken p-0 text-left font-normal"
                :class="r === rowLit && 'bg-hover!'"
              >
                <button
                  type="button"
                  class="w-full cursor-pointer px-3 text-left whitespace-nowrap hover:text-ink"
                  :class="r === rowLit ? 'text-accent' : 'text-muted'"
                  @click="selection = { part: r }"
                >
                  <span class="inline-block w-5 text-right font-mono text-dim">{{ r }}</span> {{ nameOf(r) }}
                </button>
              </th>
              <td
                v-for="c in columns"
                :key="c"
                class="h-[15px] w-[15px] border-r border-b border-line-soft p-0"
                :class="[c === columnLit && 'bg-hover', c === r && 'bg-well']"
              >
                <button
                  v-if="byKey.get(`${c}:${r}`)"
                  type="button"
                  class="relative block size-full cursor-pointer"
                  :class="
                    selectedPair?.source === c &&
                    selectedPair?.target === r &&
                    'outline-2 -outline-offset-1 outline-ink'
                  "
                  :title="`${nameOf(c)} → ${nameOf(r)}: ${kindWords(byKey.get(`${c}:${r}`)!).toLowerCase()}, ${howWords(byKey.get(`${c}:${r}`)!)}`"
                  :aria-label="`${nameOf(c)} affects ${nameOf(r)}`"
                  @click="selection = { source: c, target: r }"
                >
                  <i
                    class="absolute inset-[2px] rounded-[2px]"
                    :style="{
                      '--c': COLOURS[firstKind(byKey.get(`${c}:${r}`)!)],
                      background:
                        byKey.get(`${c}:${r}`)!.how === 'touch'
                          ? 'transparent'
                          : byKey.get(`${c}:${r}`)!.how === 'both'
                            ? 'linear-gradient(135deg, var(--c) 50%, transparent 50%)'
                            : 'var(--c)',
                      boxShadow: 'inset 0 0 0 1.5px var(--c)',
                    }"
                  ></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="max-w-[70ch] px-3 py-3 text-meta text-faint">
          A filled square: the part of the column reaches the part of the row. Outlined: when the two touch. Half: both.
        </p>
      </div>
    </section>

    <LabSidePanel width="400px" aria-label="Part or pair">
      <template v-if="selectedType !== undefined">
        <LabPanelHeader title="Part" :meta="`#${selectedType}`" />
        <LabOpenIn :targets="[]">
          <LabButton @click="openInParts(selectedType)"><LabIcon name="parts" />Open in Parts</LabButton>
        </LabOpenIn>
        <div class="min-h-0 flex-1 overflow-auto pb-2">
          <p class="px-3 pt-2 text-title font-semibold">{{ nameOf(selectedType) }}</p>
          <AffectsLists
            :type="selectedType"
            :pairs="shown"
            :name-of="nameOf"
            @pick="selection = { source: $event.source, target: $event.target }"
          />
        </div>
      </template>
      <template v-else-if="selectedPair">
        <LabPanelHeader title="Pair" :meta="plural(selectedPair.effects.length + selectedPair.made.length, 'way')" />
        <LabOpenIn :targets="[]">
          <LabButton :title="`Open ${nameOf(selectedPair.source)} in Parts`" @click="openInParts(selectedPair.source)"
            ><LabIcon name="parts" />{{ nameOf(selectedPair.source) }}</LabButton
          >
          <LabButton :title="`Open ${nameOf(selectedPair.target)} in Parts`" @click="openInParts(selectedPair.target)"
            ><LabIcon name="parts" />{{ nameOf(selectedPair.target) }}</LabButton
          >
        </LabOpenIn>
        <div class="min-h-0 flex-1 overflow-auto pb-2">
          <p class="px-3 pt-2 text-title font-semibold">
            <button
              type="button"
              class="cursor-pointer hover:text-accent"
              @click="selection = { part: selectedPair.source }"
            >
              {{ nameOf(selectedPair.source) }}
            </button>
            <span class="text-faint"> → </span>
            <button
              type="button"
              class="cursor-pointer hover:text-accent"
              @click="selection = { part: selectedPair.target }"
            >
              {{ nameOf(selectedPair.target) }}
            </button>
          </p>
          <LabListHeading
            v-if="selectedPair.effects.length"
            title="What it does"
            :meta="String(selectedPair.effects.length)"
          />
          <BehaviourEffect
            v-for="(e, k) in selectedPair.effects"
            :key="k"
            :effect="e"
            :name="nameOf(selectedPair.source)"
          />
          <LabListHeading v-if="selectedPair.made.length" title="Makes it" :meta="String(selectedPair.made.length)" />
          <BehaviourRow
            v-for="(d, k) in selectedPair.made"
            :key="`made${k}`"
            :confidence="d.confidence"
            :tip="d.description"
          >
            <span class="min-w-0 flex-1 truncate text-soft">{{ d.description }}</span>
          </BehaviourRow>
        </div>
      </template>
    </LabSidePanel>
  </div>
</template>
