<script setup lang="ts">
import { World, type Body } from "@opentim/engine";
import { colors } from "@opentim/theme";
import { Application, Graphics } from "pixi.js";
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import LabButton from "../components/LabButton.vue";
import PageHeader from "../components/PageHeader.vue";

const container = useTemplateRef<HTMLDivElement>("container");
const running = ref(true);
const tick = ref(0);

let app: Application | undefined;
let world = new World();
const sprites = new Map<Body, Graphics>();

function addBall(x: number, y: number) {
  const body = world.addBody({ x, y });
  const sprite = new Graphics().circle(0, 0, 12).fill(colors.accent);
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
  await instance.init({ resizeTo: el, background: colors.well, antialias: true });
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
  <PageHeader title="Sandbox">
    <template #subtitle>Try out the engine · click the canvas to drop a ball</template>
    <span class="font-mono text-muted"
      >tick <span class="text-ink">{{ tick }}</span></span
    >
  </PageHeader>
  <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-sunken px-3">
    <LabButton :variant="running ? 'default' : 'primary'" @click="running = !running">{{
      running ? "Pause" : "Play"
    }}</LabButton>
    <LabButton :disabled="running" @click="step">Step</LabButton>
    <LabButton variant="ghost" @click="reset">Reset</LabButton>
  </div>
  <div ref="container" class="min-h-0 flex-1"></div>
</template>
