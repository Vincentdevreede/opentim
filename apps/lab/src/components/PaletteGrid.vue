<script setup lang="ts">
/** The 256 colours of a palette. Colours the frame doesn't use are faded; hovering one picks it out in the frame. */
defineProps<{ palette?: Uint8Array; counts: Map<number, number> }>();
const highlight = defineModel<number>("highlight");

const css = (palette: Uint8Array | undefined, i: number) =>
  palette ? `rgb(${palette[i * 3]} ${palette[i * 3 + 1]} ${palette[i * 3 + 2]})` : `rgb(${i} ${i} ${i})`;
</script>

<template>
  <div class="grid w-fit grid-cols-[repeat(16,14px)] gap-px" @mouseleave="highlight = undefined">
    <span
      v-for="i in 256"
      :key="i"
      class="size-3.5 rounded-[2px]"
      :class="[counts.has(i - 1) ? 'ring-1 ring-ink/70' : 'opacity-15', highlight === i - 1 && 'ring-2 ring-accent!']"
      :style="{ background: css(palette, i - 1) }"
      :title="`colour ${i - 1}${counts.has(i - 1) ? ` · ${counts.get(i - 1)} pixels` : ' · not used'}`"
      @mouseenter="highlight = counts.has(i - 1) ? i - 1 : undefined"
    ></span>
  </div>
</template>
