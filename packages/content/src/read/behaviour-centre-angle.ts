/**
 * The centre angle: the angle of the line between the centres of two parts, worked out by the movement angle helper.
 * The explosion's run passes it to the speed setter to push a part it hits, and the pinball bumper's bounce to throw the
 * ball off. Checked against its complete instruction graph in the supplied builds, it only reads the two parts.
 *
 * With the movement angle helper's loaded lookup and the speed setter's coefficient table, the velocity the setter then
 * gives points from the first part's centre to the second's. `directionError` checks that over every angle the helper
 * can return, and gives the largest error.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { ContactMotionAngle } from "./behaviour-contact-motion-angle.ts";
import type { DirectedVelocity } from "./behaviour-directed-velocity.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Finding } from "./behaviour.ts";

export interface CentreAngle extends Finding {
  routine: number;
  /** The two parts: the angle is of the line from the centre of the first to the centre of the second. */
  arguments: { from: 6; to: 8 };
  /** A centre is the position plus half the frame size, halved with an arithmetic shift. */
  fields: { positionX: number; positionY: number; frameWidth: number; frameHeight: number };
  /** The movement angle helper gets `from - to` across and `to - from` down, each a sign-extended word. */
  x: "fromMinusTo";
  y: "toMinusFrom";
  backend: ContactMotionAngle;
}

const evenMore = `push bp
mov bp,sp
sub sp,#18
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+{frameWidth}]
sar ax,#1
mov dx,16:ds[si+{positionX}]
add dx,ax
mov 16:ss[bp+-2],dx
mov ax,16:ds[si+{frameHeight}]
sar ax,#1
mov dx,16:ds[si+{positionY}]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,16:ds[di+{frameWidth}]
sar ax,#1
mov dx,16:ds[di+{positionX}]
add dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+{frameHeight}]
sar ax,#1
mov dx,16:ds[di+{positionY}]
add dx,ax
mov 16:ss[bp+-8],dx
mov ax,16:ss[bp+-2]
sub ax,16:ss[bp+-6]
cwd
mov 16:ss[bp+-12],dx
mov 16:ss[bp+-14],ax
mov ax,16:ss[bp+-8]
sub ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-16],dx
mov 16:ss[bp+-18],ax
push 16:ss[bp+-16]
push ax
push 16:ss[bp+-12]
push 16:ss[bp+-14]
callf $backend
add sp,#8
mov 16:ss[bp+-10],ax
pop di
pop si
mov sp,bp
pop bp
retf`;
/** TIM 1 pushes the vertical difference from its local and reloads the answer before it returns. */
const tim1 = evenMore
  .replace(
    "mov 16:ss[bp+-18],ax\npush 16:ss[bp+-16]\npush ax",
    "mov 16:ss[bp+-18],ax\npush 16:ss[bp+-16]\npush 16:ss[bp+-18]",
  )
  .replace("mov 16:ss[bp+-10],ax\npop di", "mov 16:ss[bp+-10],ax\nmov ax,16:ss[bp+-10]\njmp @done\ndone: pop di");
/** The Even More demo pushes the vertical difference's high word straight from DX, which still holds it. */
const demo = evenMore.replace(
  "mov 16:ss[bp+-18],ax\npush 16:ss[bp+-16]\npush ax",
  "mov 16:ss[bp+-18],ax\npush dx\npush ax",
);
export const centreAnglePatterns = [evenMore, tim1, demo];

const proof = (code: RoutineCode) => code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));

/** Adds the centre angle to the summaries of the routines whose graph matches and that call the angle helper. */
export function addCentreAngleSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout?: BehaviourLayout,
): void {
  const initial = new Map<string, number>();
  for (const name of ["positionX", "positionY", "frameWidth", "frameHeight"]) {
    const field = layout?.fields.find((f) => f.name === name);
    if (!field) return;
    initial.set(name, field.offset);
  }
  for (const code of codes.values()) {
    const bound = centreAnglePatterns.map((p) => matchHeapRoutine(code, p, initial)).find((b) => b);
    const backend = bound && summaries.get(bound.get("backend")!)?.contactMotionAngle;
    const prior = summaries.get(code.address);
    if (!bound || !backend || backend.backend !== bound.get("backend") || backend.wrapper || !prior) continue;
    const centreAngle: CentreAngle = {
      confidence: "inferred",
      evidence: [...proof(code), ...backend.evidence],
      assumptions: [
        ...backend.assumptions,
        "Both arguments are complete parts with valid position and frame size words. Each centre and each difference wraps to a word, and CWD sign-extends the differences before the movement angle helper, whose argument copies the eight-byte cleanup discards. AX holds the helper's answer on return.",
      ],
      routine: code.address,
      arguments: { from: 6, to: 8 },
      fields: {
        positionX: bound.get("positionX")!,
        positionY: bound.get("positionY")!,
        frameWidth: bound.get("frameWidth")!,
        frameHeight: bound.get("frameHeight")!,
      },
      x: "fromMinusTo",
      y: "toMinusFrom",
      backend,
    };
    summaries.set(code.address, {
      ...prior,
      purpose: "Works out the angle of the line from the centre of one part to the centre of another.",
      centreAngle,
    });
  }
}

