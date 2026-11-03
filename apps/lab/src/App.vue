<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import pkg from "../package.json";
import LabFact from "./components/LabFact.vue";
import LabFacts from "./components/LabFacts.vue";
import LabIcon from "./components/LabIcon.vue";
import LabKbd from "./components/LabKbd.vue";
import LabPanelHeader from "./components/LabPanelHeader.vue";
import { editionHint, editionLanguages, editionName } from "./edition.ts";
import type { IconName } from "./icons.ts";
import {
  edition,
  failure,
  foundSoFar,
  importFiles,
  needsLanguage,
  phase,
  pickFiles,
  progress,
  resources,
  staging,
} from "./library.ts";
import { crumb, dragging } from "./ui.ts";
import LabDot from "./components/LabDot.vue";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  needsFiles?: boolean;
  planned?: boolean;
}

const FILES: NavItem[] = [
  { to: "/", label: "Import", icon: "import" },
  { to: "/files", label: "Files", icon: "files", needsFiles: true },
];
const RESOURCES: NavItem[] = [
  { to: "/sprites", label: "Sprites", icon: "sprites", needsFiles: true },
  { to: "/audio", label: "Audio", icon: "audio", needsFiles: true },
  { to: "/levels", label: "Levels", icon: "levels", needsFiles: true },
];
const TOOLS: NavItem[] = [{ to: "/sandbox", label: "Sandbox", icon: "sandbox", needsFiles: true }];

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["Ctrl", "O"], action: "Open RESOURCE files" },
  { keys: ["/"], action: "Filter resources (Overview, Sprites, Levels)" },
  { keys: ["↑", "↓", "↵"], action: "Move and view bytes (Overview)" },
  { keys: ["←", "→"], action: "Previous or next frame (Sprites)" },
  { keys: ["Space"], action: "Play or pause the preview (Sprites)" },
  { keys: ["1", "4"], action: "Zoom 1× to 4× (Sprites)" },
  { keys: ["H"], action: "Flip horizontally (Sprites)" },
  { keys: ["O"], action: "Show the previous frame faintly (Sprites)" },
  { keys: ["/"], action: "Filter sounds (Audio)" },
  { keys: ["↑", "↓"], action: "Previous or next sound (Audio)" },
  { keys: ["Space"], action: "Play or pause the sample (Audio)" },
  { keys: ["G"], action: "Go to offset (Files)" },
  { keys: ["←", "→", "↑", "↓"], action: "Move the byte selection (Files)" },
  { keys: ["PgUp", "PgDn"], action: "Move one screen (Files)" },
  { keys: ["Space"], action: "Play or pause (Sandbox)" },
  { keys: ["."], action: "Step one tick (Sandbox)" },
  { keys: ["R"], action: "Reset (Sandbox)" },
];

const router = useRouter();
const showKeys = ref(false);
const hasFiles = computed(() => resources.value.length > 0);
const readingIndex = computed(() => progress.value.findIndex((f) => f.state !== "done") + 1 || progress.value.length);

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragging.value = true;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  void router.push("/");
  void importFiles(files);
}

function onDragLeave(e: DragEvent) {
  if (!e.relatedTarget) dragging.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    void router.push("/");
    pickFiles();
  }
}

onMounted(() => {
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
  window.removeEventListener("keydown", onKeydown);
});

const navClass =
  "relative mx-1.5 flex flex-col items-center gap-1 rounded-md pt-2 pb-[7px] text-2xs font-medium text-muted hover:bg-hover hover:text-ink";
const activeClass =
  "bg-raised! text-ink before:absolute before:top-2.5 before:bottom-2.5 before:-left-1.5 before:w-0.5 before:rounded-r-sm before:bg-accent [&_svg]:text-accent";
</script>

