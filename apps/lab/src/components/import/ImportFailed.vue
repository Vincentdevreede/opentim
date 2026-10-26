<script setup lang="ts">
import { dismiss, failure, pickFiles, resources, staging } from "../../library.ts";
import { formatBytes } from "../../ui.ts";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import PageHeader from "../PageHeader.vue";
import PanelTitle from "../PanelTitle.vue";

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
      <section role="alert" class="flex gap-3.5 rounded-[10px] border border-error/45 bg-error/7 p-5">
        <LabIcon name="warning" :size="22" :stroke="2" class="mt-px text-error" />
        <div class="flex flex-1 flex-col gap-2.5">
          <div class="flex flex-col gap-1">
            <h2 class="text-heading font-semibold text-error">{{ failure.title }}</h2>
            <p class="text-lead">{{ failure.message }}</p>
          </div>
          <div class="flex items-center gap-2">
            <LabButton variant="primary" size="lg" @click="pickFiles"
              ><LabIcon name="folder" :size="15" :stroke="2" />Select all RESOURCE files…</LabButton
            >
            <LabButton variant="ghost" size="lg" @click="dismiss">{{
              staging ? "Back to the files found" : resources.length ? "Keep current files" : "Start over"
            }}</LabButton>
          </div>
        </div>
      </section>

      <section v-if="failure.received.length" class="overflow-hidden rounded-lg border border-line bg-sunken">
        <div class="flex h-8 items-center border-b border-line px-3"><PanelTitle>What we received</PanelTitle></div>
        <div
          v-for="item in failure.received"
          :key="item.name"
          class="grid grid-cols-[20px_170px_minmax(0,1fr)_110px] items-center gap-x-3 border-b border-hover px-3 py-[9px] last:border-b-0"
        >
          <LabIcon :name="OUTCOME[item.outcome].icon" :size="16" :stroke="2.25" :class="OUTCOME[item.outcome].class" />
          <span class="truncate font-mono" :class="item.outcome === 'skipped' && 'text-soft'">{{ item.name }}</span>
          <span :class="item.outcome === 'skipped' ? 'text-muted' : 'text-soft'">{{ item.detail }}</span>
          <span class="text-right font-mono text-muted">{{
            item.size === undefined ? "—" : `${formatBytes(item.size)} B`
          }}</span>
        </div>
      </section>

      <section v-if="failure.requirements.length" class="overflow-hidden rounded-lg border border-line bg-sunken">
        <div class="flex h-8 items-center border-b border-line px-3"><PanelTitle>Required to continue</PanelTitle></div>
        <ul class="py-1">
          <li v-for="req in failure.requirements" :key="req.label" class="flex items-center gap-2.5 px-3 py-[7px]">
            <span class="w-11 text-right font-mono" :class="req.count ? 'text-decoded' : 'text-error'">{{
              req.count
            }}</span>
            <span>{{ req.label }}</span>
            <span class="text-muted"
              >—
              <template v-for="(part, i) in req.hint.split('`')" :key="i"
                ><span v-if="i % 2" class="font-mono">{{ part }}</span
                ><template v-else>{{ part }}</template></template
              >
            </span>
          </li>
        </ul>
      </section>

      <details v-if="failure.log.length" class="rounded-lg border border-line bg-sunken">
        <summary class="cursor-pointer px-3 py-[9px] text-soft">Technical details</summary>
        <pre class="border-t border-line px-3 py-2.5 font-mono text-meta whitespace-pre-wrap text-soft">{{
          failure.log.join("\n")
        }}</pre>
      </details>
    </div>
  </div>
</template>
