import { World } from "@opentim/engine";
import { Application, Graphics } from "pixi.js";
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });

const app = new Application();
await app.init({ resizeTo: window, background: "#0f172a", antialias: true });
document.body.appendChild(app.canvas);

const world = new World();
const ball = world.addBody({ x: app.screen.width / 2, y: 0 });

const sprite = new Graphics().circle(0, 0, 16).fill("#f59e0b");
app.stage.addChild(sprite);

// Run the simulation at a fixed tick rate, decoupled from the display refresh rate.
let accumulator = 0;
app.ticker.add((ticker) => {
  accumulator += ticker.deltaMS;
  while (accumulator >= 1000 / 60) {
    world.step();
    accumulator -= 1000 / 60;
  }
  if (ball.position.y > app.screen.height + 32) {
    ball.position = { x: app.screen.width / 2, y: 0 };
    ball.velocity = { x: 0, y: 0 };
  }
  sprite.position.set(ball.position.x, ball.position.y);
});
