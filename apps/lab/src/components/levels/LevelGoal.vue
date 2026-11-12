<script setup lang="ts">
import { conditionText, type GoalCondition, type PuzzleGoal } from "@opentim/content";
import { computed } from "vue";
import { goalMarkWords, tidyWords } from "../../behaviour.ts";
import LabBadge from "../LabBadge.vue";
import LabChip from "../LabChip.vue";
import LabDisclosure from "../LabDisclosure.vue";
import LabListRow from "../LabListRow.vue";
import LabPanelHeader from "../LabPanelHeader.vue";
import ReadProgress from "../ReadProgress.vue";

/**
 * When the level's puzzle is solved, as TIM.EXE's goal routine for it tests: one short row per condition, with the
 * number of its area on the drawing when it tests a place, and the routine itself folded away below. A goal that
 * doesn't fit the conditions shows only the routine, with why.
 */
const props = defineProps<{
  /** The goal as read, or why there is none to show. */
  goal: { status: "done"; goal: PuzzleGoal; from?: "level" } | { status: "reading" } | { status: "none"; why: string };
  /** The goal text the level shows the player. */
  says?: string;
  /** The number each condition's area has on the drawing, by way and condition. */
  areaNumbers: ReadonlyMap<GoalCondition, number>;
  /** The parts that set each goal mark, by `type:bit`, to say a test of a mark by them. */
  markSetters?: ReadonlyMap<string, string[]>;
  /** The least time one step of the run takes, to say a number of steps in seconds. */
  stepMilliseconds?: number;
}>();

const summary = computed(() => (props.goal.status === "done" ? props.goal.goal.summary : undefined));
/** TIM 2 keeps its goal in the level file, as entries one routine of TIM2.EXE tests. */
const fromLevel = computed(() => props.goal.status === "done" && props.goal.from === "level");
const badge = computed(() => {
  const s = summary.value;
  if (!s) return undefined;
  if (s.problem)
    return {
      status: "partial" as const,
      label: "program only",
      title: `No conditions: ${s.problem}. The routine below is exact.`,
    };
  return {
    status: "decoded" as const,
    label: "read",
    title: fromLevel.value
      ? "Read from the level file's goal entries, as TIM2.EXE's goal routine tests them"
      : "Read from the goal routine, which the emulator check runs too",
  };
});

/** Every type the goal looks at, for the words it keeps from step to step. */
const goalTypes = computed(() => summary.value?.ways.flat().flatMap((c) => c.types?.map((t) => t.type) ?? []) ?? []);
/**
 * The words the goal keeps for itself, by their place among them: "its count", or "its word 1" and so on. A word the
 * routine reads with an index, like `word 0x5068[bx]` with one word per mouse motor, is the start of a table: "its
 * table". Tables come first, so a word is only a single word where no index follows it.
 */
