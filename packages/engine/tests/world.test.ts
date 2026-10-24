import { describe, expect, it } from "vitest";
import { World } from "../src/world.ts";

describe("World", () => {
  it("is deterministic across runs", () => {
    const run = () => {
      const world = new World();
      const body = world.addBody({ x: 0, y: 0 });
      for (let i = 0; i < 120; i++) world.step();
      return body.position;
    };
    expect(run()).toEqual(run());
  });

  it("removes a body", () => {
    const world = new World();
    const kept = world.addBody({ x: 0, y: 0 });
    const removed = world.addBody({ x: 10, y: 0 });
    world.removeBody(removed);
    world.removeBody(removed);
    expect(world.bodies).toEqual([kept]);
  });

  it("applies gravity", () => {
    const world = new World();
    const body = world.addBody({ x: 0, y: 0 });
    world.step();
    expect(body.position.y).toBeGreaterThan(0);
  });
});
