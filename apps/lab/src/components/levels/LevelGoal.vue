<script setup lang="ts">
import { conditionText, type GoalCondition, type PuzzleGoal, type ToonsGoalParts } from "@opentim/content";
import { computed } from "vue";
import { goalMarkWords, tidyWords, type RecordNames } from "../../behaviour.ts";
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
  /** How many parts of each type the level has, bin included, to note an n-th part it doesn't have. */
  typeCounts?: ReadonlyMap<number, number>;
  /** For a condition on the n-th part of a type, the level part it is, by the game's order of its lists. */
  partNumbers?: ReadonlyMap<GoalCondition, number>;
  /** For a Toons condition, its parts as the puzzle starts: whether it holds then, and what the player can change. */
  atStart?: ReadonlyMap<GoalCondition, ToonsGoalParts>;
  /** The part record's words the game's goals can be said with; without them no field is named. */
  record?: RecordNames;
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
    // A word of the data segment, or of a far segment as Toons' goals keep some (`word 0x340f:7514`).
    for (const [, word, indexed] of line.matchAll(/\b(word 0x[0-9a-f]{4}(?::[0-9a-f]{4})?)\b(\[)?/g)) {
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
  const names = props.record ?? { fields: [] };
  let out = tidyWords(goalMarkWords(text, types, props.markSetters ?? new Map(), names), names);
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

/** A condition's parts in words: the types, or any part, and the part a field of it holds. */
const typesOf = (c: GoalCondition) => {
  const types = c.types?.length ? c.types.map((t) => t.name).join(", ") : "any part";
  const part = c.part ?? props.partNumbers?.get(c);
  const own = types + (part === undefined ? "" : ` #${part}`);
  return c.via ? `${c.via.kept ? "kept " : ""}${c.via.name} of ${own}` : own;
};
/** "1st", "2nd", "3rd", "4th": which part of its type a condition is about. */
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
/** Whether the level has fewer parts of the type than the one the condition is about: the goal finds none then. */
const missing = (c: GoalCondition) =>
  c.kind === "nth" && !!props.typeCounts && (props.typeCounts.get(c.types?.[0]?.type ?? -1) ?? 0) < c.nth!;
/** What TOONS.EXE lets the player do with a rope that is tied when the puzzle starts. */
const ROPES =
  "The ropes are as the puzzle starts: a rope between two parts on the board stays tied. The player can take either end off and tie it elsewhere, or put the rope in the bin.";
/** What the level says of a condition as the puzzle starts, said in a chip, with why in its tip. */
const atStart = (c: GoalCondition) => {
  const found = props.atStart?.get(c);
  if (!found) return undefined;
  if (found.holds === false)
    return {
      label: "not at the start",
      title: `This doesn't hold as the puzzle starts.${found.player === "ropes" ? ` ${ROPES}` : ""}`,
    };
  if (found.player === "ropes") return { label: "ropes", title: `The part this is depends on the ropes. ${ROPES}` };
  if (found.player === "bin")
    return {
      label: "bin parts",
      title:
        "A part from the bin could come before this one: the game sorts it into the list by where the player puts it.",
    };
  return undefined;
};
const TIME = { "so far": "of the run so far, this one included", before: "before this one" } as const;
/** When a condition's tests held, said in a chip, with what the goal keeps for it in the chip's tip. */
const history = (c: GoalCondition) => {
  if (c.ago) {
    const first = c.ago.afterFirst ? ", and that wasn't the first step" : "";
    return {
      label: `${c.ago.steps} steps ago`,
      title: `The last step ${TIME[c.once ?? "so far"]} at which the tests held was ${c.ago.steps} steps before this one${first}: the goal keeps that step's count`,
    };
  }
  if (!c.once) return undefined;
  if (c.steps) {
    const op = { "==": "", "!=": "≠ ", "<": "< ", "<=": "≤ ", ">": "> ", ">=": "≥ " }[c.steps.op];
    return {
      label: `${op}${c.steps.value} step${c.steps.value === 1 ? "" : "s"}`,
      title: `How many steps ${TIME[c.once]} the tests held at: the goal counts them in a word`,
    };
  }
  if (c.never)
    return { label: "never", title: `The tests held at no step ${TIME[c.once]}: the goal keeps a word for it` };
  return { label: "once", title: `The tests held at some step ${TIME[c.once]}: the goal keeps a word for it` };
};
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
                <LabChip>{{ c.kind === "nth" ? ordinal(c.nth!) : c.kind }}</LabChip>
                <LabChip v-if="history(c)" tone="accent" :title="history(c)!.title">{{ history(c)!.label }}</LabChip>
                <template v-if="c.kind !== 'word'">
                  <span class="min-w-0 truncate font-mono text-meta text-ink">{{ typesOf(c) }}</span>
                  <span v-if="c.lists" class="min-w-0 truncate text-meta text-faint">on {{ c.lists }}</span>
                  <LabChip v-if="missing(c)" tone="error" title="The level has fewer parts of this type, bin included"
                    >not in this level</LabChip
                  >
                  <LabChip v-if="atStart(c)" tone="faint" :title="atStart(c)!.title">{{ atStart(c)!.label }}</LabChip>
                </template>
              </span>
              <!-- What the condition tests goes on a line of its own, so it is never cut off by the names. -->
              <span v-if="c.where?.length" class="font-mono text-meta break-words text-muted"
                ><span class="font-sans">where</span> {{ say(c.where.join(", "), typeNumbers(c)) }}</span
              >
              <span v-if="c.kind === 'count'" class="flex min-w-0 items-center gap-2">
                <span class="font-mono text-meta text-soft">{{ countOf(c) }}</span>
                <LabChip v-if="c.caution" tone="error" :title="c.caution">can pass with fewer</LabChip>
              </span>
              <span v-if="c.tests.length" class="font-mono text-meta break-words text-soft">{{
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