<template>
  <div class="flex h-full min-w-[1280px] flex-col bg-surface">
    <div class="flex min-h-0 flex-1">
      <nav aria-label="Views" class="flex w-[72px] shrink-0 flex-col gap-1 border-r border-line bg-sunken pt-2.5 pb-2">
        <div class="mb-1.5 flex flex-col items-center gap-1 border-b border-line pt-0.5 pb-3">
          <svg
            width="27"
            height="27"
            viewBox="0 0 9 9"
            shape-rendering="crispEdges"
            role="img"
            aria-label="OpenTIM Lab"
          >
            <path
              class="fill-accent"
              d="M3 0h3v1H3zM1 1h1v1H1zM3 1h3v1H3zM7 1h1v1H7zM2 2h5v1H2zM0 3h4v1H0zM5 3h4v1H5zM0 4h3v1H0zM6 4h3v1H6zM0 5h4v1H0zM5 5h4v1H5zM2 6h5v1H2zM1 7h1v1H1zM3 7h3v1H3zM7 7h1v1H7zM3 8h3v1H3z"
            />
          </svg>
          <span class="font-pixel text-[10px] tracking-[.04em]">LAB</span>
        </div>

        <template v-for="(group, i) in [FILES, RESOURCES, TOOLS]" :key="i">
          <div v-if="i > 0" class="mx-2.5 my-2 h-px bg-line"></div>
          <template v-for="item in group" :key="item.to">
            <span
              v-if="item.needsFiles && !hasFiles"
              :class="[navClass, 'pointer-events-none opacity-40']"
              aria-disabled="true"
            >
              <LabIcon :name="item.icon" :size="18" :stroke="1.75" />{{ item.label }}
            </span>
            <RouterLink
              v-else
              :to="item.to"
              :class="navClass"
              :active-class="activeClass"
              :title="item.planned ? 'Planned' : undefined"
            >
              <LabDot v-if="item.planned" status="none" class="absolute top-1.5 right-[9px]" />
              <LabIcon :name="item.icon" :size="18" :stroke="1.75" />{{ item.label }}
            </RouterLink>
          </template>
        </template>

        <div class="flex-1"></div>
        <div class="relative">
          <button
            type="button"
            :class="[navClass, 'w-[60px] cursor-pointer']"
            :aria-expanded="showKeys"
            aria-label="Keyboard shortcuts"
            @click="showKeys = !showKeys"
          >
            <LabIcon name="keyboard" :size="18" :stroke="1.75" />Keys
          </button>
          <div
            v-if="showKeys"
            class="absolute bottom-0 left-[66px] z-20 w-72 overflow-hidden rounded-lg border border-line-strong bg-sunken shadow-xl"
            @keydown.esc="showKeys = false"
          >
            <LabPanelHeader title="Keyboard shortcuts" />
            <LabFacts label-width="auto" class="px-3 py-1.5">
              <LabFact v-for="item in SHORTCUTS" :key="item.action" prose>
                <template #label
                  ><LabKbd v-for="k in item.keys" :key="k">{{ k }}</LabKbd></template
                >
                {{ item.action }}
              </LabFact>
            </LabFacts>
          </div>
        </div>
      </nav>

      <main class="flex min-w-0 flex-1 flex-col">
        <RouterView />
      </main>
    </div>

    <footer
      role="status"
      class="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-sunken px-3 text-meta text-muted"
    >
      <template v-if="phase === 'reading'">
        <span class="flex items-center gap-1.5 text-ink">
          <LabIcon name="spinner" :size="12" class="animate-spin text-accent" />
          Reading {{ readingIndex }} of {{ progress.length }} files ·
          <span class="font-mono">{{ foundSoFar.length }}</span> resources found
        </span>
      </template>
      <template v-else-if="phase === 'error'">
        <span class="flex items-center gap-1.5 text-error">
          <LabDot status="error" />Import failed · {{ failure?.title.toLowerCase() }}
        </span>
      </template>
      <template v-else-if="phase === 'staged' && staging">
        <span class="flex items-center gap-1.5 text-ink">
          <LabDot status="accent" /><span class="font-mono">{{ staging.resources.length }}</span> resources found ·
          {{ needsLanguage(staging) ? "choose a language to continue" : "press Continue to load them" }}
        </span>
      </template>
      <template v-else-if="hasFiles">
        <span class="flex items-center gap-1.5 text-ink">
          <LabDot status="decoded" /><span class="font-mono">{{ resources.length }}</span> resources loaded
        </span>
        <template v-if="edition">
          <span aria-hidden="true" class="text-line-strong">│</span>
          <span :title="editionHint(edition)"
            >Game: <span class="text-ink">{{ editionName(edition) }}</span
            ><template v-if="editionLanguages(edition)"> · {{ editionLanguages(edition) }}</template></span
          >
        </template>
      </template>
      <template v-else>
        <span class="flex items-center gap-1.5"><LabDot status="none" />No files loaded</span>
      </template>
      <template v-if="phase !== 'empty'">
        <span aria-hidden="true" class="text-line-strong">│</span>
        <span class="flex items-center gap-1"><LabIcon name="lock" :size="12" />Local only · nothing uploaded</span>
      </template>
      <div class="flex-1"></div>
      <template v-if="crumb.length">
        <span>
          <template v-for="(part, i) in crumb" :key="i">
            <template v-if="i > 0"> › </template>
            <span :class="i > 0 && 'font-mono text-ink'">{{ part }}</span>
          </template>
        </span>
        <span aria-hidden="true" class="text-line-strong">│</span>
      </template>
      <span class="font-mono">OpenTIM Lab {{ pkg.version }}</span>
    </footer>
  </div>
</template>
