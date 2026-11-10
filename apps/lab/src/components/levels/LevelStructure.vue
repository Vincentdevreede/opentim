<script setup lang="ts">
import {
  GEAR_TYPE,
  LOADED_FIELDS,
  type Level,
  type LevelPart,
  type LoadedHeader,
  type LoadedKey,
  type LoadedPlace,
  type PartGroup,
  type PartList,
} from "@opentim/content";
import { computed, nextTick, ref, watch } from "vue";
import { flagWords, recordName, type WriterField } from "../../behaviour.ts";
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

/**
 * Everything read from a level file, field by field, with where each part's bytes are and, for TIM 1 and Even More,
 * where the game's loader keeps each field: the part record's word by the name the analysis gives it, or a word of the
 * data segment for the header. The offsets and addresses are in the tips.
 */
const props = defineProps<{
  level: Level;
  name: string;
  list?: PartList;
  selected?: number;
  /** The header's words in the loaded program, when it is a build the loader was checked on. */
  header?: LoadedHeader;
  /** The part record's fields as the behaviour read of the loaded program names them, once it is read. */
  record?: readonly WriterField[];
}>();
const emit = defineEmits<{ select: [index: number]; viewBytes: [offset: number] }>();

const GROUPS: { group: PartGroup; label: string; hint: string }[] = [
  {
    group: "static",
    label: "Static",
    hint: "Walls, ramps and fixed machines. The loader puts them on the fixed list.",
  },
  { group: "moving", label: "Moving", hint: "Parts like balls. The loader puts them on the moving list." },
  {
    group: "bin",
    label: "Parts bin",
    hint: "Parts the player can place, not on the board. The loader puts them on the third list, in this order.",
  },
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
  binFlag: {
    status: "decoded",
    label: "bin switch",
    title:
      "The level reader reads the parts bin only when this isn’t 0 or when it loads a puzzle, so a puzzle always gets its bin. 0 in every shipped puzzle.",
  },
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
      globalThis.document?.querySelector(`[data-structure-part="${index}"]`)?.scrollIntoView({ block: "nearest" }),
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

/** Where the loader puts a header field in the data segment of the loaded build, when it was checked there. */
function headerTag(key: string) {
  const h = props.header;
  const at = h?.words[key];
  if (!h || at === undefined || props.level.layout !== "tim") return undefined;
  const guess = h.byOrder.includes(key);
  return {
    tag: guess ? "kept?" : "kept",
    guess,
    title: guess
      ? `Where the order of the header's words puts it in ${h.build}. The play screen sets this word to -8 itself after loading, so the check can’t tell.`
      : `The loader keeps it in the word ${hex(at, 4)} of the data segment, in ${h.build}.`,
  };
}

const shown = (value: string | number) => (typeof value === "string" ? `“${value}”` : String(value));
const word = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
const index = (i: number | null | undefined) => (i === null || i === undefined ? "none" : `#${i}`);
const pair = (p: { x: number; y: number }) => `${p.x}, ${p.y}`;

/** The record's flag words the file's three flag words go to, in their order. */
const FLAG_WORDS = [0x06, 0x08, 0x0a];

/** A part's flags in words, from the bits whose meaning is known, with how many other bits are set. */
function flagsShown(p: LevelPart): { value: string; note?: string } {
  const read = p.flags.map((f, k) => flagWords(FLAG_WORDS[k]!, f, props.record));
  const words = read.flatMap((r) => r.words);
  const unknown = read.reduce((n, r) => n + r.unknown.toString(2).replace(/0/g, "").length, 0);
  return {
    value: words.join(" · ") || (unknown ? "" : "none"),
    ...(unknown ? { note: `${unknown} ${unknown === 1 ? "bit" : "bits"} not known` } : {}),
  };
}

/** Names that differ only at their end as one: savedPositionX and savedPositionY as "savedPositionX/Y". */
function joinNames(names: string[]) {
  if (names.length < 2) return names.join("");
  let common = 0;
  while (names.every((n) => n[common] !== undefined && n[common] === names[0]![common])) common++;
  return common >= 3 ? `${names[0]!.slice(0, common)}${names.map((n) => n.slice(common)).join("/")}` : names.join(", ");
}

interface Row {
  key: string;
  value: string;
  /** The value as stored, when the row says it in words. */
  raw?: string;
  note?: string;
  link?: number;
  /** Where the loader keeps the field, as a short tag and what it means. */
  loaded?: { tag: string; title: string; faint?: boolean };
}

const words = (at: number[]) => at.map((a) => hex(a, 2)).join(" ");

/**
 * The tag for where the loader keeps a field: the record's words by their names, the record they point to, or that it
 * isn't kept. A word without a name reads "kept"; its offset is in the tip.
 */
function loadedTag(place: LoadedPlace): Row["loaded"] {
  const what = [
    place.names?.length ? place.names.join(", ") : "",
    place.also?.length ? `also ${words(place.also)}` : "",
    place.note ?? "",
  ]
    .filter(Boolean)
    .join("; ");
  if (place.notKept) return { tag: "not kept", title: `The loader doesn’t keep it: ${what}.`, faint: true };
  const named = place.at.map((a, k) => recordName(a, props.record) ?? place.names?.[k]);
  const through = place.through && recordName(place.through.word, props.record);
  const tag = place.through
    ? through
      ? `→ ${through} record`
      : "kept"
    : named.every((n) => n !== undefined)
      ? `→ ${joinNames(named as string[])}`
      : "kept";
  const where = place.through
    ? `In the record the word ${hex(place.through.word, 2)} points to, at ${place.through.at.map((k) => `+${k}`).join(" and ")}`
    : `In the part record at ${words(place.at)}${place.bytes ? " (bytes)" : ""}`;
  return { tag, title: what ? `${where}: ${what}.` : `${where}.` };
}

/** The fields of a part, as rows of name, value and, when the meaning isn't clear, a note. */
function rows(p: LevelPart): Row[] {
  // Only TIM 1 and Even More levels were loaded with the game's loader.
  const at = (key: LoadedKey) => (props.level.layout === "tim" ? loadedTag(LOADED_FIELDS[key]) : undefined);
  const out: Row[] = [
    { key: "type", value: `${p.type} · ${nameOf(p)}`, loaded: at("type") },
    { key: "flags", ...flagsShown(p), raw: p.flags.map(word).join(" "), loaded: at("flags") },
    { key: "state", value: p.state.join(", "), loaded: at("state") },
    { key: "position", value: pair(p.position), loaded: at("position") },
    { key: "size", value: `${p.size.width} × ${p.size.height}`, loaded: at("size") },
    { key: "base size", value: `${p.baseSize.width} × ${p.baseSize.height}`, loaded: at("baseSize") },
    { key: "extra", value: String(p.extra), note: "depends on the part", loaded: at("extra") },
  ];
  if (p.belt.parts || p.belt.width || p.belt.at.x || p.belt.at.y)
    out.push(
      p.belt.parts
        ? { key: "belt", value: `runs around ${p.belt.parts.map(index).join(" and ")}`, loaded: at("beltParts") }
        : { key: "belt", value: `hub at ${pair(p.belt.at)}, ${p.belt.width} wide`, loaded: at("beltPlace") },
    );
  p.ropes.forEach((slot, i) => {
    if (slot.rope)
      out.push({
        key: `rope ${i}`,
        value: `ties ${slot.rope.parts.map(index).join(" and ")}, slots ${slot.rope.slots.join(" and ")}`,
        loaded: i === 0 ? at("rope") : undefined,
      });
    else if (slot.at.x || slot.at.y)
      out.push({ key: `rope slot ${i}`, value: pair(slot.at), loaded: at(i === 0 ? "ropeSlot.0" : "ropeSlot.1") });
  });
  if (p.links.some((l) => l !== null)) {
    // A gear's links to gears aren't kept: the loader leaves those words 0.
    const linked = p.links.filter((l) => l !== null);
    const gears = linked.filter((l) => p.type === GEAR_TYPE && props.level.parts[l]?.type === GEAR_TYPE);
    out.push({
      key: "links",
      value: p.links.map(index).join(", "),
      loaded:
        props.level.layout !== "tim"
          ? undefined
          : gears.length === linked.length
            ? {
                tag: "not kept",
                title: "A gear’s link to a gear stays 0: a gear finds its neighbours by their places.",
                faint: true,
              }
            : at("links"),
    });
  }
  if (p.plugs?.some((l) => l !== null))
    out.push({ key: "plugs", value: p.plugs.map(index).join(", "), loaded: at("plugs") });
  if (p.pulley !== undefined) out.push({ key: "pulley", value: index(p.pulley), loaded: at("pulley") });
  if (p.tunnel !== undefined) out.push({ key: "tunnel", value: index(p.tunnel) });
  if (p.toons)
    out.push({
      key: "toons",
      value: [p.toons.byte !== undefined ? `byte ${p.toons.byte}` : "", `word ${p.toons.word}`]
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
          <template v-if="MEANING[f.key] || headerTag(f.key)" #note>
            <LabBadge
              v-if="MEANING[f.key]"
              :status="MEANING[f.key]!.status"
              :label="MEANING[f.key]!.label"
              :title="MEANING[f.key]!.title"
            />
            <span
              v-if="headerTag(f.key)"
              class="shrink-0 font-sans text-2xs italic"
              :class="headerTag(f.key)!.guess ? 'text-hypothesis' : 'text-faint'"
              :title="headerTag(f.key)!.title"
              >{{ headerTag(f.key)!.tag }}</span
            >
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
            <LabFacts label-width="84px" class="pr-3">
              <LabFact v-for="r in rows(p)" :key="r.key" :label="r.key">
                <button
                  v-if="r.link !== undefined"
                  type="button"
                  class="cursor-pointer text-accent hover:underline"
                  @click="emit('viewBytes', r.link)"
                >
                  {{ r.value }}
                </button>
                <span v-else :title="r.raw">{{ r.value }}</span>
                <!-- The note and where the loader keeps the field go under the value, so the value keeps its width. -->
                <span v-if="r.note" class="block font-sans text-2xs text-hypothesis">{{ r.note }}</span>
                <span
                  v-if="r.loaded"
                  class="block text-2xs text-faint"
                  :class="r.loaded.faint && 'font-sans italic'"
                  :title="r.loaded.title"
                  >{{ r.loaded.tag }}</span
                >
              </LabFact>
            </LabFacts>
          </div>
        </div>
      </template>
    </div>
  </LabSidePanel>
</template>
