<script setup lang="ts">
import { World, type Body } from "@opentim/engine";
import { Application, Graphics } from "pixi.js";
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";

const container = useTemplateRef<HTMLDivElement>("container");
const running = ref(true);
const tick = ref(0);

let app: Application | undefined;
let world = new World();
const sprites = new Map<Body, Graphics>();

function addBall(x: number, y: number) {
  const body = world.addBody({ x, y });
  const sprite = new Graphics().circle(0, 0, 12).fill("#f59e0b");
  app?.stage.addChild(sprite);
  sprites.set(body, sprite);
}

function sync() {
  for (const [body, sprite] of sprites) sprite.position.set(body.position.x, body.position.y);
  tick.value = world.tick;
}

function step() {
  world.step();
  sync();
}

function reset() {
  for (const sprite of sprites.values()) sprite.destroy();
  sprites.clear();
  world = new World();
  sync();
}

onMounted(async () => {
  const el = container.value;
  if (!el) return;
  const instance = new Application();
  await instance.init({ resizeTo: el, background: "#0f172a", antialias: true });
  app = instance;
  el.appendChild(instance.canvas);

  instance.stage.eventMode = "static";
  instance.stage.hitArea = instance.screen;
  instance.stage.on("pointerdown", (e) => addBall(e.global.x, e.global.y));

  let accumulator = 0;
  instance.ticker.add((ticker) => {
    if (!running.value) return;
    accumulator += ticker.deltaMS;
    while (accumulator >= 1000 / 60) {
      world.step();
      accumulator -= 1000 / 60;
    }
    sync();
  });
});

onBeforeUnmount(() => app?.destroy(true, { children: true }));
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-slate-800 p-2 text-sm">
      <button class="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700" @click="running = !running">
        {{ running ? "Pause" : "Play" }}
      </button>
      <button class="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:opacity-40" :disabled="running" @click="step">
        Step
      </button>
      <button class="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700" @click="reset">Reset</button>
      <span class="ml-auto text-slate-400">Tick {{ tick }} · click the canvas to drop a ball</span>
    </div>
    <div ref="container" class="min-h-0 flex-1"></div>
  </div>
</template>
