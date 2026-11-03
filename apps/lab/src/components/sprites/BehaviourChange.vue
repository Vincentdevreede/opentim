<script setup lang="ts">
import { computed } from "vue";
import { ownTerms, termsOf, tidyTerms, type ChangeRow } from "../../behaviour-view.ts";
import BehaviourRow from "./BehaviourRow.vue";

/** A change of the part's state, led by the states it starts from or by the routine that makes it. */
const props = defineProps<{
  row: ChangeRow;
  lead: "from" | "routine";
  /** The ids of the part's frames, to link a state to its frame. */
  frames: number[];
  highlight?: boolean;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const condition = computed(() => ownTerms(props.row).join(" and ") || (props.row.variants.length ? "" : "always"));
/** A condition too long to share the line goes on a line of its own, where it can be read in full. */
const wraps = computed(() => condition.value.length > 22);
const instructions = computed(() => props.row.paths.reduce((n, p) => n + p.evidence.length, 0));
const tip = computed(() => {
  const r = props.row;
  const lines = [`${r.routine}: from ${r.fromText} ${r.target}`];
  if (r.expression) lines.push(`state = ${r.expression}`);
  lines.push(r.shared.length ? `When ${r.shared.join(" and ")}` : "Always");
  if (r.variants.length) lines.push(`and one of ${r.variants.length} cases`);
  lines.push("", `${instructions.value} instructions, ${r.confidence}. Click for every path.`);
  return lines.join("\n");
});
const address = (n: number) => `0x${n.toString(16).padStart(5, "0")}`;
</script>

<template>
  <BehaviourRow :confidence="row.confidence" :tip="tip" :highlight="highlight">
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
    >
      {{ row.target }}
    </button>
    <span v-else class="min-w-0 truncate font-mono whitespace-nowrap text-ink">{{ row.target }}</span>
    <span v-if="!wraps" class="min-w-0 flex-1 truncate font-mono text-meta text-muted">{{ condition }}</span>
    <span v-else class="flex-1"></span>
    <span v-if="row.variants.length" class="shrink-0 text-meta text-faint">{{ row.variants.length }}×</span>
    <template v-if="wraps" #below>
      <span class="line-clamp-3 font-mono text-meta break-words text-muted">{{ condition }}</span>
    </template>
    <template #detail>
      <div v-for="(path, i) in row.paths" :key="i" class="flex flex-col gap-0.5">
        <span class="break-words text-soft">{{ tidyTerms(termsOf(path.condition)).join(" and ") || "always" }}</span>
        <details>
          <summary class="cursor-pointer font-sans">
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
