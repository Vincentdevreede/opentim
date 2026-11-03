<script setup lang="ts">
import type { Level, LevelPart, PartGroup, PartList } from "@opentim/content";
import { computed, nextTick, ref, watch } from "vue";
import { partName } from "../../parts.ts";
import { hex } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabFact from "../LabFact.vue";
import LabFacts from "../LabFacts.vue";
import LabListHeading from "../LabListHeading.vue";
import LabListRow from "../LabListRow.vue";
import LabIcon from "../LabIcon.vue";
import LabPanelHeader from "../LabPanelHeader.vue";
import LabSidePanel from "../LabSidePanel.vue";
import LabOpenIn from "../LabOpenIn.vue";

/** Everything read from a level file, field by field, with where each part's bytes are. */
const props = defineProps<{ level: Level; name: string; list?: PartList; selected?: number }>();
const emit = defineEmits<{ select: [index: number]; viewBytes: [offset: number] }>();

const GROUPS: { group: PartGroup; label: string; hint: string }[] = [
  { group: "static", label: "Static", hint: "Parts the file lists first. Walls, ramps and fixed machines." },
  { group: "moving", label: "Moving", hint: "Parts the file lists second, like balls." },
  { group: "bin", label: "Parts bin", hint: "Parts the player can place. They aren’t on the board." },
];

/** What each header field means, and how sure that is. TIM.EXE is the program of TIM 1. */
const MEANING: Record<string, { status: "decoded" | "hypothesis" | "unsupported"; label: string; title: string }> = {
  "bonus.0": {
    status: "decoded",
    label: "bonus",
    title:
      "The first bonus counter. TIM.EXE shows it on the panel, counts it down while the machine runs and adds it to the total bonus.",
  },
  "bonus.1": {
    status: "decoded",
    label: "bonus",
    title: "The second bonus counter, counted down and added in the same way.",
  },
  "scroll.x": {
    status: "decoded",
    label: "scroll",
    title:
      "How far the view scrolls right. TIM.EXE starts the view at -8 and scrolls up to this; -8 means no scrolling.",
  },
  "scroll.y": {
    status: "decoded",
    label: "scroll",
    title: "How far the view scrolls down, in the same way.",
  },
  binFlag: { status: "unsupported", label: "unknown", title: "What this number means isn’t known." },
  music: {
    status: "hypothesis",
    label: "song",
    title: "The number of the music. Which song each number is isn’t known yet.",
  },
};

const open = ref(new Set<number>());
const byType = computed(() => new Map(props.list?.parts.map((p) => [p.type, p])));
const nameOf = (p: LevelPart) => {
  const listPart = byType.value.get(p.type);
  return listPart ? partName(listPart).name : `Type ${p.type}`;
};

