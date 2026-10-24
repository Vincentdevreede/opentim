<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import pkg from "../package.json";
import LabIcon from "./components/LabIcon.vue";
import LabKbd from "./components/LabKbd.vue";
import type { IconName } from "./icons.ts";
import { failure, foundSoFar, importFiles, phase, pickFiles, progress, resources } from "./library.ts";
import { crumb, dragging } from "./ui.ts";

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
  { to: "/sprites", label: "Sprites", icon: "sprites", needsFiles: true, planned: true },
  { to: "/audio", label: "Audio", icon: "audio", needsFiles: true, planned: true },
  { to: "/levels", label: "Levels", icon: "levels", needsFiles: true, planned: true },
];
const TOOLS: NavItem[] = [{ to: "/sandbox", label: "Sandbox", icon: "sandbox" }];

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["Ctrl", "O"], action: "Open RESOURCE files" },
  { keys: ["/"], action: "Filter resources (Overview)" },
  { keys: ["↑", "↓", "↵"], action: "Move and view bytes (Overview)" },
  { keys: ["G"], action: "Go to offset (Files)" },
  { keys: ["←", "→", "↑", "↓"], action: "Move the byte selection (Files)" },
  { keys: ["PgUp", "PgDn"], action: "Move one screen (Files)" },
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
  "relative mx-1.5 flex flex-col items-center gap-[3px] rounded-md pt-2 pb-[7px] text-2xs font-medium text-muted hover:bg-hover hover:text-ink";
const activeClass =
  "bg-raised! text-ink before:absolute before:top-2.5 before:bottom-2.5 before:-left-1.5 before:w-0.5 before:rounded-r-sm before:bg-accent [&_svg]:text-accent";
</script>

<template>
  <div class="flex h-full min-w-[1280px] flex-col bg-surface">
    <div class="flex min-h-0 flex-1">
      <nav
        aria-label="Views"
        class="flex w-[72px] shrink-0 flex-col gap-0.5 border-r border-line bg-sunken pt-2.5 pb-2"
      >
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
              <LabIcon :name="item.icon" />{{ item.label }}
            </span>
            <RouterLink
              v-else
              :to="item.to"
              :class="navClass"
              :active-class="activeClass"
              :title="item.planned ? 'Planned' : undefined"
            >
              <span
                v-if="item.planned"
                class="absolute top-1.5 right-[9px] size-[5px] rounded-full border border-muted"
              ></span>
              <LabIcon :name="item.icon" />{{ item.label }}
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
            <LabIcon name="keyboard" />Keys
          </button>
          <div
            v-if="showKeys"
            class="absolute bottom-0 left-[66px] z-20 w-72 overflow-hidden rounded-lg border border-line-strong bg-sunken shadow-xl"
            @keydown.esc="showKeys = false"
          >
            <div
              class="flex h-8 items-center border-b border-line px-3 text-label font-semibold tracking-[.07em] text-muted uppercase"
            >
              Keyboard shortcuts
            </div>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-3">
              <template v-for="item in SHORTCUTS" :key="item.action">
                <dt class="flex gap-1">
                  <LabKbd v-for="k in item.keys" :key="k">{{ k }}</LabKbd>
                </dt>
                <dd class="text-soft">{{ item.action }}</dd>
              </template>
            </dl>
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
          <LabIcon name="spinner" :size="12" :stroke="2.5" class="animate-spin text-accent" />
          Reading {{ readingIndex }} of {{ progress.length }} files ·
          <span class="font-mono">{{ foundSoFar.length }}</span> resources found
        </span>
      </template>
      <template v-else-if="phase === 'error'">
        <span class="flex items-center gap-1.5 text-error">
          <span class="size-[7px] rounded-full bg-error"></span>Import failed · {{ failure?.title.toLowerCase() }}
        </span>
      </template>
      <template v-else-if="hasFiles">
        <span class="flex items-center gap-1.5 text-ink">
          <span class="size-[7px] rounded-full bg-decoded"></span
          ><span class="font-mono">{{ resources.length }}</span> resources loaded
        </span>
      </template>
      <template v-else>
        <span class="flex items-center gap-1.5"
          ><span class="size-[7px] rounded-full border-[1.5px] border-muted"></span>No files loaded</span
        >
      </template>
      <template v-if="phase !== 'empty'">
        <span aria-hidden="true" class="text-line-strong">│</span>
        <span class="flex items-center gap-[5px]"
          ><LabIcon name="lock" :size="12" :stroke="2" />Local only · nothing uploaded</span
        >
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