const signed = (value: number) => (value >= 0x8000 ? value - 0x10000 : value);
const toPi = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * One answer of the centre angle and what the speed setter makes of it: the velocity (`vx`, `vy`, as the setter stores
 * them) and the true directions of the line from the first part's centre to the second's it stands for, in degrees
 * from `from` to `to` going clockwise on the screen (0 is right, 90 down, 180 left, -90 up).
 */
export interface DirectionCase {
  vx: number;
  vy: number;
  from: number;
  to: number;
}

/**
 * Every answer the centre angle can give and the velocity the setter gives for `speed`, or undefined without the
 * loaded tables. Each answer of the helper covers a range of true directions: a ratio index t stands for every smaller
 * to larger difference ratio from t/512 to (t+1)/512. The velocities come from the program's own table words, the
 * helper's folds and the setter's integer arithmetic; host trigonometry only gives the true directions each range
 * stands for. Centres at the same point have no direction and are left out.
 */
export function directionCases(
  angle: ContactMotionAngle,
  velocity: DirectedVelocity,
  speed: number,
): DirectionCase[] | undefined {
  const lookup = angle.lookup.initialImageWords;
  const table = velocity.coefficients.vertical.table.initialImageWords;
  if (lookup?.length !== 512 || table.length !== 2049 || !Number.isInteger(speed) || speed < 0 || speed > 0x7fff)
    return undefined;
  const coefficient = (value: number, phase: number) => {
    const quantised = ((value + phase) & 0xffff) >>> 4;
    return signed(table[quantised & 0x800 ? 0x1000 - quantised : quantised]!);
  };
  // The helper's answer before its folds, for a first-quadrant direction from `low` to `high` radians.
  const answers: [number, number, number][] = [[512, Math.PI / 4, Math.PI / 4]];
  for (let t = 0; t < 512; t++) {
    const low = Math.atan(t / 512),
      high = Math.atan((t + 1) / 512);
    answers.push([lookup[t]!, low, high], [1024 - lookup[t]!, Math.PI / 2 - high, Math.PI / 2 - low]);
  }
  const degrees = (radians: number) => (toPi(radians) * 180) / Math.PI;
  const cases: DirectionCase[] = [];
  for (const [answer, low, high] of answers)
    for (const negativeX of [false, true])
      for (const negativeY of [false, true]) {
        let folded = negativeX ? 2048 - answer : answer;
        folded = negativeY ? 4096 - folded : folded;
        const value = (((folded + 0xfc00) & 0xffff) << 4) & 0xffff;
        // The setter's products, shifted right by 14 as signed longs.
        const vx = Math.floor((speed * coefficient(value, 0xc000)) / 16384),
          vy = Math.floor((speed * coefficient(value, 0)) / 16384);
        // The helper gets x = from - to and y = to - from, so the line from `from` to `to` runs along (-x, y): its
        // direction is pi minus the helper's angle.
        const ends = [low, high].map((quadrant) => {
          let phi = negativeX ? Math.PI - quadrant : quadrant;
          phi = negativeY ? -phi : phi;
          return degrees(Math.PI - phi);
        });
        const [a, b] = ends as [number, number];
        // Clockwise from the smaller end, unless the range crosses the left (180 to -180).
        const [from, to] = Math.abs(a - b) > 180 ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
        cases.push({ vx, vy, from, to });
      }
  return cases;
}

/**
 * The largest angle, in degrees, between the velocity the speed setter gives for `speed` and the direction from the
 * first part's centre to the second's, over every angle the centre angle can return (`directionCases`), or undefined
 * without the loaded tables or when some answer gives no velocity.
 */
export function directionError(
  angle: ContactMotionAngle,
  velocity: DirectedVelocity,
  speed: number,
): number | undefined {
  const cases = directionCases(angle, velocity, speed);
  if (!cases) return undefined;
  let worst = 0;
  for (const { vx, vy, from, to } of cases) {
    if (!vx && !vy) return undefined;
    const set = Math.atan2(vy, vx);
    for (const end of [from, to]) worst = Math.max(worst, Math.abs(toPi(set - (end * Math.PI) / 180)));
  }
  return (worst * 180) / Math.PI;
}
