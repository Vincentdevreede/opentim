<script setup lang="ts">
import LabIcon from "./LabIcon.vue";

defineOptions({ inheritAttrs: false });
defineProps<{ label: string; options: { value: string; label: string }[] }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <label class="relative inline-flex items-center">
    <span class="sr-only">{{ label }}</span>
    <select
      v-model="model"
      v-bind="$attrs"
      class="h-[26px] cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-sunken pr-[26px] pl-2 text-ui text-ink focus-visible:outline-offset-0"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <LabIcon name="chevronDown" :size="12" :stroke="2.5" class="pointer-events-none absolute right-2 text-muted" />
  </label>
</template>
