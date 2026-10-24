<script setup lang="ts">
import { computed } from "vue";
import { GROUPS } from "../../kinds.ts";
import { cancel, foundSoFar, progress } from "../../library.ts";
import { formatBytes } from "../../ui.ts";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import PageHeader from "../PageHeader.vue";
import PanelTitle from "../PanelTitle.vue";

const total = computed(() => progress.value.reduce((sum, f) => sum + f.size, 0));
const done = computed(() => progress.value.filter((f) => f.state === "done"));
const percent = computed(() =>
  total.value ? Math.round((done.value.reduce((sum, f) => sum + f.size, 0) / total.value) * 100) : 0,
);
const counts = computed(() =>
  GROUPS.map((g) => ({ ...g, count: foundSoFar.value.filter((r) => r.group === g.id).length })),
);
</script>

<template>
  <PageHeader title="Import">
    <template #subtitle>Reading {{ progress.length }} files</template>
    <LabButton @click="cancel">Cancel</LabButton>
  </PageHeader>
  <div class="h-0.5 shrink-0 bg-sunken">
    <div
      class="h-0.5 animate-stripes bg-[repeating-linear-gradient(-45deg,var(--color-accent)_0_6px,var(--color-accent-dark)_6px_12px)] bg-size-[34px_4px] transition-[width]"
      :style="{ width: `${Math.max(percent, 4)}%` }"
    ></div>
  </div>

  <div class="min-h-0 flex-1 overflow-auto px-10 py-12">
    <div class="mx-auto flex max-w-[760px] flex-col gap-[18px]">
      <div class="flex items-end gap-4">
        <div class="flex flex-1 flex-col gap-1">
          <h2 class="text-heading-lg font-semibold">Reading resource archives…</h2>
          <p class="text-soft">Indexing the entries of each archive locally. Nothing is decoded yet.</p>
        </div>
        <div class="font-mono text-percent leading-none font-medium text-accent">
          {{ percent }}<span class="text-title text-muted">%</span>
        </div>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-[3px] bg-raised"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Overall progress"
      >
        <span class="block h-full rounded-[3px] bg-accent transition-[width]" :style="{ width: `${percent}%` }"></span>
      </div>

      <section class="overflow-hidden rounded-lg border border-line bg-sunken">
        <div class="flex h-8 items-center gap-2 border-b border-line px-3">
          <PanelTitle>Files</PanelTitle>
          <div class="flex-1"></div>
          <span class="font-mono text-meta text-muted">{{ done.length }} of {{ progress.length }} done</span>
        </div>
        <div
          v-for="file in progress"
          :key="file.name"
          class="grid grid-cols-[20px_minmax(0,1fr)_220px_92px_70px] items-center gap-x-3 border-b border-hover px-3 py-[9px] last:border-b-0"
          :class="file.state === 'reading' && 'bg-accent/6'"
        >
          <LabIcon v-if="file.state === 'done'" name="check" :size="16" :stroke="2.5" class="text-decoded" />
          <LabIcon
            v-else-if="file.state === 'reading'"
            name="spinner"
            :size="16"
            :stroke="2.5"
            class="animate-spin text-accent"
          />
          <span v-else class="ml-[3px] size-2 rounded-full border-[1.5px] border-line-strong"></span>
          <span class="font-mono" :class="file.state === 'queued' ? 'text-soft' : 'text-ink'">{{ file.name }}</span>
          <div class="h-1 overflow-hidden rounded-xs bg-raised">
            <span v-if="file.state === 'done'" class="block h-full w-full bg-decoded"></span>
            <span
              v-else-if="file.state === 'reading'"
              class="block h-full w-full animate-stripes bg-[repeating-linear-gradient(-45deg,var(--color-accent)_0_6px,var(--color-accent-dark)_6px_12px)] bg-size-[34px_4px]"
            ></span>
          </div>
          <span class="text-right font-mono" :class="file.state === 'queued' ? 'text-muted' : 'text-soft'"
            >{{ formatBytes(file.size) }} B</span
          >
          <span
            class="text-right"
            :class="{ done: 'text-decoded', reading: 'text-accent', queued: 'text-muted' }[file.state]"
            >{{ file.state }}</span
          >
        </div>
      </section>

      <section class="rounded-lg border border-line bg-sunken">
        <div class="flex h-8 items-center gap-2 border-b border-line px-3">
          <PanelTitle>Found so far</PanelTitle>
          <div class="flex-1"></div>
          <span class="font-mono text-ink">{{ foundSoFar.length }}</span
          ><span class="text-muted">resources</span>
        </div>
        <div class="grid grid-cols-7">
          <div v-for="g in counts" :key="g.id" class="flex flex-col gap-0.5 border-r border-hover p-3 last:border-r-0">
            <span class="font-mono text-heading-lg">{{ g.count }}</span
            ><span class="text-muted">{{ g.label.toLowerCase() }}</span>
          </div>
        </div>
      </section>

      <div class="flex items-center gap-2 text-muted">
        <LabIcon name="lock" :size="14" :stroke="2" />
        <span>Processed in this tab. No network requests are made with your files.</span>
      </div>
    </div>
  </div>
</template>
