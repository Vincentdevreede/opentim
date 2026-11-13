<script setup lang="ts">
import { World, type Body } from "@opentim/engine";
import { colors } from "@opentim/theme";
import { Application, Graphics, Rectangle } from "pixi.js";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import LabBadge from "../components/LabBadge.vue";
import LabButton from "../components/LabButton.vue";
import LabIcon from "../components/LabIcon.vue";
import LabPanelBody from "../components/LabPanelBody.vue";
import LabPlaceholder from "../components/LabPlaceholder.vue";
import { crumb } from "../ui.ts";
import LabPanelHeader from "../components/LabPanelHeader.vue";
import LabSidePanel from "../components/LabSidePanel.vue";
import LabTag from "../components/LabTag.vue";
import PageHeader from "../components/PageHeader.vue";

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
    if (e.repeat) return;
    running.value = !running.value;
  } else if (e.key === "." && !running.value) step();
  else if (e.key.toLowerCase() === "r") reset();
}

/** Set when the page is left, also while PixiJS is still starting. */
let left = false;

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  const el = container.value;
  if (!el) return;
  const instance = new Application();
  await instance.init({ width: WIDTH * SCALE, height: HEIGHT * SCALE, backgroundAlpha: 0, antialias: true });
  if (left) {
    instance.destroy(true, { children: true });
    return;
  }
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
  left = true;
  window.removeEventListener("keydown", onKeydown);
  app?.destroy(true, { children: true });
  crumb.value = [];
});

watchEffect(() => (crumb.value = ["Sandbox", `${objects.value} objects`, running.value ? "running" : "paused"]));
</script>

<template>
  <PageHeader title="Sandbox">
    <template #controls>
      <LabButton variant="primary" class="min-w-[84px]" :aria-pressed="running" @click="running = !running">
        <LabIcon :name="running ? 'pause' : 'play'" :size="12" />{{ running ? "Pause" : "Play" }}
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
    </template>
    <LabBadge
      status="hypothesis"
      label="engine prototype"
      title="The physics engine is a prototype; behaviour is not yet matched to the original game."
    />
  </PageHeader>

  <div class="flex min-h-0 flex-1">
    <LabSidePanel side="left" width="220px" aria-label="Parts">
      <LabPanelHeader title="Parts" />
      <LabPanelBody>
        <LabPlaceholder title="Needs to be built"
          >Parts to drag onto the canvas, like balls, gears and walls.</LabPlaceholder
        >
      </LabPanelBody>
    </LabSidePanel>

    <section class="flex min-w-0 flex-1 overflow-auto bg-sunken p-4">
      <div
        class="relative m-auto shrink-0 bg-well bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-size-[16px_16px] ring-1 ring-line-strong"
        :style="{ width: `${WIDTH * SCALE}px`, height: `${HEIGHT * SCALE}px` }"
      >
        <div ref="container" class="absolute inset-0"></div>
        <LabTag class="pointer-events-none absolute bottom-2 left-2"
          >{{ SCALE }}× · {{ WIDTH }} × {{ HEIGHT }} world px · click to drop a ball</LabTag
        >
      </div>
    </section>

    <LabSidePanel aria-label="Inspector">
      <LabPanelHeader title="Inspector" />
      <LabPanelBody>
        <LabPlaceholder title="Needs to be built"
          >Select an object to see and edit its position, velocity and properties.</LabPlaceholder
        >
      </LabPanelBody>
    </LabSidePanel>
  </div>
</template>
