<script setup lang="ts">
import type { Sample } from "@opentim/resources";
import { samplePcm, type Pcm } from "@opentim/sound";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  RATES,
  DRIVERS,
  RAW_RATE,
  rawRateKnown,
  adlibPatch,
  audioSections,
  decodeEntry,
  deviceName,
  duration,
  itemName,
  matches,
  rawSample,
  wavFile,
  type AudioItem,
} from "../audio.ts";
import { useRendered, type RenderJob } from "../components/audio/rendering.ts";
import SamplePlayer from "../components/audio/SamplePlayer.vue";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabEmpty from "../components/LabEmpty.vue";
import LabListHeading from "../components/LabListHeading.vue";
import LabListRow from "../components/LabListRow.vue";
import LabNoMatch from "../components/LabNoMatch.vue";
import LabSearch from "../components/LabSearch.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabToolbar from "../components/LabToolbar.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import LabSegmented from "../components/LabSegmented.vue";
import PageHeader from "../components/PageHeader.vue";
import PanelTitle from "../components/PanelTitle.vue";
import { saveFile } from "../export.ts";
import type { Confidence } from "../kinds.ts";
import { edition, resources, selected } from "../library.ts";
import { listIdOf } from "../parts.ts";
import { crumb, fmCard, formatBytes, hex, openAt, selectedSound } from "../ui.ts";

const router = useRouter();
const query = ref("");
const rate = ref(RAW_RATE);
/** TIM 2's program says the rate of its samples; for other games it is a guess. */
const rateKnown = computed(() => rawRateKnown(listIdOf(edition.value)) && rate.value === RAW_RATE);
const rateOptions = RATES.map((r) => ({ value: r, label: `${r / 1000} kHz` }));

const sections = computed(() => audioSections(resources.value));
const all = computed(() => sections.value.flatMap((s) => s.items));
/** Every sound in one list, the bank's first and then the `.RAW` files, as far as they match the filter. */
const shown = computed(() => all.value.filter((i) => matches(i, query.value)));
/** The sources that can't be read, like a damaged bank. */
const failed = computed(() => sections.value.filter((s) => s.error));
const current = computed(() => all.value.find((i) => i.key === selectedSound.value) ?? all.value[0]);

const decoded = computed(() => (current.value?.type === "bank" ? decodeEntry(current.value.entry) : undefined));
const sample = computed<Sample | undefined>(() => {
  const item = current.value;
  if (item?.type === "raw") return rawSample(item.resource, rate.value);
  return decoded.value?.status === "decoded" ? decoded.value.sample : undefined;
});
const devices = computed(() => (decoded.value?.status === "decoded" ? decoded.value.sound.devices : []));
const midiTracks = computed(() => devices.value.some((d) => d.tracks.some((t) => !t.sample)));
/** True when the selected sound has MIDI for the AdLib, which plays on the emulated chip. */
const hasAdlib = computed(() => decoded.value?.status === "decoded" && decoded.value.adlib);
/** For a sound with both, which one plays. Which of the two the game plays isn't known yet. */
const source = ref<"sample" | "midi">("sample");
const SOURCES = [
  { value: "sample" as const, label: "Sample" },
  { value: "midi" as const, label: "MIDI" },
];
/** The cards whose FM driver can play the MIDI; both play the same tracks. */
const CARDS = [
  { value: "sbpro" as const, label: "Sound Blaster Pro" },
  { value: "adlib" as const, label: "AdLib" },
];
/** True when the AdLib MIDI plays, rather than the sound's sample. */
const adlib = computed(() => hasAdlib.value && (!sample.value || source.value === "midi"));

const patch = computed(() => adlibPatch(resources.value));
const job = computed<RenderJob | undefined>(() => {
  const d = decoded.value;
  const item = current.value;
  if (!adlib.value || d?.status !== "decoded" || patch.value.status !== "found" || !item) return undefined;
  return {
    key: `${item.key}:${fmCard.value}`,
    sound: d.sound.data,
    patch: patch.value.data,
    card: fmCard.value,
    // Only the AdLib driver differs between builds; the Sound Blaster Pro driver is the same file in all of them.
    sameInstrumentFirst: fmCard.value === "adlib" && patch.value.sameInstrumentFirst,
  };
});
const rendered = useRendered(job);
const { progress: renderProgress, error: renderError, rendering } = rendered;
/** What the player plays: the sound rendered with the chosen card's FM driver, or else its sample. */
const pcm = computed<Pcm | undefined>(() => {
  if (adlib.value) return rendered.pcm.value;
  return sample.value && samplePcm(sample.value);
});

