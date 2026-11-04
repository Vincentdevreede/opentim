<script setup lang="ts">
import { RECORD_FIELDS, type RecordField, type TypeRecord } from "@opentim/content";
import { computed } from "vue";
import LabIcon from "../LabIcon.vue";
import LabTip from "../LabTip.vue";

/** A part's 58-byte record in the program's type table, in groups of fields that belong together. */
const props = defineProps<{
  record?: TypeRecord;
}>();

const hex = (n: number, digits: number) => n.toString(16).padStart(digits, "0");

/** The groups of the record, by where their fields are. */
const GROUPS: { title: string; from: number; to: number }[] = [
  { title: "Physics", from: 0x00, to: 0x0c },
  { title: "Resizing", from: 0x0c, to: 0x14 },
  { title: "Drawing", from: 0x14, to: 0x20 },
  { title: "Parts bin", from: 0x20, to: 0x22 },
  // The six code pointers from 0x22 are the routines on the behaviour tab, so they aren't repeated here.
];
const POINTERS = new Set([0x14, 0x16, 0x18, 0x1a]);
const LAYERS = new Set([0x1c, 0x1d]);

/** A field's value as it reads best: a number, an address, or "none" for an empty pointer or unused layer. */
function shown(bytes: Uint8Array, field: RecordField) {
  const at = field.offset;
  const word = (o: number) => bytes[o]! | (bytes[o + 1]! << 8);
  const value = field.size === 1 ? bytes[at]! : word(at);
  const raw = `0x${hex(value, field.size * 2)}`;
  if (POINTERS.has(at)) return { text: value ? raw : "none", raw };
  if (LAYERS.has(at)) return { text: value === 0xff ? "none" : String(value), raw };
  return { text: String(value > 0x7fff ? value - 0x10000 : value), raw };
}

const groups = computed(() => {
  const bytes = props.record?.bytes;
  if (!bytes) return [];
  return GROUPS.map((g) => ({
    title: g.title,
    rows: RECORD_FIELDS.filter((f) => f.offset >= g.from && f.offset < g.to).map((f) => {
      const value = shown(bytes, f);
      return {
        field: f,
        value: value.text,
        tip: `${f.note}\n\n+0x${hex(f.offset, 2)}, ${f.size} ${f.size === 1 ? "byte" : "bytes"}: ${value.raw}`,
      };
    }),
  }));
});

const KNOWN: Record<RecordField["known"], { class: string; tip: string }> = {
  checked: { class: "rounded-full bg-decoded", tip: "Checked: the program’s own code uses it this way." },
  guess: {
    class: "rotate-45 rounded-[1px] border-[1.5px] border-hypothesis",
    tip: "A guess from patterns in the values. The code hasn’t shown it yet.",
  },
  unknown: { class: "rounded-full border-[1.5px] border-faint", tip: "Unknown." },
};

/** The record as rows of 16 bytes. */
const dump = computed(() => {
  const bytes = props.record?.bytes;
  if (!bytes) return [];
  return Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => ({
    offset: hex(row * 16, 2),
    bytes: [...bytes.subarray(row * 16, row * 16 + 16)].map((b) => hex(b, 2)).join(" "),
  }));
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="!record" class="text-muted">
      The parts weren’t read from the program, so there is no record to show. Add
      <span class="font-mono text-ink">TIM.EXE</span> to the import to see it.
    </p>
    <template v-else>
      <section v-for="g in groups" :key="g.title" class="flex flex-col">
        <h3 class="pb-1 text-label font-semibold tracking-[.07em] text-faint uppercase">{{ g.title }}</h3>
        <div
          v-for="{ field, value, tip } in g.rows"
          :key="field.offset"
          class="flex h-7 items-center gap-2 border-t border-line-soft text-ui"
        >
          <LabTip :text="KNOWN[field.known].tip">
            <span class="box-border inline-block size-1.5 shrink-0" :class="KNOWN[field.known].class"></span>
          </LabTip>
          <span class="min-w-0 truncate text-ink">{{ field.name }}</span>
          <LabTip :text="tip">
            <span class="cursor-help text-faint hover:text-ink"><LabIcon name="info" :size="14" :stroke="2" /></span>
          </LabTip>
          <span class="flex-1"></span>
          <span class="font-mono whitespace-nowrap" :class="value === 'none' ? 'text-faint' : 'text-ink'">{{
            value
          }}</span>
        </div>
      </section>
      <details class="text-meta text-muted">
        <summary class="cursor-pointer">Raw bytes, at 0x{{ hex(record.at, 5) }} in the unpacked program</summary>
        <pre class="mt-1.5 overflow-auto rounded-md border border-line bg-surface p-2 font-mono"><template
          v-for="row in dump" :key="row.offset"><span class="text-muted">{{ row.offset }}</span>  {{ row.bytes }}
</template></pre>
      </details>
    </template>
  </div>
</template>
