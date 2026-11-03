<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import LabField from "./LabField.vue";
import LabIcon from "./LabIcon.vue";
import LabKbd from "./LabKbd.vue";

/**
 * The search field of a page: a search icon, and the `/` key to jump into it from anywhere on the page, unless the
 * focus is already in a field.
 */
withDefaults(defineProps<{ label: string; placeholder?: string }>(), { placeholder: "Search…" });
const model = defineModel<string>({ default: "" });
const field = useTemplateRef<InstanceType<typeof LabField>>("field");

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  field.value?.focus();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <LabField ref="field" v-model="model" :label="label" type="search" :placeholder="placeholder">
    <template #prefix><LabIcon name="search" /></template>
    <template #suffix><LabKbd>/</LabKbd></template>
  </LabField>
</template>
