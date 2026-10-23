<script setup lang="ts">
import { routes } from "./router.ts";
</script>

<template>
  <div class="flex h-full bg-slate-950 text-slate-100">
    <nav class="flex w-48 shrink-0 flex-col gap-1 border-r border-slate-800 p-3">
      <div class="mb-3 px-2 text-sm font-semibold tracking-wide text-amber-400">OpenTIM Lab</div>
      <RouterLink
        v-for="route in routes"
        :key="route.path"
        :to="route.path"
        class="rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        active-class="bg-slate-800 text-white"
      >
        {{ route.name }}
      </RouterLink>
    </nav>
    <main class="min-w-0 flex-1 overflow-hidden">
      <RouterView />
    </main>
  </div>
</template>
