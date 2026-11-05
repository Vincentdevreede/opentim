<script setup lang="ts">
import { computed } from "vue";
import type { OtherEffect } from "../../behaviour.ts";
import LabChip from "../LabChip.vue";
import BehaviourRow from "./BehaviourRow.vue";

/**
 * One thing another part does to this one without changing its frame, like the explosion's push: the part's name,
 * what it sets and the value, with a chip for what either part must be. It opens to the source's whole condition.
 */
const props = defineProps<{ effect: OtherEffect; name: string }>();

const tip = computed(() =>
  [
    props.effect.description,
    ...(props.effect.awayWithin === undefined
      ? []
      : [
          `It points from the ${props.name.toLowerCase()}'s centre to this part's, within ${props.effect.awayWithin}°.`,
        ]),
    "",
    `When the ${props.name.toLowerCase()} has: ${props.effect.sourceCondition}`,
    "",
    `${props.effect.confidence}. No walk: it changes no frame.`,
  ].join("\n"),
);
</script>

<template>
  <BehaviourRow :confidence="effect.confidence" :tip="tip">
    <!-- The chips go on to a second line only when the panel is too narrow for them. -->
    <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span class="flex min-w-0 items-baseline gap-x-2">
        <span class="shrink-0 text-ink">{{ name }}</span>
        <span v-for="s in effect.sets" :key="s.what" class="font-mono text-meta whitespace-nowrap"
          ><span class="text-muted">{{ s.what }}</span> <span class="text-accent">{{ s.value }}</span></span
        >
      </span>
      <span v-if="effect.sourceWhen.length || effect.when.length" class="ml-auto flex gap-1">
        <LabChip v-for="w in effect.sourceWhen" :key="`source ${w}`" tone="faint">{{ w }}</LabChip>
        <LabChip v-for="w in effect.when" :key="w">{{ w }}</LabChip>
      </span>
    </span>
    <template #detail>
      <span class="break-words">when {{ name.toLowerCase() }}: {{ effect.sourceCondition }}</span>
    </template>
  </BehaviourRow>
</template>
