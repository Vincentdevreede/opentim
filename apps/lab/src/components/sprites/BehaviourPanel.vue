<script setup lang="ts">
import { computed, reactive } from "vue";
import type { BehaviourResult } from "../../behaviour.ts";
import { outlineSides, routineGroups, stateGroups, type ChangeRow, type WriteRow } from "../../behaviour-view.ts";
import { behaviourLayout } from "../../ui.ts";
import LabIcon from "../LabIcon.vue";
import LabSegmented from "../LabSegmented.vue";
import LabTip from "../LabTip.vue";
import BehaviourChange from "./BehaviourChange.vue";
import BehaviourRow from "./BehaviourRow.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/** What the program does with a part, by routine or by the state a change starts from. */
const props = defineProps<{
  /** The analysis of the loaded program; undefined while it hasn't started. */
  result?: BehaviourResult | { status: "reading" };
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
const writeTip = (w: WriteRow) =>
  isPoints(w)
    ? `${w.routine} sets the outline to ${w.values.length} points:\n${w.values.join(" ")}\n\nEdges run clockwise from the first point.`
    : [`${w.routine} writes ${w.target}`, ...w.values.slice(0, 8).map((v) => `= ${v}`)]
        .concat(w.values.length > 8 ? [`and ${w.values.length - 8} more`] : [])
        .concat("", `${w.writes.length} ${w.writes.length === 1 ? "path" : "paths"}, ${w.confidence}. Click for each.`)
        .join("\n");

const legend = computed(() =>
  [
    "Read from the program’s instructions without running it" +
      (props.result?.status === "done" ? `, in ${props.result.seconds.toFixed(1)} s.` : "."),
    "State N shows frame N.",
    "",
    "● checked: follows from the instructions",
    "◇ inferred: follows with the assumptions it lists",
    "○ unresolved: the analysis can’t tell",
  ].join("\n"),
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
        (timing.value ? 1 : 0)
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
    <p v-else-if="result.status === 'error'" class="text-error">
      Couldn’t read the behaviour: <span class="font-mono">{{ result.message }}</span>
    </p>
    <p v-else-if="!part" class="text-muted">The program has no behaviour for this part.</p>

    <template v-else>
      <div class="flex items-center gap-2">
        <LabSegmented v-model="behaviourLayout" label="Layout" :options="LAYOUTS" />
        <div class="flex-1"></div>
        <LabTip :text="legend">
          <span class="cursor-help text-faint hover:text-ink"><LabIcon name="info" :size="14" :stroke="2" /></span>
        </LabTip>
      </div>

      <div v-if="behaviourLayout === 'routine'" class="flex flex-col">
        <section v-for="g in routines" :key="g.role" class="flex flex-col">
          <div class="flex h-7 items-center gap-1.5">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              :class="g.changes.length || g.draws.length || g.sets.length ? 'cursor-pointer' : 'cursor-default'"
              :aria-expanded="!closed.has(g.role)"
              @click="toggle(g.role)"
            >
              <LabIcon
                v-if="g.changes.length || g.draws.length || g.sets.length"
                :name="closed.has(g.role) ? 'chevronRight' : 'chevronDown'"
                :size="12"
                :stroke="2.5"
                class="shrink-0 text-faint"
              />
              <span v-else class="w-3 shrink-0"></span>
              <span class="font-mono text-ui font-semibold" :class="g.empty ? 'text-faint' : 'text-ink'">{{
                g.role
              }}</span>
              <span class="flex-1"></span>
              <span v-if="g.changes.length" class="chip text-accent"
                >{{ g.changes.length }} {{ g.changes.length === 1 ? "change" : "changes" }}</span
              >
              <span v-if="g.draws.length" class="chip text-soft">draws</span>
              <span v-if="g.sets.length" class="chip text-soft">sets</span>
              <span v-if="g.open" class="chip text-error">open</span>
              <span
                v-if="!g.changes.length && !g.draws.length && !g.sets.length"
                class="text-meta whitespace-nowrap text-faint"
                >{{ g.empty ? "does nothing" : "no change" }}</span
              >
              <span v-if="sharedCount(g.address) > 1" class="chip text-faint"
                >shared ×{{ sharedCount(g.address) }}</span
              >
            </button>
            <LabTip :text="routineTip(g.role, g.at, g.address)">
              <span class="cursor-help text-faint hover:text-ink"><LabIcon name="info" :size="14" :stroke="2" /></span>
            </LabTip>
          </div>
          <div v-if="!closed.has(g.role)" class="flex flex-col pb-1.5 pl-[18px]">
            <BehaviourChange
              v-for="row in g.changes"
              :key="row.key"
              :row="row"
              lead="from"
              :frames="frames"
              :sides="sides"
              :highlight="fromHere(row)"
              @show-frame="emit('showFrame', $event)"
            />
            <div
              v-if="g.changes.length && g.kept"
              class="flex h-7 items-center gap-2 border-t border-line-soft text-meta text-faint"
            >
              <ConfidenceMark confidence="inferred" />
              otherwise no change · {{ g.kept }} {{ g.kept === 1 ? "path" : "paths" }}
            </div>
            <template
              v-for="[title, list] in [
                ['Draws', g.draws],
                ['Sets', g.sets],
              ] as const"
              :key="title"
            >
              <h4
                v-if="list.length"
                class="pt-1.5 pb-0.5 text-label font-semibold tracking-[.07em] text-faint uppercase"
              >
                {{ title }}
              </h4>
              <BehaviourRow v-for="w in list" :key="w.key" :confidence="w.confidence" :tip="writeTip(w)">
                <span class="shrink-0 font-mono text-ink">{{ w.target }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-meta text-muted">{{ writeText(w) }}</span>
                <template #detail>
                  <span v-for="(x, i) in w.writes" :key="i" class="break-words"
                    ><span class="text-soft">= {{ x.value }}</span>
                    <template v-if="x.condition !== 'always'"> when {{ x.condition }}</template></span
                  >
                </template>
              </BehaviourRow>
            </template>
          </div>
        </section>
      </div>

      <div v-else class="flex flex-col">
        <p v-if="!states.length" class="text-muted">No routine changes the state.</p>
        <section v-for="g in states" :key="g.fromText" class="flex flex-col">
          <button
            type="button"
            class="flex h-7 cursor-pointer items-center gap-1.5 text-left"
            :aria-expanded="!closed.has(`state ${g.fromText}`)"
            @click="toggle(`state ${g.fromText}`)"
          >
            <LabIcon
              :name="closed.has(`state ${g.fromText}`) ? 'chevronRight' : 'chevronDown'"
              :size="12"
              :stroke="2.5"
              class="shrink-0 text-faint"
            />
            <span
              class="font-mono text-ui font-semibold"
              :class="
                current !== undefined && (g.from === null || g.from.includes(current)) ? 'text-accent' : 'text-ink'
              "
              >{{ g.from === null ? "any state" : g.from.length ? `state ${g.fromText}` : "none of its own" }}</span
            >
            <span class="flex-1"></span>
            <span class="chip text-accent">{{ g.rows.length }} {{ g.rows.length === 1 ? "way" : "ways" }} out</span>
          </button>
          <div v-if="!closed.has(`state ${g.fromText}`)" class="flex flex-col pb-1.5 pl-[18px]">
            <BehaviourChange
              v-for="row in g.rows"
              :key="row.key"
              :row="row"
              lead="routine"
              :frames="frames"
              :sides="sides"
              :highlight="fromHere(row)"
              @show-frame="emit('showFrame', $event)"
            />
          </div>
        </section>
        <template v-if="draws.length">
          <h4 class="pt-1.5 pb-0.5 text-label font-semibold tracking-[.07em] text-faint uppercase">Draws</h4>
          <BehaviourRow v-for="w in draws" :key="w.key" :confidence="w.confidence" :tip="writeTip(w)">
            <span class="shrink-0 font-mono font-semibold text-accent">{{ w.routine }}</span>
            <span class="shrink-0 font-mono text-ink">{{ w.target }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-meta text-muted">{{ writeText(w) }}</span>
            <template #detail>
              <span v-for="(x, i) in w.writes" :key="i" class="break-words"
                ><span class="text-soft">= {{ x.value }}</span>
                <template v-if="x.condition !== 'always'"> when {{ x.condition }}</template></span
              >
            </template>
          </BehaviourRow>
        </template>
      </div>

      <section v-if="gear" class="flex flex-col">
        <div class="flex h-7 items-center gap-1.5">
          <h3 class="text-label font-semibold tracking-[.07em] text-faint uppercase">Gear</h3>
          <span class="flex-1"></span>
          <LabTip :text="[gear.text.activation, '', ...gear.text.scheduling].join('\n')">
            <span class="cursor-help text-faint hover:text-ink"><LabIcon name="info" :size="14" :stroke="2" /></span>
          </LabTip>
        </div>
        <BehaviourRow v-for="r in gearRows" :key="r.what" :confidence="gear.confidence" :tip="r.tip">
          <span class="shrink-0 font-mono text-ink">{{ r.what }}</span>
          <span class="shrink-0 font-mono text-accent">{{ r.then }}</span>
          <span class="min-w-0 flex-1 truncate text-meta text-muted">{{ r.note }}</span>
          <template #detail>
            <p class="font-sans break-words">{{ r.detail }}</p>
          </template>
        </BehaviourRow>
        <template v-if="gear.drivers.length">
          <h4 class="pt-1.5 pb-0.5 text-label font-semibold tracking-[.07em] text-faint uppercase">Driven by</h4>
          <BehaviourRow
            v-for="d in gear.drivers"
            :key="d.type"
            :confidence="d.confidence"
            :tip="`If this gear is the belt end ${nameOf(d.type)} picks, ${nameOf(d.type)} writes its step.\n\n${d.steps.length} ${d.steps.length === 1 ? 'value' : 'values'}, ${d.confidence}. Click for each.`"
          >
            <span class="shrink-0 text-ink">{{ nameOf(d.type) }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-meta text-muted">step = {{ d.steps.join(", ") }}</span>
            <template #detail>
              <p v-for="t in d.descriptions" :key="t" class="font-sans break-words">{{ t }}</p>
            </template>
          </BehaviourRow>
        </template>
      </section>

      <details class="border-t border-line pt-2 text-meta text-muted">
        <summary class="cursor-pointer text-label font-semibold tracking-[.07em] uppercase">
          More · {{ more }} findings
        </summary>
        <ul class="mt-1.5 flex flex-col gap-1 font-mono break-words">
          <li v-for="(t, i) in part.triggers" :key="`t${i}`" class="flex gap-1.5">
            <ConfidenceMark :confidence="t.confidence" class="mt-1.5" /><span
              ><span class="font-sans text-faint">trigger</span> {{ t.routine }}: {{ t.name
              }}<template v-if="t.condition"> when {{ t.condition }}</template></span
            >
          </li>
          <li v-for="c in part.counters" :key="c.field" class="flex gap-1.5">
            <ConfidenceMark :confidence="c.confidence" class="mt-1.5" /><span
              ><span class="font-sans text-faint">counter</span> {{ c.field }} = {{ c.updates.join(", ")
              }}<template v-if="c.comparisons.length"> · {{ c.comparisons.join(", ") }}</template></span
            >
          </li>
          <li v-for="u in part.uncertainties" :key="u" class="flex gap-1.5">
            <ConfidenceMark confidence="unresolved" class="mt-1.5" /><span
              ><span class="font-sans text-faint">open</span> {{ u }}</span
            >
          </li>
          <li v-for="l in gear?.text.limits ?? []" :key="l" class="flex gap-1.5">
            <ConfidenceMark :confidence="gear!.confidence" class="mt-1.5" /><span
              ><span class="font-sans text-faint">gear</span> {{ l }}</span
            >
          </li>
          <li v-if="timing" class="flex gap-1.5">
            <ConfidenceMark :confidence="summary!.timing.confidence" class="mt-1.5" /><span
              ><span class="font-sans text-faint">timing</span> {{ timing }}</span
            >
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.chip {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
}
</style>
