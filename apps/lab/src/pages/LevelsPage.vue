<script setup lang="ts">
import type { Frame as Bitmap } from "@opentim/resources";
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from "vue";
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
import { TIM2_COLOURS, tim2ColourProblem, tim2Colours } from "../components/tim2-colours.ts";
import LevelCanvas from "../components/levels/LevelCanvas.vue";
import LevelGoal from "../components/levels/LevelGoal.vue";
import LevelStructure from "../components/levels/LevelStructure.vue";
import { AUTO, usePalettes } from "../components/sprites/palettes.ts";
import type { Confidence } from "../kinds.ts";
import { edition, program, resources, selected as selectedFile } from "../library.ts";
import {
  LAYOUT_NAMES,
  MARGIN,
  PLAY_AREA,
  goalPartsOf,
  layoutOf,
  layoutScene,
  readLevels,
  type LevelEntry,
  type Note,
  type ToonsCode,
  type ToonsSort,
} from "../levels.ts";
import { MESSAGE_FONT } from "../toons-drawing.ts";
import { readFont } from "@opentim/resources";
import {
  LOADED_HEADERS,
  readTim2Types,
  readTim2StartTables,
  type Tim2StartTables,
  readToonsDrawing,
  readToonsGoals,
  readToonsBinKinds,
  readToonsListKinds,
  summariseTim2Goal,
  toonsGoalParts,
  tim2Drawing as drawingOf,
  type GoalCondition,
  type ToonsGoalParts,
  type SpriteOf,
  type Tim2Drawing,
} from "@opentim/content";
import { goalMarkSetters, readBehaviourInBackground, type GoalsResult, type WriterField } from "../behaviour.ts";
import { listIdOf, partName, readLoadedParts, sheetFile } from "../parts.ts";
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
/** The zoom: fitted to the space, or a fixed one. Before the space is measured, the fit is 1. */
const zoom = computed(() => {
  if (zoomSetting.value !== "fit") return Number(zoomSetting.value);
  const area = scene.value?.area ?? PLAY_AREA;
  const fit = Math.min(
    (room.value.width - PADDING) / (area.width + 2 * MARGIN),
    (room.value.height - PADDING) / (area.height + 2 * MARGIN),
  );
  return fit > 0 ? fit : 1;
});
const showBounds = ref(true);
/** For TIM 2 and Toons: the puzzle with the parts of the bin where the file puts them, which is the solution. */
const showSolution = ref(false);
const showGoal = ref(true);
const selectedPart = ref<number>();

const entries = computed(() => readLevels(resources.value, layoutOf(edition.value)));
const levelCount = computed(() => entries.value.filter((e) => e.kind === "level").length);
const sceneCount = computed(() => entries.value.filter((e) => e.kind === "scene").length);
const unreadable = computed(() => entries.value.filter((e) => e.error).length);

const matches = (e: LevelEntry) => {
  const q = query.value.trim().toLowerCase();
  return !q || e.resource.name.toLowerCase().includes(q) || (e.level?.title ?? "").toLowerCase().includes(q);
};
/** The levels and the scenes that match the filter, with how many there are in all. */
const sections = computed(() =>
  (
    [
      { label: "Levels", kind: "level" },
      { label: "Scenes", kind: "scene" },
    ] as const
  ).map(({ label, kind }) => {
    const all = entries.value.filter((e) => e.kind === kind);
    return { label, total: all.length, items: all.filter(matches) };
  }),
);

const current = computed(
  () => entries.value.find((e) => e.resource.name === selectedLevel.value) ?? entries.value.find((e) => e.level),
);
const level = computed(() => current.value?.level);

/** Where the loaded program's loader puts the header's numbers, for a build the loader was checked on. */
const loadedHeader = computed(() => (program.value ? LOADED_HEADERS.get(program.value.sha256) : undefined));

const loadedParts = computed(
  () => program.value && readLoadedParts(listIdOf(edition.value), resources.value, program.value),
);
const list = computed(() => loadedParts.value?.list);

