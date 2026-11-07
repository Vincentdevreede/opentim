<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { FOLD_ROWS, startGroups, type WalkRow } from "../../behaviour-view.ts";
import LabChip from "../LabChip.vue";
import LabListRow from "../LabListRow.vue";
import BehaviourWalk from "./BehaviourWalk.vue";

/**
 * The walks from one trigger: a row that opens to them, one walk a line. A trigger with many walks, like the
 * jack-in-the-box's run with every input case, folds them by where they start, so each fold is a short list.
 */
const props = defineProps<{
  trigger: string;
  rows: WalkRow[];
  frames: number[];
  sides?: readonly string[];
  /** The frame on the stage, to point out the walks that start from it. */
  current?: number;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const open = ref(true);
/** The folds that are open; all start closed. */
const opened = reactive(new Set<string>());
const toggle = (key: string) => (opened.has(key) ? opened.delete(key) : opened.add(key));
const count = (rows: readonly WalkRow[]) => rows.reduce((n, r) => n + Math.max(1, r.variants.length), 0);
const walks = computed(() => count(props.rows));
const folds = computed(() => (props.rows.length > FOLD_ROWS ? startGroups(props.rows) : undefined));
/**
 * The trigger as a short heading and what it needs as a line below, so a hit with a place, like "hit by a
 * teeter-totter, when its positionX is 0 to 12 pixels left of the teeter-totter's right end (positionX + 74)", doesn't
 * fill the heading.
 */
const heading = computed(() => {
  const at = props.trigger.indexOf(", when ");
  return at < 0
    ? { name: props.trigger, when: undefined }
    : { name: props.trigger.slice(0, at), when: props.trigger.slice(at + 2) };
});
/** Whether a walk starts from the frame on the stage. */
const startsHere = (frames: readonly number[]) => props.current !== undefined && frames[0] === props.current;
</script>

<template>
  <section class="flex flex-col">
    <LabListRow :expanded="open" @click="open = !open">
      <span class="flex min-w-0 flex-col">
        <span class="font-mono font-semibold text-ink">{{ heading.name }}</span>
        <span v-if="heading.when" class="text-meta break-words text-muted">{{ heading.when }}</span>
      </span>
      <template #end>
        <LabChip tone="accent">{{ walks }} {{ walks === 1 ? "walk" : "walks" }}</LabChip>
        <LabChip v-if="rows.length < walks" tone="faint">{{ rows.length }} paths</LabChip>
      </template>
    </LabListRow>
    <div v-if="open" class="flex flex-col border-b border-line-soft pb-1.5 [&>*:first-child]:border-t-0">
      <template v-if="folds">
        <template v-for="f in folds" :key="f.key">
          <LabListRow
            :expanded="opened.has(f.key)"
            :indent="1"
            class="border-t border-b-0! border-line-soft"
            @click="toggle(f.key)"
          >
            <span
              class="text-meta"
              :class="f.first !== undefined && f.first === current ? 'text-accent' : 'text-soft'"
              >{{ f.label }}</span
            >
            <template #end>
              <LabChip tone="faint">{{ count(f.rows) }} {{ count(f.rows) === 1 ? "walk" : "walks" }}</LabChip>
            </template>
          </LabListRow>
          <template v-if="opened.has(f.key)">
            <BehaviourWalk
              v-for="row in f.rows"
              :key="row.key"
              :row="row"
              :frames="frames"
              :sides="sides"
              :highlight="startsHere(row.path.frames)"
              @show-frame="emit('showFrame', $event)"
            />
          </template>
        </template>
      </template>
      <template v-else>
        <BehaviourWalk
          v-for="row in rows"
          :key="row.key"
          :row="row"
          :frames="frames"
          :sides="sides"
          :highlight="startsHere(row.path.frames)"
          @show-frame="emit('showFrame', $event)"
        />
      </template>
    </div>
  </section>
</template>
