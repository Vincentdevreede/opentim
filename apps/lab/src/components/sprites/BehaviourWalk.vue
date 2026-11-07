<script setup lang="ts">
import { computed } from "vue";
import type { WalkPath } from "../../behaviour.ts";
import { namedTermLines, readTerm, START_WORDS, type WalkRow } from "../../behaviour-view.ts";
import BehaviourPath from "./BehaviourPath.vue";
import BehaviourRow from "./BehaviourRow.vue";

/**
 * A walk from a trigger: where it starts, the frames it shows and how it ends, with the condition it needs under it.
 * Opened, it shows why it stops and the path under each condition where it splits.
 */
const props = defineProps<{
  row: WalkRow;
  frames: number[];
  sides?: readonly string[];
  highlight?: boolean;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

/** Cases past this many are counted rather than listed. */
const CASES = 8;
const read = (terms: readonly string[]) => terms.map((t) => readTerm(t, props.sides)).join(" and ");
const condition = computed(() => read(props.row.shared));
/** Branches one and two levels down, each with how far it is moved in. */
const branches = computed(() => {
  const list: { depth: number; condition: string; path: WalkPath }[] = [];
  const add = (path: WalkPath, depth: number) => {
    for (const b of path.branches) {
      list.push({ depth, condition: read(b.condition) || "otherwise", path: b.path });
      add(b.path, depth + 1);
    }
  };
  add(props.row.path, 0);
  return list;
});
const tip = computed(() => {
  const r = props.row;
  const lines = [...r.about.slice(0, 2), "", `Starts ${START_WORDS[r.start]}.`];
  if (r.variants.length) lines.push(`${r.variants.length} cases follow this path.`);
  if (r.path.branches.length) lines.push(`Splits ${r.path.branches.length} ways on an input the analysis can't tell.`);
  // The lab's names in the conditions, with the analysis's own form.
  const named = namedTermLines([condition.value, ...branches.value.map((b) => b.condition), ...r.variants.map(read)]);
  if (named.length) lines.push("", ...named);
  lines.push("", `${r.confidence}. Click for why it ends there.`);
  return lines.join("\n");
});
</script>

<template>
  <BehaviourRow :confidence="row.confidence" :tip="tip" :highlight="highlight" indent>
    <template #default="{ open }">
      <span class="w-14 shrink-0 text-meta text-faint">{{ START_WORDS[row.start] }}</span>
      <BehaviourPath
        :path="row.path"
        :frames="frames"
        :full="open"
        class="flex-1"
        @show-frame="emit('showFrame', $event)"
      />
      <span v-if="row.variants.length" class="shrink-0 text-meta text-faint">{{ row.variants.length }}×</span>
    </template>
    <template v-if="condition" #below="{ open }">
      <span class="font-mono text-meta break-words text-muted" :class="!open && 'line-clamp-2'">{{ condition }}</span>
    </template>
    <template #detail>
      <p v-if="row.path.reason" class="font-sans break-words">{{ row.path.reason }}</p>
      <div v-for="(b, i) in branches" :key="i" class="flex flex-col" :style="{ paddingLeft: `${b.depth * 14}px` }">
        <span class="break-words text-soft">when {{ b.condition }}</span>
        <BehaviourPath :path="b.path" :frames="frames" full @show-frame="emit('showFrame', $event)" />
        <span v-if="b.path.reason && b.path.end !== 'branches'" class="font-sans break-words text-faint">{{
          b.path.reason
        }}</span>
      </div>
      <template v-if="row.variants.length">
        <span class="font-sans text-soft">{{ row.variants.length }} cases:</span>
        <span v-for="(v, i) in row.variants.slice(0, CASES)" :key="`c${i}`" class="break-words"
          >{{ i === 0 ? "when" : "or when" }} {{ read(v) || "nothing more" }}</span
        >
        <span v-if="row.variants.length > CASES" class="font-sans text-faint"
          >and {{ row.variants.length - CASES }} more</span
        >
      </template>
      <p v-for="d in row.descriptions.filter((d) => d !== row.path.reason)" :key="d" class="font-sans break-words">
        {{ d }}
      </p>
    </template>
  </BehaviourRow>
</template>