/** Every puzzle's goal, read from the program in the background after its behaviour, which names the goals. */
const goals = shallowRef<GoalsResult | { status: "reading" }>();
/** The parts that set each goal mark, by `type:bit`, once the walks say what parts do to each other. */
const markSetters = shallowRef<ReadonlyMap<string, string[]>>(new Map());
/** The part record's fields as the behaviour read names them, for the structure's tags. */
const recordFields = shallowRef<readonly WriterField[]>();
/** The least time one step of the run takes, from the timer ticks the run loop waits for. */
const stepMilliseconds = ref<number>();
watch(
  () => [program.value?.data, loadedParts.value?.program] as const,
  ([data, parts]) => {
    goals.value = undefined;
    markSetters.value = new Map();
    recordFields.value = undefined;
    stepMilliseconds.value = undefined;
    if (!data || !parts) return;
    goals.value = { status: "reading" };
    const reading = readBehaviourInBackground(data, parts);
    void reading.result.then((result) => {
      if (program.value?.data !== data || result.status !== "done") return;
      recordFields.value = result.summary.fields;
      stepMilliseconds.value = result.summary.timing.minimumMilliseconds;
    });
    void reading.goals.then((result) => {
      if (program.value?.data === data) goals.value = result;
    });
    void reading.walks.then((result) => {
      if (program.value?.data === data && result.status === "done") markSetters.value = goalMarkSetters(result.effects);
    });
    // The walks with the loops read per type replace the first ones, as on the Parts page, and can add who sets a mark.
    void reading.perType.then((result) => {
      if (program.value?.data === data && result.status === "done") markSetters.value = goalMarkSetters(result.effects);
    });
  },
  { immediate: true },
);

/** True while a Toons level is shown, whose goals, drawing and sort words come from TOONS.EXE. */
const isToons = computed(() => level.value?.layout === "toons");
/** Toons' goals, read from TOONS.EXE: one routine per puzzle, named by the level it is for. */
const toonsGoals = computed(() => {
  if (!isToons.value || !program.value) return undefined;
  const byType = new Map(list.value?.parts.map((p) => [p.type, p.id]));
  try {
    return byType.size ? readToonsGoals(program.value.data, byType) : readToonsGoals(program.value.data);
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e), goals: [] };
  }
});

/** How many parts of each type the level has, bin included, for a goal that finds the n-th part of a type. */
const typeCounts = computed(() => {
  const counts = new Map<number, number>();
  for (const part of level.value?.parts ?? []) counts.set(part.type, (counts.get(part.type) ?? 0) + 1);
  return counts;
});

/** The puzzle a level file is, by its name: `L12.LEV` is puzzle 12, whose goal routine TIM.EXE picks by that number. */
const puzzle = computed(() => {
  const match = /^L(\d+)\.LEV$/i.exec(current.value?.resource.name ?? "");
  return match ? Number(match[1]) : undefined;
});

/** The goal of the level shown, or why there is none. */
const goal = computed<InstanceType<typeof LevelGoal>["$props"]["goal"] | undefined>(() => {
  if (current.value?.kind !== "level") return undefined;
  if (level.value?.layout === "tim2") {
    const byType = new Map(list.value?.parts.map((p) => [p.type, partName(p, list.value?.id).name]));
    const read = summariseTim2Goal(level.value, (type) => byType.get(type) ?? `type ${type}`, tim2Start.value);
    return read
      ? { status: "done", goal: { puzzle: 0, ...read }, from: "level" }
      : { status: "none", why: "This level has no goal entries." };
  }
  if (level.value?.layout === "toons") {
    const read = toonsGoals.value;
    if (!read) return undefined;
    if (read.problem) return { status: "none", why: `The goals couldn’t be read: ${read.problem}` };
    const name = current.value?.resource.name.replace(/\.LEV$/i, "").toUpperCase();
    const found = read.goals.find((g) => g.name === name);
    return found ? { status: "done", goal: found } : { status: "none", why: `TOONS.EXE has no goal for ${name}.` };
  }
  if (puzzle.value === undefined) return { status: "none", why: "Only puzzle files, named like L12.LEV, have a goal." };
  const g = goals.value;
  if (!g) return { status: "none", why: "The goals are read from TIM 1 and Even More only, so far." };
  if (g.status === "reading") return g;
  if (g.status === "error") return { status: "none", why: `The goals couldn’t be read: ${g.message}` };
  const found = g.goals.find((p) => p.puzzle === puzzle.value);
  return found
    ? { status: "done", goal: found }
    : { status: "none", why: `TIM.EXE has no goal for puzzle ${puzzle.value}.` };
});

