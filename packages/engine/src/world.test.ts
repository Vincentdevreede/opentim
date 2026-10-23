import { describe, expect, it } from "vitest";
import { World } from "./world.ts";

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

  it("applies gravity", () => {
    const world = new World();
    const body = world.addBody({ x: 0, y: 0 });
    world.step();
    expect(body.position.y).toBeGreaterThan(0);
  });
});
