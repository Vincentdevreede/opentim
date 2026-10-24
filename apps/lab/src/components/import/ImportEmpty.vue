<script setup lang="ts">
import logo from "@opentim/theme/opentim-logo.png";
import { CONFIDENCE_HELP } from "../../kinds.ts";
import { canPersist, pickFiles } from "../../library.ts";
import { dragging } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabKbd from "../LabKbd.vue";
import PageHeader from "../PageHeader.vue";
import PanelTitle from "../PanelTitle.vue";
import StorageNotice from "./StorageNotice.vue";

const STEPS = [
  ["Unzip your copy", "of the game into a normal folder."],
  ["Select every RESOURCE file", "from that one folder. Mixing versions isn’t supported."],
  ["Inspect.", "Overview lists every resource inside, and Files shows their raw bytes."],
];
</script>

<template>
  <PageHeader title="Import">
    <template #subtitle>Load one game version to start inspecting</template>
    <LabBadge status="unsupported" label="No files loaded" />
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-auto px-10 pt-10 pb-8">
    <div class="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-6">
      <section aria-labelledby="pick-title" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <img :src="logo" alt="OpenTIM" class="mb-2 block w-[260px] rounded-lg border border-line-strong" />
          <h2 id="pick-title" class="text-display font-semibold tracking-[-.01em]">
            Open your copy of The Incredible Machine
          </h2>
          <p class="max-w-[560px] text-lead text-soft">
            Select the RESOURCE files of one game version. The lab reads them in your browser and lists every sprite,
            screen, palette and level inside.
          </p>
        </div>

        <StorageNotice v-if="!canPersist" />

        <div
          class="flex flex-col items-center gap-3.5 rounded-[10px] border-[1.5px] border-dashed px-8 py-9 text-center"
          :class="dragging ? 'border-accent bg-accent/8' : 'border-line-strong bg-sunken'"
        >
          <div class="flex gap-1.5 font-mono text-2xs" aria-hidden="true">
            <div
              class="flex h-[66px] w-[54px] -rotate-6 items-end justify-center rounded-[5px] border border-line-strong bg-raised pb-2 text-soft"
            >
              .001
            </div>
            <div
              class="flex h-[66px] w-[54px] items-end justify-center rounded-[5px] border border-accent bg-raised pb-2 text-accent"
            >
              .002
            </div>
            <div
              class="flex h-[66px] w-[54px] rotate-6 items-end justify-center rounded-[5px] border border-line-strong bg-raised pb-2 text-soft"
            >
              .00x
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-heading-sm font-semibold">Select all RESOURCE files at once</div>
            <div class="font-mono text-ui text-soft">RESOURCE.001 · RESOURCE.002 · … · RESOURCE.00x</div>
          </div>
          <LabButton variant="primary" size="lg" @click="pickFiles"
            ><LabIcon name="folder" :size="15" :stroke="2" />Select RESOURCE files…</LabButton
          >
          <div class="text-ui text-muted">
            or drop them anywhere in this window · <LabKbd>Ctrl</LabKbd> <LabKbd>O</LabKbd>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2.5 text-soft">
          <div class="flex flex-col gap-1.5 rounded-lg border border-line bg-sunken p-3">
            <div class="flex items-center gap-1.5 font-semibold text-decoded">
              <LabIcon name="check" :size="14" :stroke="2.25" />Accepted
            </div>
            <div>
              <span class="font-mono text-ink">RESOURCE.001</span> to
              <span class="font-mono text-ink">RESOURCE.00x</span>, all from the same game folder.
            </div>
          </div>
          <div class="flex flex-col gap-1.5 rounded-lg border border-line bg-sunken p-3">
            <div class="flex items-center gap-1.5 font-semibold text-error">
              <LabIcon name="x" :size="14" :stroke="2.25" />Not accepted
            </div>
            <div>
              <span class="font-mono text-ink">.ZIP</span> archives — unzip first. The game
              <span class="font-mono text-ink">.EXE</span> isn’t needed.
            </div>
          </div>
          <div class="flex flex-col gap-1.5 rounded-lg border border-line bg-sunken p-3">
            <div class="flex items-center gap-1.5 font-semibold text-ink">
              <LabIcon name="lock" :size="14" :stroke="2" />Stays on your machine
            </div>
            <div>
              {{
                canPersist
                  ? "Files are read in this browser and kept there for next time."
                  : "Files are read in this browser tab only."
              }}
              Nothing is uploaded.
            </div>
          </div>
        </div>
      </section>

      <aside class="flex flex-col gap-4 pt-1">
        <section class="overflow-hidden rounded-[10px] border border-line bg-sunken">
          <div class="flex h-[34px] items-center border-b border-line px-3">
            <PanelTitle>Before you start</PanelTitle>
          </div>
          <ol class="flex flex-col py-1.5">
            <li v-for="([title, text], i) in STEPS" :key="i" class="flex gap-2.5 px-3 py-2">
              <span
                class="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-raised font-mono text-2xs text-accent"
              >
                {{ i + 1 }}
              </span>
              <span class="text-soft"
                ><b class="font-semibold text-ink">{{ title }}</b> {{ text }}</span
              >
            </li>
          </ol>
        </section>

        <section class="overflow-hidden rounded-[10px] border border-line bg-sunken">
          <div class="flex h-[34px] items-center border-b border-line px-3">
            <PanelTitle>Data confidence</PanelTitle>
          </div>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 py-1.5">
            <template v-for="item in CONFIDENCE_HELP" :key="item.status">
              <dt class="py-[7px] pl-3"><LabBadge :status="item.status" /></dt>
              <dd class="py-[7px] pr-3 text-soft">{{ item.text }}</dd>
            </template>
          </dl>
        </section>

        <p class="px-0.5 text-ui text-muted">
          OpenTIM ships no game assets. Everything you see here comes from the files you load.
        </p>
      </aside>
    </div>
  </div>
</template>
