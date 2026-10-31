<script setup lang="ts">
import { RECORD_FIELDS, type RecordField, type TypeRecord } from "@opentim/content";
import { computed } from "vue";
import PanelTitle from "../PanelTitle.vue";

/** A part's 58-byte record in the program's type table, field by field. */
const props = defineProps<{
  record?: TypeRecord;
  /** The name of the program the record comes from, like `TIM.EXE`. */
  source?: string;
}>();

const hex = (n: number, digits: number) => n.toString(16).padStart(digits, "0");

/** The value of a field: a byte or word as hex and decimal, a far pointer as segment:offset. */
function fieldValue(bytes: Uint8Array, field: RecordField) {
  const at = field.offset;
  const word = (o: number) => bytes[o]! | (bytes[o + 1]! << 8);
  if (field.size === 1) return { hex: hex(bytes[at]!, 2), decimal: String(bytes[at]) };
  if (field.size === 4) return { hex: `${hex(word(at + 2), 4)}:${hex(word(at), 4)}`, decimal: "" };
  const value = word(at);
  const signed = value > 0x7fff ? value - 0x10000 : value;
  return { hex: hex(value, 4), decimal: signed === value ? String(value) : `${value} / ${signed}` };
}

const KNOWN: Record<RecordField["known"], { class: string; title: string }> = {
  checked: { class: "rounded-full bg-decoded", title: "Checked: confirmed by reading the part lists from every build" },
  guess: {
    class: "rotate-45 rounded-[1px] border-[1.5px] border-hypothesis",
    title: "Guess from the Sprite Lab research, not checked",
  },
  unknown: { class: "rounded-full border-[1.5px] border-faint", title: "Unknown" },
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
  <div class="flex flex-col gap-1.5">
    <PanelTitle>Record in {{ source ?? "the program" }}</PanelTitle>
    <p v-if="!record" class="text-muted">
      The parts weren’t read from the program, so there is no record to show. Add
      <span class="font-mono text-ink">TIM.EXE</span> to the import to see it.
    </p>
    <template v-else>
      <p class="text-meta text-muted">
        58 bytes at <span class="font-mono text-ink">0x{{ hex(record.at, 5) }}</span> in the unpacked program.
      </p>
      <table class="w-full font-mono text-meta">
        <tbody>
          <tr
            v-for="field in RECORD_FIELDS"
            :key="field.offset"
            class="border-t border-line-soft align-top"
            :title="field.note"
          >
            <td class="py-1 pr-1.5 text-muted">{{ hex(field.offset, 2) }}</td>
            <td class="py-1 pr-1.5">
              <span class="flex items-center gap-1.5 font-sans">
                <span
                  class="box-border inline-block size-1.5 shrink-0"
                  :class="KNOWN[field.known].class"
                  :title="KNOWN[field.known].title"
                ></span>
                <span :class="field.known === 'unknown' ? 'text-faint' : 'text-ink'">{{ field.name }}</span>
              </span>
            </td>
            <td class="py-1 text-right whitespace-nowrap">{{ fieldValue(record.bytes, field).hex }}</td>
            <td class="py-1 pl-1.5 text-right whitespace-nowrap text-muted">
              {{ fieldValue(record.bytes, field).decimal }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="text-meta text-muted">
        A round dot is checked, a diamond is a guess from the Sprite Lab research. Hover a field for more.
      </p>
      <pre class="overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-meta"><template
        v-for="row in dump" :key="row.offset"><span class="text-muted">{{ row.offset }}</span>  {{ row.bytes }}
</template></pre>
    </template>
  </div>
</template>
