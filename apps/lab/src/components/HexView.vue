<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{ data: Uint8Array }>();

const BYTES_PER_ROW = 16;
const PAGE = 4096;
const limit = ref(PAGE);
watch(() => props.data, () => (limit.value = PAGE));

const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, "0");

const rows = computed(() => {
  const out: { offset: string; bytes: string; ascii: string }[] = [];
  const end = Math.min(props.data.length, limit.value);
  for (let i = 0; i < end; i += BYTES_PER_ROW) {
    const chunk = props.data.subarray(i, Math.min(i + BYTES_PER_ROW, end));
    out.push({
      offset: hex(i, 8),
      bytes: Array.from(chunk, (b) => hex(b, 2)).join(" "),
      ascii: Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join(""),
    });
  }
  return out;
});
</script>

<template>
  <div class="font-mono text-xs leading-5">
    <div v-for="row in rows" :key="row.offset" class="flex gap-4 whitespace-pre">
      <span class="text-slate-500">{{ row.offset }}</span>
      <span class="w-[47ch] text-slate-200">{{ row.bytes }}</span>
      <span class="text-amber-300">{{ row.ascii }}</span>
    </div>
    <button
      v-if="limit < data.length"
      class="mt-3 rounded bg-slate-800 px-3 py-1 font-sans text-slate-200 hover:bg-slate-700"
      @click="limit += PAGE"
    >
      Show more ({{ (data.length - limit).toLocaleString() }} bytes left)
    </button>
  </div>
</template>
