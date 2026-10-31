<script setup lang="ts" generic="T extends string | number">
/** Buttons of which one is pressed, like a zoom level. */
defineProps<{ label: string; options: { value: T; label: string; title?: string; disabled?: boolean }[] }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div
    class="inline-flex overflow-hidden rounded-[5px] border border-line-strong bg-sunken"
    role="group"
    :aria-label="label"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="h-6 min-w-[28px] cursor-pointer border-r border-line px-2 text-ui last:border-r-0 disabled:cursor-default disabled:opacity-40"
      :class="model === o.value ? 'bg-accent font-semibold text-accent-ink' : 'text-soft hover:bg-hover hover:text-ink'"
      :aria-pressed="model === o.value"
      :title="o.title"
      :disabled="o.disabled"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
