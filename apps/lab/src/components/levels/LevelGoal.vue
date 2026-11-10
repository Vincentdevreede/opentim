<script setup lang="ts">
import { conditionText, type GoalCondition, type PuzzleGoal } from "@opentim/content";
import { computed } from "vue";
import { goalMarkWords, tidyWords } from "../../behaviour.ts";
import LabBadge from "../LabBadge.vue";
import LabChip from "../LabChip.vue";
import LabDisclosure from "../LabDisclosure.vue";
import LabListRow from "../LabListRow.vue";
import LabPanelHeader from "../LabPanelHeader.vue";

/**
 * When the level's puzzle is solved, as TIM.EXE's goal routine for it tests: one short row per condition, with the
 * number of its area on the drawing when it tests a place, and the routine itself folded away below. A goal that
 * doesn't fit the conditions shows only the routine, with why.
 */
const props = defineProps<{
  /** The goal as read, or why there is none to show. */
  goal: { status: "done"; goal: PuzzleGoal } | { status: "reading" } | { status: "none"; why: string };
  /** The goal text the level shows the player. */
  says?: string;
  /** The number each condition's area has on the drawing, by way and condition. */
  areaNumbers: ReadonlyMap<GoalCondition, number>;
  /** The parts that set each goal mark, by `type:bit`, to say a test of a mark by them. */
  markSetters?: ReadonlyMap<string, string[]>;
}>();

const summary = computed(() => (props.goal.status === "done" ? props.goal.goal.summary : undefined));
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
    title: "Read from the goal routine, which the emulator check runs too",
  };
});

/** Every type the goal looks at, for the words it keeps from step to step. */
const goalTypes = computed(() => summary.value?.ways.flat().flatMap((c) => c.types?.map((t) => t.type) ?? []) ?? []);
/** The words the goal keeps for itself, by their place among them: "its count", or "its word 1" and so on. */
const ownWords = computed(() => {
  const words = summary.value?.remembered.map((r) => r.word) ?? [];
  return new Map(words.map((w, k) => [w, words.length === 1 ? "its count" : `its word ${k + 1}`]));
});
/**
 * A test or a value as the panel says it: a goal mark by the parts that set it, a field by the lab's name, and a word
 * the goal keeps for itself by its place among them; the program below keeps the analysis's own words.
 */
const say = (text: string, types: readonly number[] = goalTypes.value) => {
  let out = tidyWords(goalMarkWords(text, types, props.markSetters ?? new Map()));
  for (const [word, name] of ownWords.value) out = out.split(word).join(name);
  return out;
};
const typeNumbers = (c: GoalCondition) => c.types?.map((t) => t.type) ?? goalTypes.value;

/** A condition's parts in words: the types, or any part. */
const typesOf = (c: GoalCondition) => (c.types?.length ? c.types.map((t) => t.name).join(", ") : "any part");
const countOf = (c: GoalCondition) => {
  const op = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" }[c.count!.op];
  return `${op} ${c.count!.value}`;
};
</script>

<template>
  <div class="absolute inset-0 flex flex-col">
    <LabPanelHeader title="Goal">
      <span v-if="goal.status === 'reading'" class="text-meta text-muted">reading the program…</span>
      <LabBadge v-else-if="badge" v-bind="badge" />
    </LabPanelHeader>
    <div class="min-h-0 flex-1 overflow-auto">
      <p v-if="says" class="truncate px-3 py-[5px] text-soft italic" :title="says">“{{ says }}”</p>
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
          <LabDisclosure :title="`Goal routine, ${goal.goal.lines.length} lines`" :open="!!summary.problem">
            <pre class="overflow-x-auto px-3 py-2 font-mono text-meta leading-5 text-soft">{{
              goal.goal.lines.join("\n")
            }}</pre>
          </LabDisclosure>
        </div>
      </template>
    </div>
  </div>
</template>
