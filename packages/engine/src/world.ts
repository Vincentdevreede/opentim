export interface Vec2 {
  x: number;
  y: number;
}

export interface Body {
  id: number;
  position: Vec2;
  velocity: Vec2;
}

/** Simulation ticks per second. A fixed step keeps every run of a puzzle identical. */
export const TICK_RATE = 60;

/**
 * The simulation core. It has no DOM or rendering dependencies so it can run
 * headless (tests, level validation) as well as in the game client.
 */
export class World {
  readonly bodies: Body[] = [];
  readonly gravity: Vec2 = { x: 0, y: 980 };
  tick = 0;
  private nextId = 1;

  addBody(position: Vec2): Body {
    const body: Body = { id: this.nextId++, position: { ...position }, velocity: { x: 0, y: 0 } };
    this.bodies.push(body);
    return body;
  }

  step(): void {
    const dt = 1 / TICK_RATE;
    for (const body of this.bodies) {
      body.velocity.x += this.gravity.x * dt;
      body.velocity.y += this.gravity.y * dt;
      body.position.x += body.velocity.x * dt;
      body.position.y += body.velocity.y * dt;
    }
    this.tick++;
  }
}
