<script setup lang="ts">
import { computed, ref } from "vue";
import { statesText, type BehaviourResult, type Change, type Instruction } from "../../behaviour.ts";
import LabIcon from "../LabIcon.vue";
import PanelTitle from "../PanelTitle.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/** What the program does with a part: its routines, how its state changes, and what starts that. */
const props = defineProps<{
  /** The analysis of the loaded program; undefined while it hasn't started. */
  result?: BehaviourResult | { status: "reading" };
  /** Why there is no analysis, when there can't be one. */
  unavailable?: string;
  type: number;
  /** The ids of the part's frames, to link a state to the frame it shows. */
  frames: number[];
  /** The frame on the stage, to point out what can happen from it. */
  current?: number;
}>();
const emit = defineEmits<{ showFrame: [id: number] }>();

const showKept = ref(false);

const summary = computed(() => (props.result?.status === "done" ? props.result.summary : undefined));
const part = computed(() => summary.value?.parts[props.type]);
const changes = computed(() => part.value?.changes.filter((c) => showKept.value || !c.keeps) ?? []);
const kept = computed(() => part.value?.changes.filter((c) => c.keeps).length ?? 0);
/** The changes by routine, in the order of the part's routines. */
const groups = computed(() => {
  const order = part.value?.routines.map((r) => r.role) ?? [];
  const byRoutine = new Map<string, Change[]>();
  for (const c of changes.value) byRoutine.set(c.routine, [...(byRoutine.get(c.routine) ?? []), c]);
  return [...byRoutine].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
});
const fromHere = (c: Change) => props.current !== undefined && (c.from === null || c.from.includes(props.current));
const isFrame = (n?: number) => n !== undefined && props.frames.includes(n);

