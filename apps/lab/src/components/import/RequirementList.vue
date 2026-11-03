<script setup lang="ts">
import LabListRow from "../LabListRow.vue";

/** What the import needs to continue: how many of each kind of file were found, and a hint where to find them. */
defineProps<{ requirements: readonly { label: string; count: number; hint: string }[] }>();
</script>

<template>
  <ul>
    <li v-for="req in requirements" :key="req.label" class="last:[&>*]:border-b-0">
      <LabListRow>
        <template #lead>
          <span class="w-8 shrink-0 text-right font-mono" :class="req.count ? 'text-decoded' : 'text-error'">{{
            req.count
          }}</span>
        </template>
        <span class="shrink-0 text-ink">{{ req.label }}</span>
        <span class="min-w-0 text-muted"
          ><template v-for="(part, i) in req.hint.split('`')" :key="i"
            ><span v-if="i % 2" class="font-mono">{{ part }}</span
            ><template v-else>{{ part }}</template></template
          ></span
        >
      </LabListRow>
    </li>
  </ul>
</template>