/** The files the banks' sounds come from, like `TIM.SX`. */
const bankFiles = computed(() => sections.value.filter((s) => s.title !== "Samples").map((s) => s.title));
/** Where the sounds come from, for the subtitle: the bank's file, or how many banks when there are several. */
const banksLabel = computed(() =>
  bankFiles.value.length > 1 ? `${bankFiles.value.length} banks` : bankFiles.value[0],
);
const soundCount = computed(() => all.value.filter((i) => i.type === "bank").length);
const sampleCount = computed(() => all.value.filter((i) => i.type === "raw").length);
/** With more than one bank loaded, a row names its bank too, as their sounds share one list. */
const manyBanks = computed(() => bankFiles.value.length > 1);
/** The meta of a row: the sound's id, with its bank when that's needed, or the sample file's size. */
const rowMeta = (item: AudioItem) =>
  item.type === "raw"
    ? formatBytes(item.resource.data.length)
    : manyBanks.value
      ? `${item.resource.name} · ${item.entry.id}`
      : String(item.entry.id);

/** How the lab plays an item: its sample as it is, its MIDI on the emulated AdLib, or not at all. */
function statusOf(item: AudioItem): { status: Confidence; label: string } {
  if (item.type === "raw")
    return rawRateKnown(listIdOf(edition.value))
      ? { status: "decoded", label: "sample" }
      : { status: "hypothesis", label: "sample · rate guessed" };
  const d = decodeEntry(item.entry);
  if (d.status === "error") return { status: "error", label: "decode error" };
  if (!d.adlib)
    return d.sample ? { status: "decoded", label: "sample" } : { status: "unsupported", label: "no AdLib tracks" };
  if (patch.value.status !== "found") return { status: "unsupported", label: "MIDI · no instruments" };
  return { status: "partial", label: "MIDI · game’s driver, emulated chip" };
}

/** The format of the selected item, in words. */
const format = computed(() => {
  if (current.value?.type === "raw") return "8-bit unsigned PCM, mono, no header";
  if (decoded.value?.status !== "decoded") return "unknown";
  if (sample.value && midiTracks.value) return "MIDI and a digitized sample";
  return sample.value ? "digitized sample, 8-bit unsigned PCM" : "MIDI";
});

function pick(item: AudioItem) {
  selectedSound.value = item.key;
}

/** Opens the item's bytes in Files: the sound's DAT: chunk in its bank, or the whole sample file. */
function viewBytes() {
  const item = current.value;
  if (!item) return;
  selected.value = item.resource.name;
  openAt.value = item.type === "bank" ? item.entry.offset : 0;
  void router.push("/files");
}

function saveWav() {
  if (!pcm.value || !current.value) return;
  saveFile(wavFile(pcm.value), `${itemName(current.value).replace(/\.RAW$/, "")}.wav`);
}

watch(
  () => current.value?.key,
  () => void nextTick(() => document.querySelector('[data-sound="selected"]')?.scrollIntoView({ block: "nearest" })),
  { immediate: true },
);

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const list = shown.value;
    const at = list.findIndex((i) => i.key === current.value?.key);
    const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowUp" ? -1 : 1)))];
    if (!next) return;
    e.preventDefault();
    pick(next);
    if (e.target.closest("[data-sound]"))
      void nextTick(() => document.querySelector<HTMLElement>('[data-sound="selected"]')?.focus());
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  crumb.value = [];
});
watchEffect(() => {
  const item = current.value;
  crumb.value = item ? ["Audio", item.type === "bank" ? item.resource.name : "Samples", itemName(item)] : [];
});

const factClass = "flex min-w-0 flex-col gap-1 border-line p-3";
</script>

