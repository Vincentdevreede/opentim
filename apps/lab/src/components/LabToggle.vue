<script setup lang="ts">
import LabButton from "./LabButton.vue";

/** A button that stays pressed while it is on, like Flip or Grid. Other attributes, like `title`, go to the button. */
withDefaults(defineProps<{ icon?: boolean }>(), { icon: false });
const on = defineModel<boolean>({ required: true });
</script>

<template>
  <LabButton
    :icon="icon"
    :aria-pressed="on"
    :class="on && 'border-accent! bg-accent/12! text-accent!'"
    @click="on = !on"
  >
    <slot />
  </LabButton>
</template>
