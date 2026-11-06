<script setup lang="ts">
import { computed } from "vue";
import type { Doing } from "../../behaviour.ts";
import { conditionText } from "../../behaviour-view.ts";
import BehaviourRow from "./BehaviourRow.vue";

/**
 * One thing the part does, in the analysis's own sentence: a part it creates, or what it does to itself or another
 * part. The closed line shows two lines of it and opens to the rest; under it, when it does it; the tip says how many
 * ways give it.
 */
const props = defineProps<{ doing: Doing }>();

/** Ways past this many are counted rather than listed. */
const CASES = 8;

/** Under "Creates" the sentence starts with what it creates, like "A bullet (type 20) at …". */
const text = computed(() => {
  const d = props.doing.description;
  if (props.doing.on !== "created") return d;
  const rest = d.replace(/^Creates /, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
});
/** A way without a test does it whenever its routine gets there; otherwise each way's test, tidied. */
const always = computed(() => props.doing.conditions.includes("always"));
const conditions = computed(() =>
  always.value ? [] : props.doing.conditions.map((c) => conditionText(c)).filter((c) => c),
);
const tip = computed(() =>
  [
    props.doing.description,
    "",
    `${props.doing.ways} ${props.doing.ways === 1 ? "way" : "ways"} through its routines, ${props.doing.confidence}.`,
    ...(always.value
      ? ["A way does it without a test."]
      : conditions.value.length > 1
        ? [`Each way needs its own condition; ${conditions.value.length} differ. Click for them.`]
        : []),
  ].join("\n"),
);
</script>

<template>
  <BehaviourRow :confidence="doing.confidence" :tip="tip">
    <template #default="{ open }">
      <span class="min-w-0 flex-1 text-meta text-soft" :class="open ? 'break-words' : 'line-clamp-2'">{{ text }}</span>
      <span v-if="doing.ways > 1" class="shrink-0 text-meta text-faint">{{ doing.ways }}×</span>
    </template>
    <template v-if="always || conditions.length" #below="{ open }">
      <span v-if="always" class="font-sans text-meta text-muted">always</span>
      <span v-else class="font-mono text-meta break-words text-muted" :class="!open && 'line-clamp-2'"
        >when {{ conditions[0]
        }}<span v-if="conditions.length > 1" class="font-sans text-faint">
          · {{ conditions.length - 1 }} more {{ conditions.length === 2 ? "way" : "ways" }}</span
        ></span
      >
    </template>
    <template v-if="conditions.length > 1" #detail>
      <span v-for="(c, i) in conditions.slice(1, CASES + 1)" :key="i" class="break-words">or when {{ c }}</span>
      <span v-if="conditions.length > CASES + 1" class="font-sans text-faint"
        >and {{ conditions.length - CASES - 1 }} more</span
      >
    </template>
  </BehaviourRow>
</template>