const ownWords = computed(() => {
  const words = summary.value?.remembered.map((r) => r.word) ?? [];
  const tables: string[] = [];
  // A word the routine keeps that the summary doesn't list, in the order the routine first uses it.
  const lines = props.goal.status === "done" ? props.goal.goal.lines : [];
  for (const line of lines)
    for (const [, word, indexed] of line.matchAll(/\b(word 0x[0-9a-f]{4})\b(\[)?/g)) {
      const list = indexed ? tables : words;
      if (!list.includes(word!)) list.push(word!);
    }
  return new Map([
    ...tables.map((w, k): [string, string] => [`${w}[`, tables.length === 1 ? "its table[" : `its table ${k + 1}[`]),
    ...words.map((w, k): [string, string] => [w, words.length === 1 ? "its count" : `its word ${k + 1}`]),
  ]);
});
/**
 * A test or a value as the panel says it: a goal mark by the parts that set it, a field by the lab's name, and a word
 * the goal keeps for itself by its place among them; the goal routine below reads the same way.
 */
const say = (text: string, types: readonly number[] = goalTypes.value) => {
  let out = tidyWords(goalMarkWords(text, types, props.markSetters ?? new Map()));
  for (const [word, name] of ownWords.value) out = out.split(word).join(name);
  // A number of steps as the time it takes at the least: the run loop waits for the same timer ticks every step.
  const ms = props.stepMilliseconds;
  if (ms)
    out = out.replace(
      /\b(the (?:second )?step count) ([<>=≤≥≠]+) (\d+)\b/g,
      (_, count: string, op: string, n: string) => `${count} ${op} ${n} (${seconds(Number(n) * ms)})`,
    );
  return out;
};
/** A time in seconds, with one decimal below 10 seconds. */
const seconds = (ms: number) => {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
};
const typeNumbers = (c: GoalCondition) => c.types?.map((t) => t.type) ?? goalTypes.value;

/** A condition's parts in words: the types, or any part. */
const typesOf = (c: GoalCondition) =>
  (c.types?.length ? c.types.map((t) => t.name).join(", ") : "any part") + (c.part === undefined ? "" : ` #${c.part}`);
const countOf = (c: GoalCondition) => {
  const op = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" }[c.count!.op];
  return `${op} ${c.count!.value}`;
};
</script>

<template>
  <div class="absolute inset-0 flex flex-col">
    <LabPanelHeader title="Goal">
      <LabBadge v-if="badge" v-bind="badge" />
    </LabPanelHeader>
    <div class="min-h-0 flex-1 overflow-auto">
      <p v-if="says" class="truncate px-3 py-[5px] text-soft italic" :title="says">“{{ says }}”</p>
      <ReadProgress v-if="goal.status === 'reading'" class="px-3 py-2" />
      <p v-if="goal.status === 'none'" class="px-3 py-[5px] text-muted">{{ goal.why }}</p>
      <template v-if="summary">
        <template v-for="(way, w) in summary.ways" :key="w">
          <p v-if="w > 0" class="px-3 pt-1 text-label font-semibold tracking-[.07em] text-faint uppercase">or</p>
          <LabListRow v-for="(c, k) in way" :key="k" inset :title="say(conditionText(c), typeNumbers(c))">
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  v-if="areaNumbers.has(c)"
                  class="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-decoded font-mono text-2xs font-semibold text-accent-ink"
                  :aria-label="`area ${areaNumbers.get(c)}`"
                  >{{ areaNumbers.get(c) }}</span
                >
                <LabChip>{{ c.kind }}</LabChip>
                <template v-if="c.kind !== 'word'">
                  <span class="min-w-0 truncate font-mono text-meta text-ink">{{ typesOf(c) }}</span>
                  <span v-if="c.lists" class="shrink-0 text-meta text-faint">on {{ c.lists }}</span>
                </template>
              </span>
              <!-- What the condition tests goes on a line of its own, so it is never cut off by the names. -->
              <span v-if="c.where?.length" class="font-mono text-meta break-words text-muted"
                ><span class="font-sans">where</span> {{ say(c.where.join(", "), typeNumbers(c)) }}</span
              >
              <span v-if="c.kind === 'count'" class="font-mono text-meta text-soft">{{ countOf(c) }}</span>
              <span v-else-if="c.tests.length" class="font-mono text-meta break-words text-soft">{{
                say(c.tests.join(" · "), typeNumbers(c))
              }}</span>
            </span>
          </LabListRow>
          <LabListRow v-if="!way.length" inset><span class="text-muted">always, at the first step</span></LabListRow>
        </template>
        <LabListRow v-if="!summary.ways.length && !summary.problem" inset>
          <span class="text-muted">never: no way through the routine ends the run</span>
        </LabListRow>
        <LabListRow
          v-for="r in summary.remembered"
          :key="r.word"
          inset
          :title="say(`${r.word}: ${r.becomes.join('; ')}`)"
        >
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-2">
              <LabChip tone="faint">kept</LabChip>
              <span class="min-w-0 truncate font-mono text-meta text-ink">{{ say(r.word) }}</span>
              <span class="shrink-0 text-meta text-faint">from step to step</span>
            </span>
            <span v-for="b in r.becomes" :key="b" class="font-mono text-meta break-words text-muted">{{ say(b) }}</span>
          </span>
        </LabListRow>
        <div v-if="goal.status === 'done'" class="p-2">
          <LabDisclosure
            :title="fromLevel ? 'Goal entries as stored' : `Goal routine, ${goal.goal.lines.length} lines`"
            :open="!!summary.problem"
          >
            <pre class="overflow-x-auto px-3 py-2 font-mono text-meta leading-5 text-soft">{{
              goal.goal.lines.map((line) => say(line)).join("\n")
            }}</pre>
          </LabDisclosure>
        </div>
      </template>
    </div>
  </div>
</template>
