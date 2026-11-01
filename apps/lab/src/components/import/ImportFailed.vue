<script setup lang="ts">
import { dismiss, failure, pickFiles, resources, staging } from "../../library.ts";
import { formatBytes } from "../../ui.ts";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import PageHeader from "../PageHeader.vue";
import LabBox from "../LabBox.vue";
import LabDisclosure from "../LabDisclosure.vue";
import LabAlert from "../LabAlert.vue";
import RequirementList from "./RequirementList.vue";
import LabListRow from "../LabListRow.vue";

const OUTCOME = {
  read: { icon: "check", class: "text-decoded" },
  rejected: { icon: "x", class: "text-error" },
  failed: { icon: "warning", class: "text-error" },
  skipped: { icon: "minus", class: "text-muted" },
} as const;
</script>

<template>
  <PageHeader title="Import">
    <template #subtitle>Couldn’t load this selection</template>
  </PageHeader>

  <div v-if="failure" class="min-h-0 flex-1 overflow-auto px-10 py-12">
    <div class="mx-auto flex max-w-[760px] flex-col gap-4">
      <LabAlert large :title="failure.title">
        <p class="text-lead">{{ failure.message }}</p>
        <div class="mt-1 flex items-center gap-2">
          <LabButton variant="primary" size="lg" @click="pickFiles"
            ><LabIcon name="folder" />Select all RESOURCE files…</LabButton
          >
          <LabButton variant="ghost" size="lg" @click="dismiss">{{
            staging ? "Back to the files found" : resources.length ? "Keep current files" : "Start over"
          }}</LabButton>
        </div>
      </LabAlert>

      <LabBox v-if="failure.received.length" title="What we received">
        <LabListRow
          v-for="item in failure.received"
          :key="item.name"
          :name="item.name"
          name-width="170px"
          class="last:border-b-0"
        >
          <span class="min-w-0 font-sans text-ui">{{ item.detail }}</span>
          <template #lead>
            <LabIcon :name="OUTCOME[item.outcome].icon" :class="OUTCOME[item.outcome].class" />
          </template>
          <template #end>
            <span class="w-[110px] shrink-0 text-right font-mono text-meta text-muted">{{
              item.size === undefined ? "—" : `${formatBytes(item.size)} B`
            }}</span>
          </template>
        </LabListRow>
      </LabBox>

      <LabBox v-if="failure.requirements.length" title="Required to continue">
        <RequirementList :requirements="failure.requirements" />
      </LabBox>

      <LabDisclosure v-if="failure.log.length" title="Technical details">
        <pre class="px-3 py-2.5 font-mono text-meta whitespace-pre-wrap text-soft">{{ failure.log.join("\n") }}</pre>
      </LabDisclosure>
    </div>
  </div>
</template>
