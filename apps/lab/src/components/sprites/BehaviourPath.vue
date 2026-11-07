<script setup lang="ts">
import { computed } from "vue";
import type { WalkPath } from "../../behaviour.ts";
import { endText } from "../../behaviour-view.ts";

/** The frames a walk shows, as numbers that show the frame, and how it ends. */
const props = defineProps<{
  path: WalkPath;
  /** The ids of the part's frames, to link a state to its frame. */
  frames: number[];
  /** Whether every frame shows, rather than the first few. */
  full?: boolean;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

/** Frames past this many show as a count on a closed row. */
const SHOWN = 8;
const shown = computed(() => (props.full ? props.path.frames : props.path.frames.slice(0, SHOWN)));
const hidden = computed(() => props.path.frames.length - shown.value.length);
const end = computed(() => endText(props.path));
</script>

<template>
  <span class="inline-flex min-w-0 flex-wrap items-center gap-x-1 font-mono text-meta">
    <template v-for="(state, i) in shown" :key="i">
      <span v-if="i > 0" class="text-faint" aria-hidden="true">→</span>
      <button
        v-if="frames.includes(state)"
        type="button"
        class="cursor-pointer text-ink hover:text-accent hover:underline"
        :title="`Show frame ${state}`"
        @click.stop="emit('showFrame', state)"
        @keydown.stop
      >
        {{ state }}
      </button>
      <span v-else class="text-ink">{{ state }}</span>
    </template>
    <span v-if="hidden > 0" class="text-faint">→ {{ hidden }} more</span>
    <span v-if="path.frames.length" class="text-faint" aria-hidden="true">·</span>
    <span :class="path.end === 'stop' ? 'text-faint' : 'text-accent'">{{ end }}</span>
  </span>
</template>
