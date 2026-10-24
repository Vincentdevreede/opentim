import { World, type Body } from "@opentim/engine";
import { colors } from "@opentim/theme";
import { Application, Graphics } from "pixi.js";
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });

const BALL_RADIUS = 16;

const app = new Application();
await app.init({ resizeTo: window, background: colors.well, antialias: true });
document.body.appendChild(app.canvas);

const world = new World();
const balls = new Map<Body, Graphics>();
const hint = document.getElementById("hint");
const version = document.getElementById("version");
if (version) version.textContent = `v${__APP_VERSION__}`;

// Before 1.0.0, and for pre-releases like 1.1.0-beta.1, warn that the build may be unstable.
const stage = document.getElementById("stage");
const prerelease = /-([a-z]+)/i.exec(__APP_VERSION__)?.[1];
if (stage && (__APP_VERSION__.startsWith("0.") || prerelease)) {
  const bold = document.createElement("b");
  bold.textContent = prerelease ?? "alpha";
  stage.append(bold, " May be unstable");
  stage.hidden = false;
}
if (hint && matchMedia("(pointer: coarse)").matches) hint.textContent = "Tap anywhere to drop a ball";

// For now the game is a sandbox: click or tap anywhere to drop a ball.
app.stage.eventMode = "static";
app.stage.hitArea = app.screen;
app.stage.on("pointerdown", (e) => {
  const body = world.addBody({ x: e.global.x, y: e.global.y });
  const sprite = new Graphics().circle(0, 0, BALL_RADIUS).fill(colors.accent);
  app.stage.addChild(sprite);
  balls.set(body, sprite);
  hint?.classList.add("hidden");
});

// Run the simulation at a fixed tick rate, decoupled from the display refresh rate.
let accumulator = 0;
app.ticker.add((ticker) => {
  accumulator += ticker.deltaMS;
  while (accumulator >= 1000 / 60) {
    world.step();
    accumulator -= 1000 / 60;
  }
  for (const [body, sprite] of balls) {
    // Balls that fell off the screen are gone for good.
    if (body.position.y > app.screen.height + BALL_RADIUS) {
      world.removeBody(body);
      sprite.destroy();
      balls.delete(body);
    } else {
      sprite.position.set(body.position.x, body.position.y);
    }
  }
});
