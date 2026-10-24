<script setup lang="ts">
import { useTemplateRef } from "vue";

defineOptions({ inheritAttrs: false });
defineProps<{ label: string }>();
const model = defineModel<string>({ default: "" });
const input = useTemplateRef<HTMLInputElement>("input");
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <label
    class="flex h-[26px] items-center gap-1.5 rounded-[5px] border border-line-strong bg-sunken px-2 text-muted focus-within:border-accent focus-within:ring-1 focus-within:ring-accent"
  >
    <slot name="prefix" />
    <span class="sr-only">{{ label }}</span>
    <input
      ref="input"
      v-model="model"
      v-bind="$attrs"
      class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
    />
    <slot name="suffix" />
  </label>
</template>
