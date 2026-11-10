<script setup lang="ts">
import { computed } from "vue";
import { program } from "../library.ts";
import { readProgress } from "../read-progress.ts";
import LabIcon from "./LabIcon.vue";

/**
 * How far the read of the program's behaviour has come, the same on every tab that waits for it: a bar, the step and
 * what it is at, and about how long is left. `compact` is one line for the status bar. Before the read's first word
 * it shows the start.
 */
defineProps<{ compact?: boolean }>();

const p = computed(() => readProgress.value);
const percent = computed(() => Math.floor((p.value?.fraction ?? 0) * 100));
const exe = computed(() => program.value?.name ?? "the program");
</script>

<template>
  <span v-if="compact" class="flex items-center gap-1.5 text-ink">
    <LabIcon name="spinner" :size="12" class="animate-spin text-accent" />
    Reading behaviour
    <span class="h-1.5 w-20 overflow-hidden rounded-full bg-well" aria-hidden="true">
      <span class="block h-full bg-accent" :style="{ width: `${percent}%` }"></span>
    </span>
    <span class="font-mono">{{ percent }} %</span>
    <span v-if="p" class="text-muted">· {{ p.left.replace(/^About/, "about") }}</span>
  </span>
  <div v-else role="status" class="flex flex-col gap-1.5">
    <p class="flex items-center gap-2 text-ink">
      <LabIcon name="spinner" :size="14" :stroke="2.25" class="animate-spin text-accent" />
      Reading the behaviour from {{ exe }}
    </p>
    <div
      class="h-1.5 overflow-hidden rounded-full bg-well"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Reading the behaviour, ${percent} %`"
    >
      <div class="h-full bg-accent transition-[width] duration-500" :style="{ width: `${percent}%` }"></div>
    </div>
    <p class="flex gap-2 text-meta text-muted">
      <span class="min-w-0 flex-1">
        <template v-if="p">
          Step {{ p.step }} of {{ p.steps }} · {{ p.name }}<template v-if="p.detail"> · {{ p.detail }}</template>
        </template>
        <template v-else>Starting</template>
      </span>
      <span class="font-mono text-ink">{{ percent }} %</span>
    </p>
    <p v-if="p" class="text-meta text-faint">{{ p.left }}</p>
  </div>
</template>
