<script setup lang="ts">
import { computed, reactive } from "vue";
import { readingPerType as stillReadingPerType, type BehaviourResult, type WalksResult } from "../../behaviour.ts";
import {
  outlineSides,
  routineGroups,
  stateGroups,
  walkGroups,
  type ChangeRow,
  type WriteRow,
} from "../../behaviour-view.ts";
import { behaviourLayout } from "../../ui.ts";
import LabAlert from "../LabAlert.vue";
import LabChip from "../LabChip.vue";
import LabDisclosure from "../LabDisclosure.vue";
import LabIcon from "../LabIcon.vue";
import LabInfo from "../LabInfo.vue";
import LabListRow from "../LabListRow.vue";
import LabSection from "../LabSection.vue";
import LabSegmented from "../LabSegmented.vue";
import PanelTitle from "../PanelTitle.vue";
import BehaviourChange from "./BehaviourChange.vue";
import BehaviourDoing from "./BehaviourDoing.vue";
import BehaviourEffect from "./BehaviourEffect.vue";
import BehaviourRest from "./BehaviourRest.vue";
import BehaviourRow from "./BehaviourRow.vue";
import BehaviourWalkGroup from "./BehaviourWalkGroup.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/** What the program does with a part, by routine, by the state a change starts from, or by the walk from a trigger. */
const props = defineProps<{
  /** The analysis of the loaded program; undefined while it hasn't started. */
  result?: BehaviourResult | { status: "reading" };
  /** The walks from the parts' triggers, which come after the rest. */
  walks?: WalksResult | { status: "reading" };
  /** Why there is no analysis, when there can't be one. */
  unavailable?: string;
  type: number;
  /** The ids of the part's frames, to link a state to the frame it shows. */
  frames: number[];
  /** The frame on the stage, to point out what can happen from it. */
  current?: number;
  /** The names of the parts, to say which share a routine. */
  names?: ReadonlyMap<number, string>;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const LAYOUTS = [
  { value: "routine" as const, label: "By routine" },
  { value: "state" as const, label: "By state" },
  { value: "walk" as const, label: "By walk" },
];
/** What a routine is likely for, from where the program calls it. */
const ROLES: Record<string, string> = {
  bounce: "Probably runs when another part hits this one.",
  run: "Probably runs for every part on each step of the machine.",
  reset: "Probably runs when the machine is put back to how it was placed.",
  resize: "Probably runs when the part is resized.",
  flip: "Probably runs when the part is flipped.",
  rope: "Probably runs for a rope tied to it.",
};

const summary = computed(() => (props.result?.status === "done" ? props.result.summary : undefined));
const part = computed(() => summary.value?.parts[props.type]);
const routines = computed(() => (part.value ? routineGroups(part.value) : []));
const states = computed(() => (part.value ? stateGroups(part.value) : []));
const walkList = computed(() => {
  const w = props.walks?.status === "done" ? props.walks.walks[props.type] : undefined;
  return w ? walkGroups(w) : [];
});
/** What other parts do to this one without changing its frame, which comes with the walks. */
const effects = computed(() => (props.walks?.status === "done" ? (props.walks.effects[props.type] ?? []) : []));
/** Whether the loops over found parts are still being read per type, which can add lines here. */
const readingPerType = computed(() => stillReadingPerType(props.walks));
/** Why the loops couldn’t be read per type, when that failed: the lines here may miss some. */
const perTypeError = computed(() => (props.walks?.status === "done" ? props.walks.perTypeError : undefined));
/** How the reset leaves its frame and where it comes to rest, which also comes with the walks. */
const rest = computed(() => (props.walks?.status === "done" ? props.walks.rests[props.type] : undefined));
/** What the part does: the parts it creates, then what it does to itself and to other parts. */
const doings = computed(() => (props.walks?.status === "done" ? (props.walks.doings[props.type] ?? []) : []));
const created = computed(() => doings.value.filter((d) => d.on === "created"));
const doneTo = computed(() =>
  (["itself", "others"] as const)
    .map((on) => ({
      on,
      title: on === "itself" ? "On itself" : "On other parts",
      list: doings.value.filter((d) => d.on === on),
    }))
    .filter((g) => g.list.length),
);
const doneCount = computed(() => doneTo.value.reduce((n, g) => n + g.list.length, 0));
const sides = computed(() => (part.value ? outlineSides(part.value) : undefined));
const draws = computed(() => routines.value.flatMap((g) => g.draws));
const gear = computed(() => part.value?.gear);
/** The gear's rules, each as a few words with the analysis's own words to open. */
const gearRows = computed(() => {
  const g = gear.value;
  if (!g) return [];
  const hex2 = (n: number) => `+0x${n.toString(16).padStart(2, "0")}`;
  return [
    {
      what: `${g.slots.length} neighbours`,
      then: `${g.slots[0]?.distance ?? 32} apart`,
      note: "+ its belt end",
      tip: [
        ...g.slots.map(
          (s) =>
            `${hex2(s.offset)} ${s.name}: the gear ${s.distance} ${s.side === "left" || s.side === "right" ? `to the ${s.side}` : s.side}`,
        ),
        `${hex2(g.peerField)} belt: the part at its other end`,
        "",
        "Reset links them by saved position. The last match wins.",
      ].join("\n"),
      detail: g.text.connections,
    },
    {
      what: "neighbour",
      then: "opposite turn",
      note: "jams if same",
      tip: "An idle neighbour gets −step.\nOne with a step keeps it, and jams when it equals this gear's step.",
      detail: g.text.conflict,
    },
    {
      what: "belt end",
      then: "same turn",
      note: "jams if different",
      tip: "An idle belt end gets the same step.\nOne with a step keeps it, and jams when it differs.",
      detail: g.text.conflict,
    },
    {
      what: "no jam",
      then: "state + step",
      note: "−1→3 · 4→0",
      tip: "This gear and every moving gear it reaches turn once.",
      detail: g.text.withoutConflict,
    },
    {
      what: "jam",
      then: "steps cleared",
      note: "frames kept",
      tip: "This gear and the moving gears it reaches lose their step before they turn.",
      detail: g.text.withConflict,
    },
    {
      what: "loop",
      then: "no jam",
      note: "grid alone",
      tip: "Neighbours one grid step apart alternate in two groups, so a loop has an even length.\nA belt or a second driver can still make it jam.",
      detail: g.text.cycles,
    },
  ];
});

/** The other parts that use each routine, by its address. */
const users = computed(() => {
  const map = new Map<number, number[]>();
  for (const [type, p] of Object.entries(summary.value?.parts ?? {}))
    for (const r of p.routines) map.set(r.address, [...(map.get(r.address) ?? []), Number(type)]);
  return map;
});
const nameOf = (type: number) => props.names?.get(type) ?? `type ${type}`;

const closed = reactive(new Set<string>());
const toggle = (key: string) => (closed.has(key) ? closed.delete(key) : closed.add(key));
/** Whether a routine has anything to open. */
const opens = (g: { changes: unknown[]; draws: unknown[]; sets: unknown[] }) =>
  g.changes.length > 0 || g.draws.length > 0 || g.sets.length > 0;

function routineTip(role: string, at?: string, address?: number) {
  const others = (address !== undefined ? (users.value.get(address) ?? []) : []).filter((t) => t !== props.type);
  const lines = [ROLES[role] ?? "A routine the part's routines call.", "", `Code at ${at ?? role}`];
  if (others.length)
    lines.push(
      `Also used by ${others.slice(0, 6).map(nameOf).join(", ")}${others.length > 6 ? ` and ${others.length - 6} more` : ""}`,
    );
  else lines.push("Only this part uses it.");
  lines.push("", "The name is a guess from where the program calls it.");
  return lines.join("\n");
}
const sharedCount = (address?: number) => (address !== undefined ? (users.value.get(address)?.length ?? 0) : 0);

const fromHere = (row: ChangeRow) =>
  props.current !== undefined && (row.from === null || row.from.includes(props.current));
const isPoints = (w: WriteRow) => w.target === "outline" && w.values.every((v) => v.startsWith("("));
/** A row's value: the points of an outline, one value, or how many. */
const writeText = (w: WriteRow) =>
  isPoints(w)
    ? `${w.values.length} points ${w.values.join(" ")}`
    : `= ${w.values.length > 1 ? `${w.values.length} values` : w.values[0]}`;
/**
 * What an opened write row adds: each value with its condition, unless the row already shows every value; then only
 * the condition they share, if there is one.
 */
const writeDetail = (w: WriteRow): string[] => {
  const conditions = [...new Set(w.writes.map((x) => x.condition))];
  if ((w.values.length === 1 || isPoints(w)) && conditions.length === 1)
    return conditions[0] === "always" ? [] : [`when ${conditions[0]}`];
  return w.writes.map((x) => `= ${x.value}${x.condition === "always" ? "" : ` when ${x.condition}`}`);
};
const writeTip = (w: WriteRow) =>
  isPoints(w)
    ? `${w.routine} sets the outline to ${w.values.length} points:\n${w.values.join(" ")}\n\nEdges run clockwise from the first point.`
    : [`${w.routine} writes ${w.target}`, ...w.values.slice(0, 8).map((v) => `= ${v}`)]
        .concat(w.values.length > 8 ? [`and ${w.values.length - 8} more`] : [])
        .concat("", `${w.writes.length} ${w.writes.length === 1 ? "path" : "paths"}, ${w.confidence}. Click for each.`)
        .join("\n");

/** How the analysis was made, for the end of the findings. */
const howRead = computed(
  () =>
    "read from the program’s instructions without running it" +
    (props.result?.status === "done" ? `, in ${props.result.seconds.toFixed(1)} s` : ""),
);
const timing = computed(() => {
  const t = summary.value?.timing;
  if (!t) return "";
  const parts = [];
  if (t.ticksPerSecond) parts.push(`timer ${t.ticksPerSecond.toFixed(1)} ticks/s (divisor ${t.divisor})`);
  if (t.minimumTicks) parts.push(`step ≥ ${t.minimumTicks} ticks, ${t.minimumMilliseconds!.toFixed(1)} ms`);
  return parts.join(", ");
});
const more = computed(() => {
  const p = part.value;
  return p
    ? p.triggers.length +
        p.counters.length +
        p.uncertainties.length +
        (p.gear?.text.limits.length ?? 0) +
        (timing.value ? 1 : 0) +
        1
    : 0;
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="unavailable" class="text-muted">{{ unavailable }}</p>
    <p v-else-if="!result || result.status === 'reading'" class="flex items-center gap-2 text-muted">
      <LabIcon name="spinner" :size="14" :stroke="2.25" class="animate-spin" />
      Reading the behaviour from the program. This takes a few seconds.
    </p>
    <LabAlert v-else-if="result.status === 'error'" title="Couldn’t read the behaviour">
      <span class="font-mono text-meta break-words">{{ result.message }}</span>
    </LabAlert>
    <p v-else-if="!part" class="text-muted">The program has no behaviour for this part.</p>

    <template v-else>
      <LabSegmented v-model="behaviourLayout" label="Layout" :options="LAYOUTS" full />

      <div v-if="behaviourLayout === 'routine'" class="-mx-3 flex flex-col">
        <section v-for="g in routines" :key="`${g.role} ${opens(g)}`" class="flex flex-col">
          <div class="relative">
            <LabListRow v-if="opens(g)" :expanded="!closed.has(g.role)" class="pr-9!" @click="toggle(g.role)">
              <span class="font-mono font-semibold" :class="g.empty ? 'text-faint' : 'text-ink'">{{ g.role }}</span>
              <template #end>
                <LabChip v-if="g.changes.length" tone="accent"
                  >{{ g.changes.length }} {{ g.changes.length === 1 ? "change" : "changes" }}</LabChip
                >
                <LabChip v-if="g.draws.length">draws</LabChip>
                <LabChip v-if="g.sets.length">sets</LabChip>
                <LabChip v-if="g.open" tone="error">open</LabChip>
                <LabChip v-if="sharedCount(g.address) > 1" tone="faint">shared ×{{ sharedCount(g.address) }}</LabChip>
              </template>
            </LabListRow>
            <LabListRow v-else class="pr-9! pl-[28px]!">
              <span class="font-mono font-semibold" :class="g.empty ? 'text-faint' : 'text-ink'">{{ g.role }}</span>
              <template #end>
                <LabChip v-if="g.open" tone="error">open</LabChip>
                <span class="text-meta whitespace-nowrap text-faint">{{ g.empty ? "does nothing" : "no change" }}</span>
                <LabChip v-if="sharedCount(g.address) > 1" tone="faint">shared ×{{ sharedCount(g.address) }}</LabChip>
              </template>
            </LabListRow>
            <span class="absolute top-1/2 right-3 flex -translate-y-1/2">
              <LabInfo :text="routineTip(g.role, g.at, g.address)" />
            </span>
          </div>
          <div
            v-if="opens(g) && !closed.has(g.role)"
            class="flex flex-col border-b border-line-soft pb-1.5 [&>*:first-child]:border-t-0"
          >
            <BehaviourChange
              v-for="row in g.changes"
              :key="row.key"
              :row="row"
              lead="from"
              :frames="frames"
              :sides="sides"
              :highlight="fromHere(row)"
              indent
              @show-frame="emit('showFrame', $event)"
            />
            <div
              v-if="g.changes.length && g.kept"
              class="flex h-7 items-center gap-2 border-t border-line-soft pr-3 pl-[30px] text-meta text-faint"
            >
              <ConfidenceMark confidence="inferred" focusable />
              otherwise no change · {{ g.kept }} {{ g.kept === 1 ? "path" : "paths" }}
            </div>
            <template
              v-for="[title, list] in [
                ['Draws', g.draws],
                ['Sets', g.sets],
              ] as const"
              :key="title"
            >
              <PanelTitle v-if="list.length" class="block pt-2 pr-3 pb-1 pl-[30px]">{{ title }}</PanelTitle>
              <BehaviourRow v-for="w in list" :key="w.key" :confidence="w.confidence" :tip="writeTip(w)" indent>
                <template #default="{ open }">
                  <span class="shrink-0 font-mono text-ink">{{ w.target }}</span>
                  <span
                    class="min-w-0 flex-1 font-mono text-meta text-muted"
                    :class="open ? 'break-words' : 'truncate'"
                    >{{ writeText(w) }}</span
                  >
                </template>
                <template v-if="writeDetail(w).length" #detail>
                  <span v-for="(t, i) in writeDetail(w)" :key="i" class="break-words">{{ t }}</span>
                </template>
              </BehaviourRow>
            </template>
          </div>
        </section>
      </div>

      <div v-else-if="behaviourLayout === 'walk'" class="flex flex-col">
        <p v-if="!props.walks || props.walks.status === 'reading'" class="flex items-center gap-2 text-muted">
          <LabIcon name="spinner" :size="14" :stroke="2.25" class="animate-spin" />
          Following the frames from each trigger. This takes a few more seconds.
        </p>
        <LabAlert v-else-if="props.walks.status === 'error'" title="Couldn’t follow the walks">
          <span class="font-mono text-meta break-words">{{ props.walks.message }}</span>
        </LabAlert>
        <p v-else-if="!walkList.length" class="text-muted">The analysis follows no walk for this part.</p>
        <div v-else class="-mx-3 flex flex-col">
          <BehaviourWalkGroup
            v-for="g in walkList"
            :key="g.trigger"
            :trigger="g.trigger"
            :rows="g.rows"
            :frames="frames"
            :sides="sides"
            :current="current"
            @show-frame="emit('showFrame', $event)"
          />
        </div>
      </div>

      <div v-else class="flex flex-col">
        <p v-if="!states.length" class="text-muted">No routine changes the state.</p>
        <div class="-mx-3 flex flex-col">
          <section v-for="g in states" :key="g.fromText" class="flex flex-col">
            <LabListRow :expanded="!closed.has(`state ${g.fromText}`)" @click="toggle(`state ${g.fromText}`)">
              <span
                class="font-mono font-semibold"
                :class="
                  current !== undefined && (g.from === null || g.from.includes(current)) ? 'text-accent' : 'text-ink'
                "
                >{{ g.from === null ? "any state" : g.from.length ? `state ${g.fromText}` : "none of its own" }}</span
              >
              <template #end>
                <LabChip tone="accent">{{ g.rows.length }} {{ g.rows.length === 1 ? "way" : "ways" }} out</LabChip>
              </template>
            </LabListRow>
            <div
              v-if="!closed.has(`state ${g.fromText}`)"
              class="flex flex-col border-b border-line-soft pb-1.5 [&>*:first-child]:border-t-0"
            >
              <BehaviourChange
                v-for="row in g.rows"
                :key="row.key"
                :row="row"
                lead="routine"
                :frames="frames"
                :sides="sides"
                :highlight="fromHere(row)"
                indent
                @show-frame="emit('showFrame', $event)"
              />
            </div>
          </section>
        </div>
        <LabSection v-if="draws.length" title="Draws" class="pt-3">
          <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
            <BehaviourRow v-for="w in draws" :key="w.key" :confidence="w.confidence" :tip="writeTip(w)">
              <template #default="{ open }">
                <span class="shrink-0 font-mono font-semibold text-accent">{{ w.routine }}</span>
                <span class="shrink-0 font-mono text-ink">{{ w.target }}</span>
                <span
                  class="min-w-0 flex-1 font-mono text-meta text-muted"
                  :class="open ? 'break-words' : 'truncate'"
                  >{{ writeText(w) }}</span
                >
              </template>
              <template v-if="writeDetail(w).length" #detail>
                <span v-for="(t, i) in writeDetail(w)" :key="i" class="break-words">{{ t }}</span>
              </template>
            </BehaviourRow>
          </div>
        </LabSection>
      </div>

      <LabSection v-if="rest" title="Rest">
        <BehaviourRest :rest="rest" :frames="frames" @show-frame="emit('showFrame', $event)" />
      </LabSection>

      <LabSection v-if="effects.length || readingPerType || perTypeError" title="From other parts">
        <p v-if="readingPerType" class="flex items-center gap-2 pb-2 text-muted">
          <LabIcon name="spinner" :size="14" :stroke="2.25" class="animate-spin" />
          Reading what other parts do to each type. More may come.
        </p>
        <p v-else-if="perTypeError" class="pb-2 text-muted">
          Couldn’t read what other parts do to each type, so some may be missing: {{ perTypeError }}
        </p>
        <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
          <BehaviourEffect v-for="(e, i) in effects" :key="i" :effect="e" :name="nameOf(e.sourceType)" />
        </div>
      </LabSection>

      <LabSection v-if="created.length" title="Creates">
        <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
          <BehaviourDoing v-for="d in created" :key="d.description" :doing="d" />
        </div>
      </LabSection>

      <LabSection v-if="gear" title="Gear">
        <template #action>
          <LabInfo :text="[gear.text.activation, '', ...gear.text.scheduling].join('\n')" />
        </template>
        <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
          <BehaviourRow v-for="r in gearRows" :key="r.what" :confidence="gear.confidence" :tip="r.tip">
            <span class="shrink-0 font-mono text-ink">{{ r.what }}</span>
            <span class="shrink-0 font-mono text-accent">{{ r.then }}</span>
            <span class="min-w-0 flex-1 truncate text-meta text-muted">{{ r.note }}</span>
            <template #detail>
              <p class="font-sans break-words">{{ r.detail }}</p>
            </template>
          </BehaviourRow>
        </div>
        <template v-if="gear.drivers.length">
          <PanelTitle class="block pt-1.5">Driven by</PanelTitle>
          <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
            <BehaviourRow
              v-for="d in gear.drivers"
              :key="d.type"
              :confidence="d.confidence"
              :tip="`If this gear is the belt end ${nameOf(d.type)} picks, ${nameOf(d.type)} writes its step.\n\n${d.steps.length} ${d.steps.length === 1 ? 'value' : 'values'}, ${d.confidence}. Click for each.`"
            >
              <span class="shrink-0 text-ink">{{ nameOf(d.type) }}</span>
              <span class="min-w-0 flex-1 truncate font-mono text-meta text-muted"
                >step = {{ d.steps.join(", ") }}</span
              >
              <template #detail>
                <p v-for="t in d.descriptions" :key="t" class="font-sans break-words">{{ t }}</p>
              </template>
            </BehaviourRow>
          </div>
        </template>
      </LabSection>

      <LabDisclosure
        v-if="doneCount"
        :title="`To itself and others · ${doneCount} ${doneCount === 1 ? 'line' : 'lines'}`"
      >
        <template v-for="g in doneTo" :key="g.on">
          <PanelTitle class="block px-3 pt-2 pb-1">{{ g.title }}</PanelTitle>
          <div class="flex flex-col [&>*:first-child]:border-t-0">
            <BehaviourDoing v-for="d in g.list" :key="d.description" :doing="d" />
          </div>
        </template>
      </LabDisclosure>

      <LabDisclosure :title="`More · ${more} findings`">
        <ul class="flex flex-col gap-1 p-3 font-mono text-meta break-words text-muted">
          <li v-for="(t, i) in part.triggers" :key="`t${i}`" class="flex gap-1.5">
            <ConfidenceMark :confidence="t.confidence" class="mt-1.5" focusable /><span
              ><span class="font-sans text-faint">trigger</span> {{ t.routine }}: {{ t.name
              }}<template v-if="t.condition"> when {{ t.condition }}</template></span
            >
          </li>
          <li v-for="c in part.counters" :key="c.field" class="flex gap-1.5">
            <ConfidenceMark :confidence="c.confidence" class="mt-1.5" focusable /><span
              ><span class="font-sans text-faint">counter</span> {{ c.field }} = {{ c.updates.join(", ")
              }}<template v-if="c.comparisons.length"> · {{ c.comparisons.join(", ") }}</template></span
            >
          </li>
          <li v-for="u in part.uncertainties" :key="u" class="flex gap-1.5">
            <ConfidenceMark confidence="unresolved" class="mt-1.5" focusable /><span
              ><span class="font-sans text-faint">open</span> {{ u }}</span
            >
          </li>
          <li v-for="l in gear?.text.limits ?? []" :key="l" class="flex gap-1.5">
            <ConfidenceMark :confidence="gear!.confidence" class="mt-1.5" focusable /><span
              ><span class="font-sans text-faint">gear</span> {{ l }}</span
            >
          </li>
          <li class="flex gap-1.5">
            <span class="w-1.5 shrink-0" aria-hidden="true"></span
            ><span><span class="font-sans text-faint">analysis</span> {{ howRead }}</span>
          </li>
          <li v-if="timing" class="flex gap-1.5">
            <ConfidenceMark :confidence="summary!.timing.confidence" class="mt-1.5" focusable /><span
              ><span class="font-sans text-faint">timing</span> {{ timing }}</span
            >
          </li>
        </ul>
      </LabDisclosure>
    </template>
  </div>
</template>