const address = (n: number) => `0x${n.toString(16).padStart(5, "0")}`;
const instructionsTitle = (list: Instruction[]) =>
  `${list.length} ${list.length === 1 ? "instruction" : "instructions"}`;
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="unavailable" class="text-muted">{{ unavailable }}</p>
    <p v-else-if="!result || result.status === 'reading'" class="flex items-center gap-2 text-muted">
      <LabIcon name="spinner" :size="14" :stroke="2.25" class="animate-spin" />
      Reading the behaviour from the program. This takes a few seconds.
    </p>
    <p v-else-if="result.status === 'error'" class="text-error">
      Couldn’t read the behaviour: <span class="font-mono">{{ result.message }}</span>
    </p>
    <p v-else-if="!part" class="text-muted">The program has no behaviour for this part.</p>

    <template v-else>
      <p class="text-meta text-muted">
        Read from the program’s instructions without running it, in
        {{ result.status === "done" ? result.seconds.toFixed(1) : "" }} s.
        <ConfidenceMark confidence="checked" /> checked, <ConfidenceMark confidence="inferred" /> inferred,
        <ConfidenceMark confidence="unresolved" /> unresolved.
      </p>

      <section class="flex flex-col gap-1.5">
        <PanelTitle>Routines</PanelTitle>
        <div
          v-for="r in part.routines"
          :key="r.role"
          class="flex h-6 items-center gap-2 font-mono text-meta"
          :class="r.empty && 'text-faint'"
          :title="r.assumptions.join(' ')"
        >
          <ConfidenceMark :confidence="r.confidence" />
          <span class="w-12 font-sans text-ui" :class="r.empty ? 'text-faint' : 'text-ink'">{{ r.role }}?</span>
          <span>{{ r.at }}</span>
          <div class="flex-1"></div>
          <span class="font-sans">{{ r.empty ? "does nothing" : r.shared ? "shared" : "" }}</span>
        </div>
        <p class="text-meta text-muted">
          The six code pointers of the part’s record. Their roles are guesses from where the program calls them.
        </p>
      </section>

      <section class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <PanelTitle>State changes</PanelTitle>
          <div class="flex-1"></div>
          <label v-if="kept" class="flex items-center gap-1.5 text-meta text-muted">
            <input v-model="showKept" type="checkbox" class="accent-accent" />
            {{ kept }} that keep it
          </label>
        </div>
        <p v-if="!changes.length" class="text-muted">No routine changes the state.</p>
        <div v-for="[routine, list] in groups" :key="routine" class="flex flex-col gap-1">
          <span class="text-meta font-semibold text-soft">In {{ routine }}</span>
          <div
            v-for="(c, i) in list"
            :key="i"
            class="flex flex-col gap-0.5 rounded-md border px-2 py-1.5"
            :class="[
              fromHere(c) ? 'border-accent/50 bg-accent/6' : 'border-line-soft',
              c.from?.length === 0 && 'opacity-60',
            ]"
          >
            <div class="flex items-center gap-1.5 font-mono text-ui">
              <ConfidenceMark :confidence="c.confidence" />
              <span
                v-if="c.from?.length === 0"
                class="font-sans text-meta text-faint"
                title="None of this part’s frames meets the condition, so this likely changes another part’s state."
                >no own frame</span
              >
              <span v-else class="text-muted">{{ statesText(c.from) }}</span>
              <span class="text-muted">→</span>
              <button
                v-if="isFrame(c.toState)"
                type="button"
                class="cursor-pointer text-accent hover:underline"
                :title="`Show frame ${c.toState}`"
                @click="emit('showFrame', c.toState!)"
              >
                {{ c.to }}
              </button>
              <span v-else class="min-w-0 break-words" :class="c.to === 'unknown' ? 'text-faint' : 'text-ink'">{{
                c.keeps ? "unchanged" : c.to
              }}</span>
            </div>
            <span class="font-mono text-meta break-words text-muted">when {{ c.condition }}</span>
            <details class="text-meta">
              <summary class="cursor-pointer text-muted">{{ instructionsTitle(c.evidence) }}</summary>
              <ol class="mt-1 flex flex-col font-mono">
                <li v-for="e in c.evidence" :key="e.address" class="flex gap-2">
                  <span class="text-faint">{{ address(e.address) }}</span
                  ><span>{{ e.text }}</span>
                </li>
              </ol>
              <p v-for="a in c.assumptions" :key="a" class="mt-1 text-muted">{{ a }}</p>
            </details>
          </div>
        </div>
      </section>

      <section v-if="part.triggers.length" class="flex flex-col gap-1.5">
        <PanelTitle>Triggers</PanelTitle>
        <div
          v-for="(t, i) in part.triggers"
          :key="i"
          class="flex flex-col gap-0.5 text-ui"
          :title="t.assumptions.join(' ')"
        >
          <span class="flex items-center gap-1.5"
            ><ConfidenceMark :confidence="t.confidence" />{{ t.name }}
            <span class="text-muted">in {{ t.routine }}</span></span
          >
          <span v-if="t.condition" class="pl-3 font-mono text-meta break-words text-muted">when {{ t.condition }}</span>
        </div>
      </section>

      <section v-if="part.counters.length" class="flex flex-col gap-1.5">
        <PanelTitle>Counters</PanelTitle>
        <div
          v-for="c in part.counters"
          :key="c.field"
          class="flex flex-col gap-0.5 font-mono text-meta"
          :title="c.assumptions.join(' ')"
        >
          <span class="flex items-center gap-1.5 text-ui text-ink"
            ><ConfidenceMark :confidence="c.confidence" />{{ c.field }}</span
          >
          <span class="pl-3 break-words text-muted">set to {{ c.updates.join(", ") }}</span>
          <span v-if="c.comparisons.length" class="pl-3 break-words text-muted"
            >compared: {{ c.comparisons.join(", ") }}</span
          >
        </div>
        <p class="text-meta text-muted">Counted in calls of the routine that changes them, not in time.</p>
      </section>

      <section v-if="part.reset.length" class="flex flex-col gap-1.5">
        <PanelTitle>Reset</PanelTitle>
        <div v-for="(w, i) in part.reset" :key="i" class="flex items-center gap-1.5 font-mono text-meta">
          <ConfidenceMark :confidence="w.confidence" />
          <span class="text-ink">{{ w.target }} = {{ w.value }}</span>
          <span v-if="w.condition !== 'always'" class="break-words text-muted">when {{ w.condition }}</span>
        </div>
      </section>

      <section v-if="part.effects.length" class="flex flex-col gap-1.5">
        <PanelTitle>Changes to how it’s drawn</PanelTitle>
        <div v-for="(w, i) in part.effects" :key="i" class="flex flex-col gap-0.5 font-mono text-meta">
          <span class="flex items-center gap-1.5 text-ink"
            ><ConfidenceMark :confidence="w.confidence" />{{ w.target }} = {{ w.value }}
            <span class="font-sans text-muted">in {{ w.routine }}</span></span
          >
          <span v-if="w.condition !== 'always'" class="pl-3 break-words text-muted">when {{ w.condition }}</span>
        </div>
      </section>

      <details v-if="part.uncertainties.length" class="flex flex-col gap-1.5">
        <summary class="cursor-pointer text-label font-semibold tracking-[.07em] text-muted uppercase">
          Open questions · {{ part.uncertainties.length }}
        </summary>
        <ul class="mt-1.5 flex flex-col gap-1 font-mono text-meta text-muted">
          <li v-for="u in part.uncertainties" :key="u">{{ u }}</li>
        </ul>
      </details>

      <section class="flex flex-col gap-1.5 border-t border-line pt-3">
        <PanelTitle>Game timing</PanelTitle>
        <p class="text-meta text-muted" :title="summary!.timing.assumptions.join(' ')">
          <ConfidenceMark :confidence="summary!.timing.confidence" />
          <template v-if="summary!.timing.divisor">
            The timer runs at {{ summary!.timing.ticksPerSecond!.toFixed(1) }} ticks a second (divisor
            {{ summary!.timing.divisor }}).
          </template>
          <template v-if="summary!.timing.minimumTicks">
            The game loop waits at least {{ summary!.timing.minimumTicks }} ticks, so a step takes at least
            {{ summary!.timing.minimumMilliseconds!.toFixed(1) }} ms.
          </template>
          Whether every part runs once per step isn’t known yet.
        </p>
      </section>
    </template>
  </div>
</template>
