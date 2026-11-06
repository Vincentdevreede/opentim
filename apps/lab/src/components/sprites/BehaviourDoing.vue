<script setup lang="ts">
import { computed } from "vue";
import type { Doing } from "../../behaviour.ts";
import BehaviourRow from "./BehaviourRow.vue";

/**
 * One thing the part does, in the analysis's own sentence: a part it creates, or what it does to itself or another
 * part. The closed line shows two lines of it and opens to the rest; the tip says how many ways give it.
 */
const props = defineProps<{ doing: Doing }>();

/** Under "Creates" the sentence starts with what it creates, like "A bullet (type 20) at …". */
const text = computed(() => {
  const d = props.doing.description;
  if (props.doing.on !== "created") return d;
  const rest = d.replace(/^Creates /, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
});
const tip = computed(() =>
  [
    props.doing.description,
    "",
    `${props.doing.ways} ${props.doing.ways === 1 ? "way" : "ways"} through its routines, ${props.doing.confidence}.`,
  ].join("\n"),
);
</script>

<template>
  <BehaviourRow :confidence="doing.confidence" :tip="tip">
    <template #default="{ open }">
      <span class="min-w-0 flex-1 text-meta text-soft" :class="open ? 'break-words' : 'line-clamp-2'">{{ text }}</span>
      <span v-if="doing.ways > 1" class="shrink-0 text-meta text-faint">{{ doing.ways }}×</span>
    </template>
  </BehaviourRow>
</template>
