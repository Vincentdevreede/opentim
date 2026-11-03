<script setup lang="ts">
import LabBadge from "../components/LabBadge.vue";
import PageHeader from "../components/PageHeader.vue";
import LabPlaceholder from "../components/LabPlaceholder.vue";
import { resources } from "../library.ts";
import LabButton from "../components/LabButton.vue";

defineProps<{ title: string; description: string }>();
</script>

<template>
  <PageHeader :title="title">
    <template #subtitle>{{ description }}</template>
    <LabBadge status="unsupported" label="planned" />
  </PageHeader>
  <div class="flex flex-1 items-center justify-center p-10">
    <LabPlaceholder title="Not available yet" large>
      This view needs a decoder for the original file format, which hasn’t been ported to the lab yet.
      <template v-if="resources.length">Use Files to inspect the raw bytes in the meantime.</template>
      <template v-if="resources.length" #action>
        <LabButton to="/files" class="mt-1">Open Files</LabButton>
      </template>
    </LabPlaceholder>
  </div>
</template>
