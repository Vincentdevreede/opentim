<script setup lang="ts">
import { computed } from "vue";
import { ownTerms, readTerm, type ChangeRow } from "../../behaviour-view.ts";
import LabIcon from "../LabIcon.vue";
import BehaviourRow from "./BehaviourRow.vue";

/** A change of the part's state, led by the states it starts from or by the routine that makes it. */
const props = defineProps<{
  row: ChangeRow;
  lead: "from" | "routine";
  /** The ids of the part's frames, to link a state to its frame. */
  frames: number[];
  highlight?: boolean;
  /** The side each edge of the part's outline faces, when it is known. */
  sides?: readonly string[];
  /** Whether the row sits under a routine or state, with its content moved in. */
  indent?: boolean;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const read = (terms: readonly string[]) => terms.map((t) => readTerm(t, props.sides)).join(" and ");
const condition = computed(() => read(ownTerms(props.row)) || (props.row.variants.length ? "" : "always"));
/** A condition too long to share the line goes on a line of its own, where it can be read in full. */
const wraps = computed(() => condition.value.length > 22);
const instructions = computed(() => props.row.paths.reduce((n, p) => n + p.evidence.length, 0));
const tip = computed(() => {
  const r = props.row;
  const lines = [`${r.routine}: from ${r.fromText} ${r.target}`];
  if (r.expression) lines.push(`state = ${r.expression}`);
  lines.push(r.shared.length ? `When ${read(r.shared)}` : "Always");
  if (r.variants.length) lines.push(`and one of ${r.variants.length} cases`);
  lines.push("", `${instructions.value} instructions, ${r.confidence}. Click for every path.`);
  return lines.join("\n");
});
const address = (n: number) => `0x${n.toString(16).padStart(5, "0")}`;
</script>

<template>
  <BehaviourRow :confidence="row.confidence" :tip="tip" :highlight="highlight" :indent="indent">
    <template #default="{ open }">
      <span
        v-if="lead === 'from'"
        class="grid h-[18px] min-w-5 shrink-0 place-items-center rounded-[3px] border border-line bg-well px-1 font-mono text-meta text-soft"
        >{{ row.fromText }}</span
      >
      <span v-else class="shrink-0 font-mono font-semibold text-accent">{{ row.routine }}</span>
      <button
        v-if="row.toState !== undefined && frames.includes(row.toState)"
        type="button"
        class="shrink-0 cursor-pointer font-mono text-ink hover:text-accent hover:underline"
        :title="`Show frame ${row.toState}`"
        @click.stop="emit('showFrame', row.toState)"
        @keydown.stop
      >
        {{ row.target }}
      </button>
      <span v-else class="min-w-0 font-mono text-ink" :class="open ? 'break-words' : 'truncate whitespace-nowrap'">{{
        row.target
      }}</span>
      <span
        v-if="!wraps"
        class="min-w-0 flex-1 font-mono text-meta text-muted"
        :class="open ? 'break-words' : 'truncate'"
        >{{ condition }}</span
      >
      <span v-else class="flex-1"></span>
      <span v-if="row.variants.length" class="shrink-0 text-meta text-faint">{{ row.variants.length }}×</span>
    </template>
    <template v-if="wraps" #below="{ open }">
      <span class="font-mono text-meta break-words text-muted" :class="!open && 'line-clamp-3'">{{ condition }}</span>
    </template>
    <template #detail>
      <div v-for="(path, i) in row.paths" :key="i" class="flex flex-col gap-0.5">
        <span v-if="row.variants.length" class="break-words text-soft"
          >{{ i === 0 ? "when" : "or when" }} {{ read(row.variants[i] ?? []) || "nothing more" }}</span
        >
        <details class="group cursor-auto" @click.stop>
          <summary
            class="-mx-1.5 flex w-fit cursor-pointer list-none items-center gap-1 rounded px-1.5 py-0.5 font-sans transition-colors select-none hover:bg-ink/12 hover:text-ink"
          >
            <LabIcon name="chevronRight" :size="12" class="shrink-0 transition-transform group-open:rotate-90" />
            {{ path.evidence.length }} {{ path.evidence.length === 1 ? "instruction" : "instructions" }},
            {{ path.confidence }}
          </summary>
          <ol class="mt-1 flex flex-col">
            <li v-for="e in path.evidence" :key="e.address" class="flex gap-2">
              <span class="text-faint">{{ address(e.address) }}</span
              ><span>{{ e.text }}</span>
            </li>
          </ol>
          <p v-for="a in path.assumptions" :key="a" class="mt-1 font-sans">{{ a }}</p>
        </details>
      </div>
    </template>
  </BehaviourRow>
</template>
