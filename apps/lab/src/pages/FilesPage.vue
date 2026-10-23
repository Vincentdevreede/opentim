<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import HexView from "../components/HexView.vue";
import { clearLibrary, files, importFiles, readFile, refresh } from "../library.ts";

const filter = ref("");
const selected = ref<string>();
const data = shallowRef<Uint8Array>();
const dragging = ref(false);
const busy = ref(false);

onMounted(refresh);

const visible = computed(() => {
  const q = filter.value.toLowerCase();
  return files.value.filter((f) => f.path.toLowerCase().includes(q));
});

async function load(list: FileList | null | undefined) {
  if (!list?.length) return;
  busy.value = true;
  try {
    await importFiles(list);
  } finally {
    busy.value = false;
  }
}

async function select(path: string) {
  selected.value = path;
  data.value = await readFile(path);
}

async function clear() {
  if (!confirm("Remove all loaded game files from this browser?")) return;
  await clearLibrary();
  selected.value = undefined;
  data.value = undefined;
}
</script>

<template>
  <div class="flex h-full">
    <section class="flex w-96 shrink-0 flex-col border-r border-slate-800">
      <div
        class="m-3 rounded-lg border-2 border-dashed p-4 text-center text-sm"
        :class="dragging ? 'border-amber-400 bg-slate-900' : 'border-slate-700'"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="dragging = false; load($event.dataTransfer?.files)"
      >
        <p class="text-slate-300">Drop the original game files here, or</p>
        <div class="mt-2 flex justify-center gap-2">
          <label class="cursor-pointer rounded bg-amber-500 px-3 py-1 font-semibold text-slate-900 hover:bg-amber-400">
            Choose folder
            <input type="file" webkitdirectory class="hidden" @change="load(($event.target as HTMLInputElement).files)" />
          </label>
          <label class="cursor-pointer rounded bg-slate-800 px-3 py-1 hover:bg-slate-700">
            Choose files
            <input type="file" multiple class="hidden" @change="load(($event.target as HTMLInputElement).files)" />
          </label>
        </div>
        <p v-if="busy" class="mt-2 text-amber-300">Importing…</p>
      </div>

      <div class="flex items-center gap-2 px-3 pb-2">
        <input
          v-model="filter"
          placeholder="Filter files"
          class="min-w-0 flex-1 rounded bg-slate-900 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-amber-400"
        />
        <button v-if="files.length" class="text-xs text-slate-400 hover:text-red-400" @click="clear">Clear</button>
      </div>

      <ul class="flex-1 overflow-y-auto text-sm">
        <li v-for="file in visible" :key="file.path">
          <button
            class="flex w-full justify-between gap-2 px-3 py-1 text-left hover:bg-slate-900"
            :class="{ 'bg-slate-800': file.path === selected }"
            @click="select(file.path)"
          >
            <span class="truncate">{{ file.path }}</span>
            <span class="shrink-0 text-slate-500">{{ file.size.toLocaleString() }}</span>
          </button>
        </li>
        <li v-if="!files.length" class="px-3 py-2 text-slate-500">No files loaded yet.</li>
      </ul>
    </section>

    <section class="min-w-0 flex-1 overflow-auto p-4">
      <template v-if="selected && data">
        <h2 class="mb-3 font-semibold">{{ selected }}</h2>
        <HexView :data="data" />
      </template>
      <p v-else class="text-slate-500">Select a file to inspect its bytes.</p>
    </section>
  </div>
</template>