<template>
  <PageHeader title="Audio">
    <template #subtitle>
      <template v-if="banksLabel">
        <span class="font-mono text-ink">{{ soundCount }}</span> sounds in
        <span class="font-mono text-ink">{{ banksLabel }}</span>
      </template>
      <template v-if="banksLabel && sampleCount"> · </template>
      <template v-if="sampleCount">
        <span class="font-mono text-ink">{{ sampleCount }}</span> sample files
      </template>
    </template>
    <span class="text-meta text-muted">
      <LabKbd>/</LabKbd> filter · <LabKbd>↑</LabKbd> <LabKbd>↓</LabKbd> move · <LabKbd>Space</LabKbd> play or pause
    </span>
  </PageHeader>

  <div v-if="current" class="flex min-h-0 flex-1">
    <LabSidePanel side="left" aria-label="Sounds">
      <LabToolbar>
        <LabSearch v-model="query" label="Filter sounds" placeholder="Name or id…" class="flex-1" />
      </LabToolbar>
      <div class="min-h-0 flex-1 overflow-auto pb-2">
        <LabListHeading title="Audio" :meta="`${shown.length} of ${all.length}`" />
        <p v-for="f in failed" :key="f.title" class="flex items-start gap-1.5 px-3 py-1 text-meta text-error">
          <LabIcon name="warning" :size="13" :stroke="2" class="mt-px" />{{ f.title }}: {{ f.error!.message }}
        </p>
        <LabListRow
          v-for="item in shown"
          :key="item.key"
          :name="itemName(item)"
          :meta="rowMeta(item)"
          :status="statusOf(item).status"
          :status-title="statusOf(item).label"
          :aria-description="statusOf(item).label"
          :selected="item.key === current.key"
          :data-sound="item.key === current.key ? 'selected' : ''"
          @click="pick(item)"
        />
        <LabNoMatch v-if="!shown.length" what="sounds" :query="query" />
      </div>
    </LabSidePanel>

    <section class="min-w-0 flex-1 overflow-auto px-10 py-10">
      <div class="mx-auto flex max-w-[720px] flex-col gap-6">
        <div class="flex flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-mono text-heading font-semibold">{{ itemName(current) }}</h2>
            <LabBadge v-bind="statusOf(current)" />
          </div>
          <p class="text-muted">
            <template v-if="current.type === 'bank'">
              Sound <span class="font-mono text-ink">{{ current.entry.id }}</span> in
              <span class="font-mono text-ink">{{ current.resource.name }}</span
              >, from
              <span class="font-mono">{{ current.resource.archive }}</span>
            </template>
            <template v-else>
              Sample file in <span class="font-mono">{{ current.resource.archive }}</span>
            </template>
          </p>
        </div>

        <div
          v-if="decoded?.status === 'error'"
          class="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/8 p-4"
        >
          <p class="flex items-center gap-2 font-semibold text-error">
            <LabIcon name="warning" :size="15" :stroke="2" />The sound couldn’t be decoded
          </p>
          <p class="text-soft">
            {{ decoded.message
            }}<template v-if="decoded.offset !== undefined">
              at <span class="font-mono">{{ hex(decoded.offset, 4) }}</span> of the unpacked sound</template
            >.
          </p>
        </div>

        <div
          v-else-if="adlib && patch.status !== 'found' && !sample"
          class="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-sunken p-4"
        >
          <div class="flex items-center gap-2">
            <PanelTitle>MIDI</PanelTitle>
            <LabBadge status="unsupported" label="no instruments" />
          </div>
          <p class="text-soft">
            {{ patch.message }} The MIDI plays through the game’s own driver and instruments, so without them it can’t
            be heard. Import the files with {{ DRIVERS }} to play it.
          </p>
        </div>

        <div v-else-if="adlib || sample" class="flex flex-col gap-3 rounded-lg border border-line bg-well p-4">
          <div class="flex flex-wrap items-center gap-2">
            <PanelTitle>{{ adlib ? "MIDI" : "Sample" }}</PanelTitle>
            <div class="flex-1"></div>
            <LabSegmented v-if="hasAdlib && sample" v-model="source" label="What to play" :options="SOURCES" />
            <LabSegmented v-if="adlib" v-model="fmCard" label="Sound card" :options="CARDS" />
            <LabBadge
              v-if="adlib"
              status="partial"
              label="game’s driver · emulated chip"
              title="The MIDI plays through the game’s own FM driver for the card from SX.OVL, redone from its code, with the game’s instruments, on an emulation of the OPL2 chip ported from Nuked OPL3. The Sound Blaster Pro driver plays the same notes on the card’s two chips and sets each side’s level from the pan. A high pan plays on the right, as the driver means it; the first Sound Blaster Pro wired that chip to the left, so there it played mirrored. Still estimated: how long each register write takes, and that the game’s sound system sends the driver nothing beyond the tracks."
            />
            <template v-if="current.type === 'raw'">
              <LabSegmented v-model="rate" label="Playback rate" :options="rateOptions" />
              <LabBadge
                v-if="rateKnown"
                status="decoded"
                label="game’s rate"
                title="TIM2.EXE sets 11,025 Hz with its sound driver’s rate call before it plays a .RAW file."
              />
              <LabBadge
                v-else
                status="hypothesis"
                label="rate guessed"
                title="The .RAW files have no header with their rate. 11 kHz is the rate of most samples in the sound banks."
              />
            </template>
          </div>
          <SamplePlayer v-if="pcm" :key="current.key" :pcm="pcm" />
          <p v-else-if="renderError" class="flex items-center gap-2 text-error">
            <LabIcon name="warning" :size="15" :stroke="2" />The sound couldn’t be played: {{ renderError }}
          </p>
          <div v-else-if="rendering" class="flex h-12 items-center gap-3" role="status">
            <LabIcon name="spinner" :size="16" :stroke="2" class="animate-spin text-accent" />
            <span class="text-soft">Playing it on the emulated AdLib…</span>
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
              <div class="h-full bg-accent" :style="{ width: `${Math.round(renderProgress * 100)}%` }"></div>
            </div>
            <span class="w-10 text-right font-mono text-muted tabular">{{ Math.round(renderProgress * 100) }}%</span>
          </div>
          <p v-else-if="adlib && patch.status !== 'found'" class="text-soft">
            {{ patch.message }} The MIDI plays through the game’s own driver and instruments, so without them it can’t
            be heard. Import the files with {{ DRIVERS }} to play it.
          </p>
          <p v-if="hasAdlib && sample" class="text-meta text-muted">
            This sound has a digitized sample and MIDI for the AdLib. The sample goes to the game’s digital sound
            drivers and the MIDI to its music driver; whether the game plays both at once isn’t checked yet.
          </p>
        </div>

        <dl class="m-0 grid grid-cols-3 rounded-lg border border-line bg-sunken">
          <div :class="[factClass, 'border-r']">
            <dt class="text-muted">Size</dt>
            <dd v-if="current.type === 'bank'" class="font-mono text-lead">
              {{ formatBytes(current.entry.packed.length) }} B
              <span v-if="decoded?.status === 'decoded'" class="text-meta text-muted"
                >→ {{ formatBytes(decoded.sound.data.length) }} B unpacked</span
              >
            </dd>
            <dd v-else class="font-mono text-lead">{{ formatBytes(current.resource.data.length) }} B</dd>
          </div>
          <div :class="[factClass, 'border-r']">
            <dt class="text-muted">Format</dt>
            <dd class="text-lead">{{ format }}</dd>
          </div>
          <div :class="factClass">
            <template v-if="pcm">
              <dt class="text-muted">Rate · length</dt>
              <dd class="font-mono text-lead">
                {{ formatBytes(pcm.rate) }} Hz{{ pcm.right ? " stereo" : "" }} ·
                {{ duration(pcm.samples.length / pcm.rate) }}
              </dd>
            </template>
            <template v-else-if="current.type === 'bank'">
              <dt class="text-muted">Flags</dt>
              <dd class="font-mono text-lead">
                {{ current.entry.flags.map((f) => hex(f, 2).slice(2)).join(" ") }}
                <span class="font-sans text-meta text-muted">meaning unknown</span>
              </dd>
            </template>
          </div>
        </dl>

        <div v-if="devices.length" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <PanelTitle>Devices and tracks</PanelTitle>
            <LabBadge
              status="decoded"
              label="names from the drivers"
              title="Each driver in SX.OVL reports the device id it plays. AdLib also covers the Sound Blaster Pro and Pro AudioSpectrum drivers, which play the same tracks."
            />
          </div>
          <table class="w-full border-collapse text-left">
            <thead class="text-label font-semibold tracking-[.07em] text-muted uppercase">
              <tr class="border-b border-line">
                <th class="w-[60px] py-1.5 pr-3 font-semibold">Id</th>
                <th class="w-[150px] py-1.5 pr-3 font-semibold">Device</th>
                <th class="py-1.5 font-semibold">Tracks</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in devices" :key="d.id" class="border-b border-line-soft align-top">
                <td class="py-1.5 pr-3 font-mono">{{ hex(d.id, 2) }}</td>
                <td class="py-1.5 pr-3" :class="!deviceName(d.id) && 'text-muted'">
                  {{ deviceName(d.id) ?? "unknown" }}
                </td>
                <td class="flex flex-wrap gap-1 py-1.5">
                  <span
                    v-for="(t, i) in d.tracks"
                    :key="i"
                    class="inline-flex h-5 items-center rounded-[4px] border border-line px-1.5 font-mono text-meta"
                    :class="t.sample ? 'border-decoded/35 text-decoded' : 'text-soft'"
                    :title="`At ${hex(t.offset, 4)}, ${formatBytes(t.size)} bytes. First bytes ${t.header.map((b) => hex(b, 2).slice(2)).join(' ')}.`"
                    >{{ t.sample ? `sample ${formatBytes(t.sample.rate)} Hz` : `ch ${t.channel}` }}
                    <span class="ml-1 text-muted">{{ formatBytes(t.size) }} B</span></span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap gap-2">
          <LabButton @click="viewBytes"> <LabIcon name="bytes" :size="13" :stroke="2" />View bytes in Files </LabButton>
          <LabButton v-if="pcm" @click="saveWav">Save as WAV</LabButton>
        </div>
      </div>
    </section>
  </div>

  <LabEmpty
    v-else
    icon="audio"
    title="No sounds in these files"
    text="The loaded files have no sound banks (.SX) or samples (.RAW)."
  />
</template>
