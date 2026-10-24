<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  href: string;
  label: string;
  /** Shows the link as the page's main action. */
  primary?: boolean;
  /** Shows the button greyed out and without a link, e.g. for something that isn't live yet. */
  disabled?: boolean;
  /** Text on a ribbon across the top-right corner, e.g. "Coming soon". */
  ribbon?: string;
}>();
</script>

<template>
  <div
    class="relative flex flex-col gap-4 overflow-hidden rounded-xl border border-line-strong bg-sunken p-6 sm:flex-row sm:items-center sm:justify-between"
    :class="ribbon && 'sm:pr-20'"
  >
    <!-- The band is centred 48px from the top and the right, on the corner's diagonal, so the
         visible part and its text are centred in the corner. -->
    <span
      v-if="ribbon"
      class="pointer-events-none absolute top-9 -right-12 h-6 w-48 rotate-45 bg-accent text-center indent-[.04em] font-pixel text-label leading-6 tracking-[.04em] text-accent-ink uppercase shadow-md"
    >
      {{ ribbon }}
    </span>
    <div class="flex flex-col gap-1.5">
      <span class="font-pixel text-label tracking-[.04em] text-accent">{{ eyebrow }}</span>
      <h2 class="text-heading font-semibold">{{ title }}</h2>
      <p class="max-w-2xl text-soft"><slot /></p>
    </div>
    <a
      :href="disabled ? undefined : href"
      :aria-disabled="disabled || undefined"
      :title="disabled ? 'Coming soon' : undefined"
      class="shrink-0 self-start rounded-lg border px-5 py-2.5 font-semibold sm:self-auto"
      :class="[
        primary ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-ink',
        disabled ? 'cursor-not-allowed opacity-50' : primary ? 'hover:bg-accent-hover' : 'hover:bg-hover',
      ]"
    >
      {{ label }}
    </a>
  </div>
</template>
