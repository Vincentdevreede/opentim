<script setup lang="ts" generic="T extends string">
/** Tabs over a panel. The slot puts more on the right of the tab row, like keyboard hints. */
defineProps<{ label: string; options: { value: T; label: string; disabled?: boolean }[] }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="flex shrink-0 items-center gap-1 border-b border-line px-3" role="tablist" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      :aria-selected="model === o.value"
      :disabled="o.disabled"
      class="-mb-px h-10 cursor-pointer border-b-2 px-2 text-label font-semibold tracking-[.07em] uppercase disabled:cursor-default disabled:opacity-40"
      :class="model === o.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
    <template v-if="$slots.default">
      <div class="flex-1"></div>
      <slot />
    </template>
  </div>
</template>
