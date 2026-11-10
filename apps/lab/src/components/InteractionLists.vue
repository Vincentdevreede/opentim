<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { INTERACTION_COLOURS, INTERACTION_LABELS, type InteractionPair } from "../interactions.ts";
import LabListHeading from "./LabListHeading.vue";
import BehaviourEffect from "./sprites/BehaviourEffect.vue";
import BehaviourDoing from "./sprites/BehaviourDoing.vue";

/**
 * What a part does to other parts and what they do to it, one row per other part, with how it reaches it and a
 * square for each kind. A row opens in place to its ways, as the Behaviour tab says them.
 */
const props = defineProps<{
  type: number;
  pairs: readonly InteractionPair[];
  nameOf: (type: number) => string;
}>();

const does = computed(() => props.pairs.filter((p) => p.source === props.type));
const doneTo = computed(() => props.pairs.filter((p) => p.target === props.type));
const open = ref(new Set<string>());
watch(
  () => props.type,
  () => (open.value = new Set()),
);
const key = (p: InteractionPair) => `${p.source}:${p.target}`;

function click(p: InteractionPair) {
  const next = new Set(open.value);
  if (next.has(key(p))) next.delete(key(p));
  else next.add(key(p));
  open.value = next;
}

const howWords = (p: InteractionPair) => (p.how === "touch" ? "touching" : p.how === "both" ? "both" : "reaching");
const kindWords = (p: InteractionPair) => p.kinds.map((k) => INTERACTION_LABELS[k]).join(", ");
</script>

<template>
  <template
    v-for="section in [
      { title: 'What it does to others', list: does, other: (p: InteractionPair) => p.target },
      { title: 'What others do to it', list: doneTo, other: (p: InteractionPair) => p.source },
    ]"
    :key="section.title"
  >
    <LabListHeading :title="section.title" :meta="String(section.list.length)" />
    <template v-for="p in section.list" :key="key(p)">
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-[5px] text-left hover:bg-hover"
        :class="open.has(key(p)) && 'bg-hover'"
        :title="kindWords(p)"
        :aria-expanded="open.has(key(p))"
        @click="click(p)"
      >
        <span class="min-w-0 flex-1 truncate text-soft">{{ nameOf(section.other(p)) }}</span>
        <span class="text-2xs text-faint">{{ howWords(p) }}</span>
        <span class="flex w-16 justify-end gap-[3px]">
          <span
            v-for="k in p.kinds"
            :key="k"
            class="size-2.5 rounded-[2px]"
            :style="{ background: INTERACTION_COLOURS[k] }"
          ></span>
        </span>
      </button>
      <div v-if="open.has(key(p))" class="mb-1 ml-3 border-l border-line pl-2">
        <BehaviourEffect v-for="(e, k) in p.effects" :key="k" :effect="e" :name="nameOf(p.source)" />
        <BehaviourDoing v-for="d in p.made" :key="d.description" :doing="d" />
      </div>
    </template>
    <p v-if="!section.list.length" class="px-3 py-[5px] text-muted">Nothing found</p>
  </template>
</template>
