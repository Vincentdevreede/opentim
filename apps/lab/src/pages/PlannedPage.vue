<script setup lang="ts">
import LabBadge from "../components/LabBadge.vue";
import PageHeader from "../components/PageHeader.vue";
import { resources } from "../library.ts";

defineProps<{ title: string; description: string }>();
</script>

<template>
  <PageHeader :title="title">
    <template #subtitle>{{ description }}</template>
    <LabBadge status="unsupported" label="planned" />
  </PageHeader>
  <div class="flex flex-1 items-center justify-center p-10">
    <div
      class="flex max-w-md flex-col items-center gap-3 rounded-[10px] border border-dashed border-line-strong bg-sunken px-8 py-10 text-center"
    >
      <p class="text-heading-sm font-semibold">Not available yet</p>
      <p class="text-soft">
        This view needs a decoder for the original file format, which hasn’t been ported to the lab yet.
        <template v-if="resources.length">Use Files to inspect the raw bytes in the meantime.</template>
      </p>
      <RouterLink
        v-if="resources.length"
        to="/files"
        class="mt-1 inline-flex h-[26px] items-center rounded-[5px] border border-line-strong bg-raised px-[9px] text-ink hover:bg-raised-hover"
      >
        Open Files
      </RouterLink>
    </div>
  </div>
</template>
