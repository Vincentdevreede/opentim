<script setup lang="ts">
import logo from "@opentim/theme/opentim-logo.png";
import { computed, ref } from "vue";
import { catalogEntry, editionHint, editionLanguages, editionName, type Edition } from "../../edition.ts";
import { CONFIDENCE_HELP, GROUPS, type Confidence } from "../../kinds.ts";
import {
  canAddFiles,
  canPersist,
  cancel,
  chooseLanguage,
  confirmImport,
  discard,
  foundSoFar,
  mapHasProblems,
  needsLanguage,
  offersAddOn,
  phase,
  pickFiles,
  progress,
  resources,
  saving,
  staging,
} from "../../library.ts";
import { dragging, formatBytes } from "../../ui.ts";
import LabBadge from "../LabBadge.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabKbd from "../LabKbd.vue";
import PageHeader from "../PageHeader.vue";
import PanelTitle from "../PanelTitle.vue";
import StorageNotice from "./StorageNotice.vue";

const STEPS = [
  ["Unzip your copy", "of the game into a normal folder."],
  [
    "Select every RESOURCE file",
    "and the program, like TIM.EXE, from that one folder. Mixing versions isn’t supported.",
  ],
  ["Check and continue.", "The lab tells which game it found. Then Overview lists every resource inside."],
];

const VERSION_BADGES: Record<Edition["status"], { status: Confidence; label: string }> = {
  recognized: { status: "decoded", label: "known version" },
  incomplete: { status: "partial", label: "incomplete" },
  unknown: { status: "hypothesis", label: "unknown version" },
};

/** `FRENCH` becomes "French". */
const languageName = (language: string) => language.charAt(0) + language.slice(1).toLowerCase();

const reading = computed(() => phase.value === "reading");
/** True when something needs a look before continuing: a missing language, missing files, or a mismatch. */
const attention = computed(() => {
  const s = staging.value;
  if (!s) return false;
  return !!s.error || needsLanguage(s) || s.edition.status === "incomplete" || mapHasProblems(s);
});