/** The conditions that test a place, numbered in order, with the box their parts must be in on the drawing. */
const goalAreas = computed(() => {
  const g = goal.value;
  const s = scene.value;
  if (g?.status !== "done" || !s) return [];
  const out: {
    condition: GoalCondition;
    number: number;
    box: { x: number; y: number; width: number; height: number };
  }[] = [];
  const edge = {
    left: s.area.x - MARGIN,
    top: s.area.y - MARGIN,
    right: s.area.x + s.area.width + MARGIN,
    bottom: s.area.y + s.area.height + MARGIN,
  };
  for (const c of g.goal.summary.ways.flat()) {
    if (!c.area) continue;
    // The goal tests a part's position, which is where its picture starts; the area is where the picture is when its
    // position is in range, from the part the condition is about or one of the same type in the level. Without one it
    // is the range of positions.
    const one = goalParts.value.get(c);
    const looked =
      c.part !== undefined || one !== undefined || c.types?.length ? goalPartsOf(c, s.parts, one) : s.parts;
    const like = looked.find((d) => d.box.width && d.box.height);
    const at = like
      ? {
          x: like.box.x - like.part.position.x,
          y: like.box.y - like.part.position.y,
          w: like.box.width,
          h: like.box.height,
        }
      : { x: 0, y: 0, w: 1, h: 1 };
    const left = Math.max(edge.left, (c.area.x.min ?? -Infinity) + at.x);
    const top = Math.max(edge.top, (c.area.y.min ?? -Infinity) + at.y);
    const right = Math.min(edge.right, (c.area.x.max ?? Infinity) + at.x + at.w);
    const bottom = Math.min(edge.bottom, (c.area.y.max ?? Infinity) + at.y + at.h);
    if (right <= left || bottom <= top) continue;
    out.push({
      condition: c,
      number: out.length + 1,
      box: { x: left, y: top, width: right - left, height: bottom - top },
    });
  }
  return out;
});
const areaNumbers = computed(() => new Map(goalAreas.value.map((a) => [a.condition, a.number])));
/**
 * The words of TOONS.EXE's type table a Toons level's parts lists and parts bin are sorted by, the second as TOONS.EXE
 * sets them when it starts.
 */
const toonsSort = computed((): ToonsSort | undefined =>
  isToons.value && program.value
    ? { kinds: readToonsListKinds(program.value.data), binKinds: readToonsBinKinds(program.value.data) }
    : undefined,
);
/**
 * For a Toons goal, the level parts each condition is about when the puzzle starts, in the order TOONS.EXE keeps its
 * lists, with the parts on the board where the file puts them and the ropes the puzzle start leaves tied: the n-th part
 * of a type, the first one whose ropes pass a test, and whether a test of only the ropes and the type holds then.
 */
const toonsParts = computed(() => {
  const out = new Map<GoalCondition, ToonsGoalParts>();
  const g = goal.value;
  const l = level.value;
  const sort = toonsSort.value;
  if (g?.status !== "done" || l?.layout !== "toons" || !sort) return out;
  for (const c of g.goal.summary.ways.flat()) {
    const found = toonsGoalParts(l, c, sort.kinds, sort.binKinds);
    if (found) out.set(c, found);
  }
  return out;
});
/** The one level part a condition is about, to number it in the condition. */
const goalParts = computed(
  () =>
    new Map(
      [...toonsParts.value]
        .filter(([c, found]) => found.parts.length === 1 && c.kind !== "every")
        .map(([c, found]) => [c, found.parts[0]!]),
    ),
);
/**
 * The parts the goal's conditions look at, by their index in the level, ringed on the drawing: for a Toons goal the
 * parts TOONS.EXE's lists give when the puzzle starts (none for a condition that can't hold then), otherwise the part a
 * condition names or every part of its types.
 */
const ringedParts = computed(() => {
  const g = goal.value;
  const s = scene.value;
  if (g?.status !== "done" || !s) return new Set<number>();
  return new Set(
    g.goal.summary.ways.flat().flatMap((c) => {
      const found = toonsParts.value.get(c);
      if (found) return found.holds === false ? [] : found.parts;
      return goalPartsOf(c, s.parts).map((d) => d.part.index);
    }),
  );
});

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

/** True while a TIM 2 level is shown, which TIM2.EXE's type table says how to draw. */
const isTim2 = computed(() => level.value?.layout === "tim2");
/**
 * How TIM2.EXE draws each type: walls and tile patterns have routines of their own. Undefined when its type table
 * isn't found, which the scene notes.
 */
const tim2Drawing = computed((): Map<number, Tim2Drawing> | undefined => {
  if (!isTim2.value || !program.value) return undefined;
  try {
    return drawingOf(readTim2Types(program.value.data));
  } catch {
    return undefined;
  }
});
/**
 * TIM2.EXE's list and bin tables, which decide the order of a TIM 2 puzzle's bin and what its start does, or why they
 * can't be read, which the scene notes. A damaged program file shouldn't stop the level from being shown.
 */
const tim2StartRead = computed((): { tables?: Tim2StartTables; problem?: string } => {
  if (!isTim2.value || !program.value) return {};
  try {
    const tables = readTim2StartTables(program.value.data);
    return tables ? { tables } : {};
  } catch (e) {
    return { problem: `TIM2.EXE can’t be read: ${e instanceof Error ? e.message : String(e)}` };
  }
});
const tim2Start = computed(() => tim2StartRead.value.tables);
/** TOONS.EXE's drawing code for the types that have their own, and the font the message machine writes its letter in. */
const toonsCode = computed((): ToonsCode | undefined => {
  if (!isToons.value || !program.value) return undefined;
  try {
    const drawing = readToonsDrawing(program.value.data);
    if (!drawing) return undefined;
    const fontFile = resources.value.find((r) => r.name === MESSAGE_FONT);
    try {
      return fontFile ? { drawing, font: readFont(fontFile.data) } : { drawing };
    } catch {
      return { drawing };
    }
  } catch {
    return undefined;
  }
});
const scene = computed(() =>
  level.value
    ? layoutScene(level.value, list.value, spriteOf.value, tim2Drawing.value, {
        solution: showSolution.value,
        toons: toonsCode.value,
        toonsSort: toonsSort.value,
        tim2Start: tim2Start.value,
        tim2StartProblem: tim2StartRead.value.problem,
      })
    : undefined,
);

