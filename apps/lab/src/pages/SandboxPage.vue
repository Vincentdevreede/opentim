<script setup lang="ts">
import { World, type Body } from "@opentim/engine";
import { colors } from "@opentim/theme";
import { Application, Graphics, Rectangle } from "pixi.js";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabIcon from "../components/LabIcon.vue";
import LabKbd from "../components/LabKbd.vue";
import PanelTitle from "../components/PanelTitle.vue";
import { crumb } from "../ui.ts";

// The world is drawn at twice its size, so its pixels stay visible.
const WIDTH = 400;
const HEIGHT = 290;
const SCALE = 2;

const container = useTemplateRef<HTMLDivElement>("container");
const running = ref(true);
const tick = ref(0);
const objects = ref(0);

let app: Application | undefined;
let world = new World();
const sprites = new Map<Body, Graphics>();

function addBall(x: number, y: number) {
  const body = world.addBody({ x, y });
  const sprite = new Graphics().circle(0, 0, 14).fill(colors.accent);
  app?.stage.addChild(sprite);
  sprites.set(body, sprite);
}

function sync() {
  for (const [body, sprite] of sprites) sprite.position.set(body.position.x, body.position.y);
  tick.value = world.tick;
  objects.value = sprites.size;
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

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === " ") {
    // A focused button already toggles itself on Space.
    if (e.target.closest("button")) return;
    e.preventDefault();
    running.value = !running.value;
  } else if (e.key === "." && !running.value) step();
  else if (e.key.toLowerCase() === "r") reset();
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  const el = container.value;
  if (!el) return;
  const instance = new Application();
  await instance.init({ width: WIDTH * SCALE, height: HEIGHT * SCALE, backgroundAlpha: 0, antialias: true });
  app = instance;
  el.appendChild(instance.canvas);

  instance.stage.scale.set(SCALE);
  instance.stage.eventMode = "static";
  instance.stage.hitArea = new Rectangle(0, 0, WIDTH, HEIGHT);
  instance.stage.on("pointerdown", (e) => {
    const { x, y } = e.getLocalPosition(instance.stage);
    addBall(x, y);
    sync();
  });

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

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  app?.destroy(true, { children: true });
  crumb.value = [];
});

watchEffect(() => (crumb.value = ["Sandbox", `${objects.value} objects`, running.value ? "running" : "paused"]));
</script>

<template>
  <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-4">
    <h1 class="text-title font-semibold">Sandbox</h1>
    <div class="mx-1.5 h-5 w-px bg-line"></div>
    <LabButton variant="primary" class="min-w-[84px]" :aria-pressed="running" @click="running = !running">
      <LabIcon :name="running ? 'pause' : 'play'" :size="12" :stroke="2" />{{ running ? "Pause" : "Play" }}
    </LabButton>
    <LabButton :disabled="running" title="Advance one tick (.)" @click="step">
      <LabIcon name="step" :size="13" :stroke="2" />Step
    </LabButton>
    <LabButton title="Reset to start (R)" @click="reset"
      ><LabIcon name="reset" :size="13" :stroke="2" />Reset</LabButton
    >
    <div class="ml-1 flex h-[26px] items-center gap-1.5 rounded-[5px] border border-line bg-sunken px-2.5">
      <span class="text-muted">tick</span>
      <span class="min-w-12 text-right font-mono text-accent tabular">{{ String(tick).padStart(6, "0") }}</span>
    </div>
    <div class="flex-1"></div>
    <span class="text-meta text-muted">
      <LabKbd>Space</LabKbd> play · <LabKbd>.</LabKbd> step · <LabKbd>R</LabKbd> reset
    </span>
    <LabBadge
      status="hypothesis"
      label="engine prototype"
      title="The physics engine is a prototype; behaviour is not yet matched to the original game."
    />
  </header>

  <div class="flex min-h-0 flex-1">
    <aside aria-label="Parts" class="flex w-[220px] shrink-0 flex-col border-r border-line bg-sunken">
      <div class="flex h-8 shrink-0 items-center border-b border-line px-3"><PanelTitle>Parts</PanelTitle></div>
      <div class="p-2.5">
        <div class="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-muted">
          <p class="font-semibold text-soft">Needs to be built</p>
          <p class="mt-1">Parts to drag onto the canvas, like balls, gears and walls.</p>
        </div>
      </div>
    </aside>

    <section class="flex min-w-0 flex-1 overflow-auto bg-sunken p-4">
      <div
        class="relative m-auto shrink-0 bg-well bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-size-[16px_16px] ring-1 ring-line-strong"
        :style="{ width: `${WIDTH * SCALE}px`, height: `${HEIGHT * SCALE}px` }"
      >
        <div ref="container" class="absolute inset-0"></div>
        <span
          class="pointer-events-none absolute bottom-2 left-2 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-2xs text-soft"
          >{{ SCALE }}× · {{ WIDTH }} × {{ HEIGHT }} world px · click to drop a ball</span
        >
      </div>
    </section>

    <aside aria-label="Inspector" class="flex w-[300px] shrink-0 flex-col border-l border-line bg-sunken">
      <div class="flex h-8 shrink-0 items-center border-b border-line px-3"><PanelTitle>Inspector</PanelTitle></div>
      <div class="p-3">
        <div class="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-muted">
          <p class="font-semibold text-soft">Needs to be built</p>
          <p class="mt-1">Select an object to see and edit its position, velocity and properties.</p>
        </div>
      </div>
    </aside>
  </div>
</template>