const copied = ref(false);
async function copyEntry() {
  if (!staging.value) return;
  await navigator.clipboard.writeText(catalogEntry(staging.value.files));
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
const total = computed(() => progress.value.reduce((sum, f) => sum + f.size, 0));
const done = computed(() => progress.value.filter((f) => f.state === "done"));
const percent = computed(() =>
  total.value ? Math.round((done.value.reduce((sum, f) => sum + f.size, 0) / total.value) * 100) : 0,
);
const counts = computed(() => {
  const list = reading.value ? foundSoFar.value : (staging.value?.resources ?? []);
  return GROUPS.map((g) => ({ ...g, count: list.filter((r) => r.group === g.id).length }));
});
</script>

<template>
  <PageHeader title="Import">
    <template #subtitle>
      {{
        reading
          ? `Reading ${progress.length} files`
          : staging
            ? "Check what was found and continue"
            : "Load your game files to start inspecting"
      }}
    </template>
    <LabButton v-if="resources.length" variant="ghost" @click="discard">Back to Overview</LabButton>
    <LabBadge v-else-if="!reading && !staging" status="unsupported" label="No files loaded" />
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
            Select the RESOURCE files of your game and its program. The lab reads them in your browser and lists every
            sprite, screen, palette and level inside.
          </p>
        </div>

        <StorageNotice v-if="!canPersist" />

        <section
          v-if="reading"
          aria-label="Reading files"
          class="flex flex-col gap-3.5 rounded-[10px] border border-line-strong bg-sunken p-5"
        >
          <div class="flex items-end gap-4">
            <div class="flex flex-1 flex-col gap-1">
              <h3 class="text-heading font-semibold">Reading resource archives…</h3>
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
            <span
              class="block h-full rounded-[3px] bg-accent transition-[width]"
              :style="{ width: `${percent}%` }"
            ></span>
          </div>
          <div class="overflow-hidden rounded-lg border border-line bg-well">
            <div
              v-for="file in progress"
              :key="file.name"
              class="grid grid-cols-[20px_minmax(0,1fr)_92px_70px] items-center gap-x-3 border-b border-hover px-3 py-[7px] last:border-b-0"
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
              <span class="text-right font-mono" :class="file.state === 'queued' ? 'text-muted' : 'text-soft'"
                >{{ formatBytes(file.size) }} B</span
              >
              <span
                class="text-right"
                :class="{ done: 'text-decoded', reading: 'text-accent', queued: 'text-muted' }[file.state]"
                >{{ file.state }}</span
              >
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-muted"
              ><span class="font-mono text-ink">{{ foundSoFar.length }}</span> resources found so far</span
            >
            <div class="flex-1"></div>
            <LabButton @click="cancel">Cancel</LabButton>
          </div>
        </section>

        <section
          v-else-if="staging"
          aria-labelledby="found-title"
          class="flex flex-col gap-4 rounded-[10px] border p-5"
          :class="[
            attention ? 'border-partial/45 bg-partial/7' : 'border-decoded/45 bg-decoded/7',
            dragging && 'ring-2 ring-accent',
          ]"
        >
          <div class="flex gap-3.5">
            <LabIcon
              :name="attention ? 'warning' : 'check'"
              :size="22"
              :stroke="2.25"
              class="mt-0.5"
              :class="attention ? 'text-partial' : 'text-decoded'"
            />
            <div class="flex flex-1 flex-col gap-1">
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 id="found-title" class="text-heading font-semibold" :title="editionHint(staging.edition)">
                  <span class="font-normal text-muted">Found game:</span> {{ editionName(staging.edition)
                  }}<span v-if="editionLanguages(staging.edition)" class="font-normal text-muted">
                    · {{ editionLanguages(staging.edition) }}</span
                  >
                </h3>
                <LabBadge v-bind="VERSION_BADGES[staging.edition.status]" />
              </div>
              <p class="text-soft">
                <span class="font-mono text-ink">{{ staging.resources.length }}</span> resources from
                <span class="font-mono text-ink">{{ staging.files.length }}</span>
                {{ staging.files.length === 1 ? "file" : "files" }} · read in {{ staging.seconds.toFixed(1) }} s
              </p>
            </div>
          </div>

          <div v-if="staging.languages.length" class="flex flex-col gap-2">
            <p>
              <b class="font-semibold" :class="needsLanguage(staging) ? 'text-partial' : 'text-ink'">{{
                needsLanguage(staging) ? "Choose a language." : "Language installed."
              }}</b>
              These are installation disks. The lab unpacks the language’s files, like the game’s installer does.
            </p>
            <div role="group" aria-label="Language" class="flex flex-wrap gap-2">
              <LabButton
                v-for="language in staging.languages"
                :key="language"
                :variant="staging.language === language ? 'primary' : 'default'"
                :aria-pressed="staging.language === language"
                @click="chooseLanguage(language)"
                >{{ languageName(language) }}</LabButton
              >
            </div>
          </div>

          <div class="grid grid-cols-7 overflow-hidden rounded-lg border border-line bg-well">
            <div
              v-for="g in counts"
              :key="g.id"
              class="flex flex-col gap-0.5 border-r border-hover p-2.5 last:border-r-0"
            >
              <span class="font-mono text-heading">{{ g.count }}</span
              ><span class="text-meta text-muted">{{ g.label.toLowerCase() }}</span>
            </div>
          </div>

          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 font-mono text-meta text-soft">
            <template v-for="f in staging.files" :key="f.name">
              <span>{{ f.name }}</span
              ><span class="text-muted">{{ formatBytes(f.size) }} B</span>
            </template>
          </div>

          <p
            v-if="staging.replaced.length"
            class="text-soft"
            :title="staging.replaced.map((r) => `${r.name} (${r.archive})`).join(', ')"
          >
            <span class="font-mono text-ink">{{ staging.replaced.length }}</span> resources were replaced by the same
            resource in a later archive.
          </p>

          <ul v-if="!needsLanguage(staging)" class="flex flex-col gap-1 text-soft">
            <li v-if="staging.edition.status === 'incomplete'" class="flex gap-2">
              <LabIcon name="warning" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-partial" />
              <span
                >Not a complete version.
                <template v-for="(c, i) in staging.edition.candidates.slice(0, 3)" :key="c.profile.id"
                  >{{ i ? " Or " : "It looks like " }}<b class="font-semibold text-ink">{{ c.profile.name }}</b
                  >, without <span class="font-mono text-ink">{{ c.missing.join(", ") }}</span
                  >.</template
                >
                You can still continue.</span
              >
            </li>
            <li v-else-if="staging.edition.status === 'unknown'" class="flex gap-2">
              <LabIcon name="warning" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-hypothesis" />
              <span>This version isn’t in the catalog yet. You can still continue.</span>
            </li>
            <li v-if="!staging.map" class="flex gap-2">
              <LabIcon name="minus" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-muted" />
              <span
                >No <span class="font-mono text-ink">RESOURCE.MAP</span> selected. With it, the lab checks that the
                archives belong together.</span
              >
            </li>
            <li v-else-if="!staging.map.missing.length && !staging.map.problems.length" class="flex gap-2">
              <LabIcon name="check" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-decoded" />
              <span>The archives match <span class="font-mono text-ink">RESOURCE.MAP</span>.</span>
            </li>
            <template v-else>
              <li v-if="staging.map.missing.length" class="flex gap-2">
                <LabIcon name="warning" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-partial" />
                <span
                  ><span class="font-mono text-ink">RESOURCE.MAP</span> lists resources in
                  <span class="font-mono text-ink">{{ staging.map.missing.join(", ") }}</span
                  >, which {{ staging.map.missing.length === 1 ? "wasn’t" : "weren’t" }} selected.</span
                >
              </li>
              <li v-for="problem in staging.map.problems" :key="problem" class="flex gap-2">
                <LabIcon name="warning" :size="14" :stroke="2.25" class="mt-[3px] shrink-0 text-partial" />
                <span>{{ problem }}</span>
              </li>
            </template>
          </ul>

          <div v-if="staging.error" role="alert" class="flex flex-col gap-1.5">
            <p>
              <b class="font-semibold text-partial">{{ staging.error.title }}.</b> {{ staging.error.message }}
            </p>
            <ul>
              <li v-for="req in staging.error.requirements" :key="req.label" class="flex items-center gap-2.5 py-0.5">
                <span class="w-8 text-right font-mono" :class="req.count ? 'text-decoded' : 'text-error'">{{
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
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <LabButton
              v-if="!staging.error"
              variant="primary"
              size="lg"
              :disabled="saving || needsLanguage(staging) || mapHasProblems(staging)"
              @click="confirmImport"
            >
              <LabIcon v-if="saving" name="spinner" :size="15" :stroke="2.5" class="animate-spin" />
              <LabIcon v-else name="check" :size="15" :stroke="2.25" />{{ saving ? "Loading…" : "Continue" }}
            </LabButton>
            <LabButton
              v-if="canAddFiles(staging)"
              :variant="staging.error ? 'primary' : 'default'"
              size="lg"
              :disabled="saving"
              @click="pickFiles"
              ><LabIcon name="folder" :size="15" :stroke="2" />{{
                offersAddOn(staging) ? "Add the Add-On…" : "Add more files…"
              }}</LabButton
            >
            <LabButton variant="ghost" size="lg" @click="discard">Start over</LabButton>
          </div>
          <p v-if="offersAddOn(staging)" class="text-ui text-muted">
            Have the Add-On Disk for The Incredible Machine 1.00? Add its RESOURCE files too, or drop them in this
            window. A file with the same name replaces the one above.
          </p>

          <details :open="staging.edition.status !== 'recognized'" class="group rounded-lg border border-line bg-well">
            <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-soft select-none hover:text-ink">
              <span class="transition-transform group-open:rotate-90" aria-hidden="true">›</span>
              File hashes (SHA-256)
            </summary>
            <div class="flex flex-col gap-2.5 border-t border-line px-3 pt-2.5 pb-3">
              <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-meta">
                <template v-for="f in staging.files" :key="f.name">
                  <span class="text-soft">{{ f.name }}</span
                  ><span class="truncate text-muted" :title="f.sha256">{{ f.sha256 }}</span>
                </template>
              </div>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <LabButton @click="copyEntry">{{ copied ? "Copied" : "Copy catalog entry" }}</LabButton>
                <span class="text-ui text-muted"
                  >Version not recognised? Fill in its name and languages, and add the entry to
                  <span class="font-mono">apps/lab/src/version-catalog.json</span> in a pull request.</span
                >
              </div>
            </div>
          </details>
        </section>

        <div
          v-else
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
            <div class="text-heading-sm font-semibold">Select all game files at once</div>
            <div class="font-mono text-ui text-soft">RESOURCE.001 · … · RESOURCE.00x · RESOURCE.MAP · TIM.EXE</div>
          </div>
          <LabButton variant="primary" size="lg" @click="pickFiles"
            ><LabIcon name="folder" :size="15" :stroke="2" />Select game files…</LabButton
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
              Every <span class="font-mono text-ink">RESOURCE</span> file, like
              <span class="font-mono text-ink">RESOURCE.001</span> and
              <span class="font-mono text-ink">RESOURCE.MAP</span>, and the language files, like
              <span class="font-mono text-ink">GERMAN.RES</span> or <span class="font-mono text-ink">ENGLISH.DAT</span>.
              Add the program, <span class="font-mono text-ink">TIM.EXE</span>, to read the parts from it.
            </div>
          </div>
          <div class="flex flex-col gap-1.5 rounded-lg border border-line bg-sunken p-3">
            <div class="flex items-center gap-1.5 font-semibold text-error">
              <LabIcon name="x" :size="14" :stroke="2.25" />Not accepted
            </div>
            <div>
              <span class="font-mono text-ink">.ZIP</span> archives: unzip them first. Other programs than the game’s,
              like <span class="font-mono text-ink">INSTALL.EXE</span>.
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
