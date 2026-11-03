<script setup lang="ts">
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabSlider from "../LabSlider.vue";
import LabToggle from "../LabToggle.vue";

/**
 * The bar under a stage that steps through frames or sprites: previous, play, next, a slider and a counter like
 * `3 / 10`. The slot adds lines below it, like an explanation and more controls.
 */
defineProps<{ count: number; noun: string; counter: string }>();
const position = defineModel<number>("position", { required: true });
const playing = defineModel<boolean>("playing", { required: true });
const emit = defineEmits<{ move: [step: number] }>();
</script>

<template>
  <div class="flex shrink-0 flex-col gap-2 border-t border-line bg-sunken px-3 py-2.5">
    <div class="flex items-center gap-1.5">
      <LabButton icon :aria-label="`Previous ${noun}`" :disabled="count < 2" @click="emit('move', -1)">
        <LabIcon name="chevronLeft" />
      </LabButton>
      <LabToggle v-model="playing" icon :aria-label="playing ? 'Pause preview' : 'Play preview'" :disabled="count < 2">
        <LabIcon :name="playing ? 'pause' : 'play'" :size="12" :stroke="0" class="fill-current" />
      </LabToggle>
      <LabButton icon :aria-label="`Next ${noun}`" :disabled="count < 2" @click="emit('move', 1)">
        <LabIcon name="chevronRight" />
      </LabButton>
      <LabSlider
        v-model="position"
        :label="noun"
        hide-label
        :max="Math.max(0, count - 1)"
        :disabled="count < 2"
        class="flex-1"
      />
      <span class="min-w-11 text-right font-mono whitespace-nowrap">{{ counter }}</span>
    </div>
    <slot />
  </div>
</template>
