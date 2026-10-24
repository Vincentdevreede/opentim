<script setup lang="ts">
import logo from "@opentim/theme/opentim-logo.png";

const PLAY_URL = "https://play.opentim.app/";
/** The game isn't live yet; set to true to enable the play links. */
const PLAY_AVAILABLE = false;
const LAB_URL = "https://lab.opentim.app/";
const SOURCE_URL = "https://github.com/Vincentdevreede/opentim";

const FEATURES = [
  {
    title: "Bring your own copy",
    text: "OpenTIM loads the files of your original game. They are read in your browser and never uploaded.",
  },
  {
    title: "Plays in your browser",
    text: "Nothing to download. Install it as an app to play full screen and offline.",
  },
  {
    title: "Open source",
    text: "Free software under the GPL. Read the code, report bugs or help rebuild the machine.",
  },
];
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <main class="flex-1">
      <section class="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-16 pb-12 text-center sm:pt-24">
        <img
          :src="logo"
          alt="OpenTIM"
          width="520"
          height="390"
          class="w-full max-w-[420px] rounded-xl border border-line-strong"
        />
        <h1 class="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          The Incredible Machine, rebuilt for the web
        </h1>
        <p class="max-w-xl text-lg text-balance text-soft">
          Build contraptions, solve puzzles and play in your browser, or install it as an app.
        </p>
      </section>

      <section class="mx-auto max-w-5xl px-4 pb-12">
        <LinkBlock
          eyebrow="FOR PLAYERS"
          title="Play OpenTIM"
          :href="PLAY_URL"
          label="Play now"
          primary
          :disabled="!PLAY_AVAILABLE"
          :ribbon="PLAY_AVAILABLE ? undefined : 'Coming soon'"
        >
          Runs in your browser with the files of your own copy of the game. Install it as an app to play full screen and
          offline.
        </LinkBlock>
      </section>

      <section class="mx-auto grid max-w-5xl gap-4 px-4 pb-12 sm:grid-cols-3">
        <div v-for="feature in FEATURES" :key="feature.title" class="rounded-xl border border-line bg-sunken p-5">
          <h2 class="mb-1.5 font-semibold">{{ feature.title }}</h2>
          <p class="text-soft">{{ feature.text }}</p>
        </div>
      </section>

      <section class="mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-20">
        <LinkBlock eyebrow="FOR DEVELOPERS" title="OpenTIM Lab" :href="LAB_URL" label="Open OpenTIM Lab">
          The workbench for rebuilding the game. Load your original files, browse every resource inside and inspect the
          raw bytes.
        </LinkBlock>
        <LinkBlock eyebrow="FOR DEVELOPERS" title="Help rebuild the machine" :href="SOURCE_URL" label="Open Github">
          OpenTIM is free software under the GPL. Read the code, report bugs or send a pull request on GitHub.
        </LinkBlock>
      </section>
    </main>

    <footer class="flex flex-col gap-3 border-t border-line bg-sunken px-4 py-6 text-center text-meta text-muted">
      <nav aria-label="OpenTIM" class="flex justify-center gap-5 font-semibold">
        <a v-if="PLAY_AVAILABLE" :href="PLAY_URL" class="hover:text-ink">Play</a>
        <span v-else aria-disabled="true" title="Coming soon" class="cursor-not-allowed opacity-50">Play</span>
        <a :href="LAB_URL" class="hover:text-ink">Lab</a>
        <a :href="SOURCE_URL" class="hover:text-ink">Source</a>
      </nav>
      <p>
        OpenTIM is free software under the GPL-3.0-or-later license and ships no original game assets. It is not
        affiliated with the makers of The Incredible Machine.
      </p>
    </footer>
  </div>
</template>