watch(
  () => props.selected,
  (index) => {
    if (index === undefined) return;
    open.value = new Set([...open.value, index]);
    void nextTick(() =>
      document.querySelector(`[data-structure-part="${index}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  },
  { immediate: true },
);
watch(
  () => props.name,
  () => (open.value = new Set(props.selected === undefined ? [] : [props.selected])),
);

function toggle(index: number) {
  const next = new Set(open.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  open.value = next;
}

const expandAll = () => (open.value = new Set(props.level.parts.map((p) => p.index)));
const collapseAll = () => (open.value = new Set());

const shown = (value: string | number) => (typeof value === "string" ? `“${value}”` : String(value));
const word = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
const index = (i: number | null | undefined) => (i === null || i === undefined ? "none" : `#${i}`);
const pair = (p: { x: number; y: number }) => `${p.x}, ${p.y}`;

/** The flag bits whose meaning TIM.EXE shows, set on this part. */
function flagNote(p: LevelPart) {
  const known = [
    (p.flags[0] ?? 0) & 0x40 ? "tiles" : "",
    (p.flags[1] ?? 0) & 0x10 ? "mirrored" : "",
    (p.flags[1] ?? 0) & 0x20 ? "upside down" : "",
  ].filter(Boolean);
  return known.length ? `${known.join(", ")}; other bits unknown` : "other bits unknown";
}

/** The fields of a part, as rows of name, value and, when the meaning isn't clear, a note. */
function rows(p: LevelPart): { key: string; value: string; note?: string; link?: number }[] {
  const out: { key: string; value: string; note?: string; link?: number }[] = [
    { key: "type", value: `${p.type} · ${nameOf(p)}` },
    { key: "flags", value: p.flags.map(word).join(" "), note: flagNote(p) },
    { key: "state", value: p.state.join(", ") },
    { key: "position", value: pair(p.position) },
    { key: "size", value: `${p.size.width} × ${p.size.height}` },
    { key: "size2", value: `${p.size2.width} × ${p.size2.height}`, note: "meaning unknown" },
    { key: "extra", value: String(p.extra), note: "depends on the part" },
  ];
  if (p.belt.parts || p.belt.width || p.belt.at.x || p.belt.at.y)
    out.push({
      key: "belt",
      value: p.belt.parts
        ? `runs around ${p.belt.parts.map(index).join(" and ")}`
        : `hub at ${pair(p.belt.at)}, ${p.belt.width} wide`,
    });
  p.ropes.forEach((slot, i) => {
    if (slot.rope)
      out.push({
        key: `rope ${i}`,
        value: `ties ${slot.rope.parts.map(index).join(" and ")}, slots ${slot.rope.slots.join(" and ")}`,
      });
    else if (slot.at.x || slot.at.y) out.push({ key: `rope slot ${i}`, value: pair(slot.at) });
  });
  if (p.links.some((l) => l !== null)) out.push({ key: "links", value: p.links.map(index).join(", ") });
  if (p.plugs?.some((l) => l !== null)) out.push({ key: "plugs", value: p.plugs.map(index).join(", ") });
  if (p.pulley !== undefined) out.push({ key: "pulley", value: index(p.pulley) });
  if (p.tunnel !== undefined) out.push({ key: "tunnel", value: index(p.tunnel) });
  if (p.toons)
    out.push({
      key: "toons",
      value: [p.toons.byte !== undefined ? `byte ${p.toons.byte}` : "", `word ${word(p.toons.word)}`]
        .filter(Boolean)
        .join(", "),
      note: "meaning unknown",
    });
  if (p.outline)
    out.push({ key: "outline", value: p.outline.map(pair).join(" · ") || "none", note: "TIM.EXE skips it" });
  out.push({ key: "bytes", value: `${hex(p.offset, 4)}, ${p.length} bytes`, link: p.offset });
  return out;
}
</script>

<template>
  <LabSidePanel aria-label="Structure">
    <LabPanelHeader title="Structure" :meta="name">
      <div class="-mr-1.5 flex">
        <LabButton variant="ghost" icon aria-label="Expand all" title="Expand all" @click="expandAll">
          <LabIcon name="expandAll" />
        </LabButton>
        <LabButton variant="ghost" icon aria-label="Collapse all" title="Collapse all" @click="collapseAll">
          <LabIcon name="collapseAll" />
        </LabButton>
      </div>
    </LabPanelHeader>
    <LabOpenIn
      :targets="['files']"
      @open="emit('viewBytes', selected === undefined ? 0 : (level.parts[selected]?.offset ?? 0))"
    />
    <div class="min-h-0 flex-1 overflow-auto pb-2 font-mono text-meta">
      <LabListHeading title="Header" class="font-sans" />
      <LabFacts class="px-3 py-1">
        <LabFact
          v-for="f in level.fields"
          :key="f.key"
          :label="f.key"
          :title="`At ${hex(f.offset, 4)}, ${f.size} bytes`"
        >
          {{ f.key === "magic" || f.key === "version" ? word(Number(f.value)) : shown(f.value) }}
          <template v-if="MEANING[f.key]" #note>
            <span class="shrink-0" :title="MEANING[f.key]!.title">
              <LabBadge :status="MEANING[f.key]!.status" :label="MEANING[f.key]!.label" />
            </span>
          </template>
        </LabFact>
      </LabFacts>

      <template v-for="g in GROUPS" :key="g.group">
        <LabListHeading
          :title="g.label"
          :meta="String(level.parts.filter((p) => p.group === g.group).length)"
          :hint="g.hint"
          class="font-sans"
        />
        <div v-for="p in level.parts.filter((p) => p.group === g.group)" :key="p.index" :data-structure-part="p.index">
          <LabListRow
            :name="`#${p.index}`"
            name-width="2rem"
            :text="nameOf(p)"
            :meta="pair(p.position)"
            :selected="p.index === selected"
            :expanded="open.has(p.index)"
            inset
            @click="
              toggle(p.index);
              emit('select', p.index);
            "
          />
          <div v-if="open.has(p.index)" class="mb-1 ml-[30px] border-l border-line pl-2">
            <LabFacts label-width="76px" class="pr-3">
              <LabFact v-for="r in rows(p)" :key="r.key" :label="r.key">
                <button
                  v-if="r.link !== undefined"
                  type="button"
                  class="cursor-pointer text-accent hover:underline"
                  @click="emit('viewBytes', r.link)"
                >
                  {{ r.value }}
                </button>
                <template v-else>{{ r.value }}</template>
                <template v-if="r.note" #note>
                  <span class="shrink-0 font-sans text-2xs text-hypothesis">{{ r.note }}</span>
                </template>
              </LabFact>
            </LabFacts>
          </div>
        </div>
      </template>
    </div>
  </LabSidePanel>
</template>