/** The scene's notes, and why a TIM 2 level isn't drawn in its 16 colours when the setting asks for them. */
const notes = computed((): Note[] => [
  ...(scene.value?.notes ?? []),
  ...(isTim2.value && tim2ColourProblem.value
    ? [{ status: "error" as const, title: "Not in 16 colours.", detail: tim2ColourProblem.value }]
    : []),
]);

const stats = computed(() => {
  const s = scene.value;
  if (!s) return [];
  const count = (how: string[]) => s.parts.filter((p) => how.includes(p.how)).length;
  return [
    { label: "Layout", value: LAYOUT_NAMES[level.value!.layout] },
    { label: "Version", value: `0x${level.value!.version.toString(16)}` },
    {
      label: "Play area",
      value: `${s.area.width} × ${s.area.height}${s.area.x || s.area.y ? ` from ${s.area.x}, ${s.area.y}` : ""}`,
    },
    { label: "Put together from frames", value: String(count(["frame"])) },
    { label: "One sprite by state", value: String(count(["sprite"])) },
    { label: "Tiled", value: String(count(["tiles"])) },
    ...(count(["code"]) ? [{ label: "By their own code", value: String(count(["code"])) }] : []),
    ...(count(["block"]) ? [{ label: "Colour blocks", value: String(count(["block"])) }] : []),
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
            <LabListHeading
              v-if="section.items.length"
              :title="section.label"
              :meta="`${section.items.length} of ${section.total}`"
            />
            <LabListRow
              v-for="e in section.items"
              :key="e.resource.name"
              :name="e.resource.name"
              name-width="76px"
              :text="e.error ? 'can’t be read' : e.level?.title || (e.kind === 'scene' ? 'scene' : 'untitled')"
              :status="e.error ? 'error' : 'decoded'"
              :status-title="e.error"
              :selected="e.resource.name === current?.resource.name"
              :title="e.level?.goal"
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
          <LabCheckbox v-if="level?.layout !== 'tim'" v-model="showSolution">Solution</LabCheckbox>
          <LabCheckbox v-if="goal?.status === 'done'" v-model="showGoal">Goal</LabCheckbox>
          <LabSegmented v-if="isTim2" v-model="tim2Colours" label="Colours" :options="TIM2_COLOURS" />
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
                :area-colour="background === 'game' ? level.tim2?.background : undefined"
                :zoom="zoom"
                :bounds="showBounds"
                :selected="selectedPart"
                :goal-areas="showGoal ? goalAreas : undefined"
                :goal-parts="showGoal ? ringedParts : undefined"
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
          <div v-if="goal" class="relative min-w-0 flex-[3] border-r border-line">
            <LevelGoal
              :goal="goal"
              :says="level?.goal"
              :area-numbers="areaNumbers"
              :mark-setters="markSetters"
              :step-milliseconds="stepMilliseconds"
              :type-counts="typeCounts"
              :part-numbers="goalParts"
              :at-start="toonsParts"
            />
          </div>
          <div class="relative min-w-0 flex-[2]">
            <div class="absolute inset-0 flex flex-col">
              <LabPanelHeader title="Limits and guesses" :meta="notes.length" />
              <div class="min-h-0 flex-1 overflow-auto">
                <LabListRow v-for="n in notes" :key="n.title" inset>
                  <p class="min-w-0 flex-1 text-soft">
                    <span class="font-semibold text-ink">{{ n.title }}</span> {{ n.detail }}
                  </p>
                  <template #end>
                    <LabBadge :status="n.status" :label="n.status === 'unsupported' ? 'not done' : n.status" />
                  </template>
                </LabListRow>
                <p v-if="!notes.length" class="px-3 py-[5px] text-muted">
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
        :header="loadedHeader"
        :record="recordFields"
        :toons-sort="toonsSort"
        :tim2-start="tim2Start"
        @select="selectedPart = $event"
        @view-bytes="viewBytes"
      />
    </div>
  </div>

  <LabEmpty
    v-else
    icon="levels"
    title="No levels in these files"
    text="The loaded files have no levels (.LEV) or scenes (.GKC)."
  />
</template>
