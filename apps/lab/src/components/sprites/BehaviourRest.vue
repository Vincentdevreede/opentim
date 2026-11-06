<script setup lang="ts">
import { computed } from "vue";
import type { RestSummary } from "../../behaviour.ts";
import { readTerm, RESET_WORDS, restingWords, termsOf, tidyTerms, weakest } from "../../behaviour-view.ts";
import { statesText } from "../../behaviour.ts";
import BehaviourRow from "./BehaviourRow.vue";

/**
 * How a part is when the machine is put back, and the frames it comes to rest on: two short lines, with the frames that
 * can be shown as buttons, the analysis's own words in the tips and each resting frame's way there when opened.
 */
const props = defineProps<{
  rest: RestSummary;
  /** The ids of the part's frames, to link a state to its frame. */
  frames: number[];
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const placedTip = computed(() =>
  [
    props.rest.description,
    ...(props.rest.reason ? ["", props.rest.reason] : []),
    "",
    props.rest.status === "saved"
      ? "The level gives the frame."
      : props.rest.status === "sockets"
        ? "Whether plugs are in its sockets gives the frame."
        : props.rest.status === "known"
          ? "Every way through the reset gives this frame."
          : "The analysis can’t tell which frame.",
    "",
    `${props.rest.confidence}.`,
  ].join("\n"),
);
const restingConfidence = computed(() => weakest(props.rest.resting.map((r) => r.confidence)));
const restingTip = computed(() =>
  [
    "The frames it comes to rest on: where a run keeps it, or where its walks end.",
    "",
    ...props.rest.resting.slice(0, 12).map((r) => `${r.state}: ${restingWords(r)}`),
    ...(props.rest.resting.length > 12 ? [`and ${props.rest.resting.length - 12} more`] : []),
    "",
    `${restingConfidence.value}. Click for the way to each.`,
  ].join("\n"),
);
const states = computed(() => props.rest.resting.map((r) => r.state));
/** A condition on the way to a resting frame, tidied and read like a walk's. */
const tidy = (condition: string) =>
  tidyTerms(termsOf(condition))
    .map((t) => readTerm(t))
    .join(" and ");
</script>

<template>
  <div class="-mx-3 flex flex-col [&>*:first-child]:border-t-0">
    <BehaviourRow :confidence="rest.confidence" :tip="placedTip">
      <span class="w-14 shrink-0 text-meta text-faint">placed</span>
      <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 font-mono text-meta">
        <template v-if="rest.status === 'known' && rest.state !== undefined">
          <span class="font-sans text-muted">frame</span>
          <button
            v-if="frames.includes(rest.state)"
            type="button"
            class="cursor-pointer text-accent hover:underline"
            :title="`Show frame ${rest.state}`"
            @click.stop="emit('showFrame', rest.state)"
            @keydown.stop
          >
            {{ rest.state }}
          </button>
          <span v-else class="text-accent">{{ rest.state }}</span>
        </template>
        <template v-else>
          <span class="font-sans" :class="rest.status === 'unresolved' ? 'text-faint' : 'text-accent'">{{
            RESET_WORDS[rest.status as keyof typeof RESET_WORDS]
          }}</span>
          <template v-if="rest.frames?.length">
            <span class="text-faint" aria-hidden="true">·</span>
            <span class="text-ink">{{ statesText(rest.frames) }}</span>
          </template>
        </template>
      </span>
    </BehaviourRow>
    <BehaviourRow v-if="rest.resting.length" :confidence="restingConfidence" :tip="restingTip">
      <span class="w-14 shrink-0 text-meta text-faint">rests on</span>
      <span class="min-w-0 flex-1 truncate font-mono text-meta text-ink">{{ statesText(states) }}</span>
      <template #detail>
        <div v-for="r in rest.resting" :key="r.state" class="flex flex-col">
          <span class="flex flex-wrap items-baseline gap-x-1.5">
            <button
              v-if="frames.includes(r.state)"
              type="button"
              class="cursor-pointer text-ink hover:text-accent hover:underline"
              :title="`Show frame ${r.state}`"
              @click.stop="emit('showFrame', r.state)"
              @keydown.stop
            >
              {{ r.state }}
            </button>
            <span v-else class="text-ink">{{ r.state }}</span>
            <span class="font-sans text-faint">{{ restingWords(r) }}</span>
          </span>
          <span v-if="r.conditions.length" class="break-words"
            >when {{ tidy(r.conditions[0]!)
            }}<span v-if="r.conditions.length > 1" class="font-sans text-faint">
              · {{ r.conditions.length - 1 }} more {{ r.conditions.length === 2 ? "way" : "ways" }}</span
            ></span
          >
        </div>
      </template>
    </BehaviourRow>
  </div>
</template>
