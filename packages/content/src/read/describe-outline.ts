import type { BehaviourReport, Expression, FieldWrite } from "./behaviour.ts";
import type { OutlineTables } from "./behaviour-outline-tables.ts";

/**
 * A part's outline is a list of four-byte records reached through its outline pointer (the layout's `outlinePoints`,
 * `0x82` in every build): an X byte, a Y byte and an edge word the geometry helper derives from the corners. Writes
 * through that pointer change the part's own outline, not another part, so they are described as outline corners.
 */
export function outlineObject(report: BehaviourReport): string | undefined {
  const field = report.layout.fields.find((item) => item.name === "outlinePoints");
  return field && `referenced-by(part+0x${field.offset.toString(16)})`;
}

/**
 * The object whose outline a write changes, when it writes through an outline pointer: `part` for the part's own, or
 * the object reached otherwise, like a part an overlap search found.
 */
export function outlineOwner(report: BehaviourReport, object: string): string | undefined {
  const field = report.layout.fields.find((item) => item.name === "outlinePoints");
  if (!field) return undefined;
  const suffix = `+0x${field.offset.toString(16)})`;
  return object.startsWith("referenced-by(") && object.endsWith(suffix)
    ? object.slice("referenced-by(".length, -suffix.length)
    : undefined;
}

const SIZES: Record<string, string> = {
  frameWidth: "its frame width",
  frameHeight: "its frame height",
  baseWidth: "its width",
  baseHeight: "its height",
};

/** Reads a value as the byte it is stored in, so adding 255 to a size reads as the size minus 1. */
function words(expression: Expression, report: BehaviourReport, width: number): string | undefined {
  if (expression.kind === "constant") return String(expression.value);
  if (expression.kind === "field" && expression.object === "part") {
    const name = report.layout.fields.find((field) => field.offset === expression.offset)?.name;
    return name ? SIZES[name] : undefined;
  }
  if (expression.kind === "binary" && expression.operator === "+" && expression.right.kind === "constant") {
    const left = words(expression.left, report, width);
    const value = expression.right.value % 2 ** width;
    const amount = value >= 2 ** (width - 1) ? value - 2 ** width : value;
    return left && (amount < 0 ? `${left} - ${-amount}` : `${left} + ${amount}`);
  }
  return undefined;
}

/** Describes one routine path's writes to the outline records, or undefined when none of the writes is one. */
export function outlineWords(
  writes: FieldWrite[],
  report: BehaviourReport,
  object = outlineObject(report),
): string | undefined {
  // Sizes and the subject are the part's own only for its own outline.
  const own = object === outlineObject(report);
  const whose = own ? "its" : "another part's";
  const corners = new Map<number, { x?: string; y?: string }>();
  for (const write of writes) {
    if (write.object !== object || write.width !== 8 || write.offset % 4 > 1) continue;
    const corner = corners.get(write.offset >> 2) ?? {};
    corner[write.offset % 4 ? "y" : "x"] =
      (own || write.value.kind === "constant" ? words(write.value, report, write.width) : undefined) ??
      "a calculated value";
    corners.set(write.offset >> 2, corner);
  }
  if (!corners.size)
    return writes.some((write) => write.object === object) ? `Updates ${whose} outline's edge records.` : undefined;
  const indexes = [...corners.keys()].sort((a, b) => a - b);
  const whole = indexes.every((index, at) => index === at && corners.get(index)!.x && corners.get(index)!.y);
  if (whole)
    return `Sets ${whose} outline to ${indexes.length} corners: ${indexes
      .map((index) => `(${corners.get(index)!.x}, ${corners.get(index)!.y})`)
      .join(", ")}.`;
  return `Moves ${whose} outline ${indexes
    .map((index) => {
      const corner = corners.get(index)!;
      const parts = [corner.x && `x to ${corner.x}`, corner.y && `y to ${corner.y}`].filter(Boolean).join(" and ");
      return `corner ${index + 1} ${parts}`;
    })
    .join(", ")}.`;
}

const RANGES: Record<string, string> = { ">=": "at least", ">": "above", "<": "below", "<=": "at most" };

/** The frame tests of one path in words: "on frame 1" when it tests for one frame, else its ranges. */
function choiceWords(tests: string[]): string {
  const equal = tests.find((test) => test.includes(" == "));
  if (equal) return `on frame ${equal.split(" == ")[1]}`;
  const ranges = tests.filter((test) => !test.includes(" != "));
  if (!ranges.length) return "on any other frame";
  return `on a frame ${ranges
    .map((test) => {
      const [, op, value] = test.split(" ");
      return `${RANGES[op!] ?? op} ${value}`;
    })
    .join(" and ")}`;
}

const FLAG = /^flags & (0x[0-9a-f]+) (==|!=) 0$/;
const FRAME = /^frame == (-?\d+)$/;
const FLAG_WORDS: Record<string, string> = {
  horizontalFlip: "flipped left to right",
  verticalFlip: "flipped top to bottom",
};

/** Frames as words, like "frame 2", "frames 0 and 3" or "frames 0 to 4 and 7". */
function framesWords(frames: number[]): string {
  const runs: [number, number][] = [];
  for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === frame - 1) last[1] = frame;
    else runs.push([frame, frame]);
  }
  const words = runs.map(([start, end]) => (start === end ? `${start}` : `${start} to ${end}`));
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]!;
  return frames.length > 1 ? `frames ${list}` : `frame ${list}`;
}

/**
 * The tests that pick one table in words, when each path tests one frame for equality and drawing flags: "on frames 0
 * to 2 when flipped left to right". Undefined for other tests, like a frame range.
 */
function exactWords(when: string[][], flagNames: Record<number, string>): string | undefined {
  const groups = new Map<string, number[]>();
  let anyFrame = false;
  for (const tests of when) {
    const frames: number[] = [];
    const flags: string[] = [];
    for (const test of tests) {
      const frame = FRAME.exec(test);
      const flag = FLAG.exec(test);
      if (frame) frames.push(Number(frame[1]));
      else if (flag) {
        const name = flagNames[Number(flag[1])];
        const words = (name && FLAG_WORDS[name]) ?? `drawing flag ${flag[1]} set`;
        flags.push(flag[2] === "!=" ? words : `not ${words}`);
      } else return undefined;
    }
    if (frames.length > 1) return undefined;
    const key = flags.length ? `when ${flags.join(" and ")}` : "";
    if (frames.length) anyFrame = true;
    groups.set(key, [...(groups.get(key) ?? []), ...frames]);
  }
  return [...groups]
    .map(([flags, frames]) =>
      [anyFrame && frames.length ? `on ${framesWords(frames)}` : "", flags].filter(Boolean).join(" "),
    )
    .join(", or ");
}

/**
 * Describes a callback that copies its outline from tables chosen by its frame or drawing flags. `flagNames` names the
 * drawing flag bits, like `horizontalFlip` for 0x10.
 */
export function outlineTableWords(copy: OutlineTables, flagNames: Record<number, string> = {}): string {
  const corners = (list: [number, number][]) => list.map(([x, y]) => `(${x}, ${y})`).join(", ");
  if (copy.tables.length === 1)
    return `Sets its outline to ${copy.tables[0]!.corners.length} corners from a table: ${corners(copy.tables[0]!.corners)}.`;
  const exact = copy.tables.map((table) => exactWords(table.when, flagNames));
  if (exact.every((words) => words !== undefined)) {
    const by = copy.tables.some((table) => table.when.some((tests) => tests.some((test) => FLAG.test(test))))
      ? copy.tables.some((table) => table.when.some((tests) => tests.some((test) => FRAME.test(test))))
        ? "its frame and how it is flipped"
        : "how it is flipped"
      : "its frame";
    const first = (table: OutlineTables["tables"][number]) =>
      Math.min(...table.when.flatMap((tests) => tests.flatMap((test) => Number(FRAME.exec(test)?.[1] ?? Infinity))));
    const flipped = (table: OutlineTables["tables"][number]) =>
      table.when.some((tests) => tests.some((test) => FLAG.exec(test)?.[2] === "!=")) ? 1 : 0;
    const order = copy.tables
      .map((table, k) => ({ table, words: exact[k]! }))
      .sort((a, b) => first(a.table) - first(b.table) || flipped(a.table) - flipped(b.table));
    return `Copies its outline from a table chosen by ${by}: ${order
      .map(({ table, words }) => `${words}, ${table.corners.length} corners ${corners(table.corners)}`)
      .join("; ")}.`;
  }
  const order = (words: string) =>
    words === "on any other frame"
      ? Infinity
      : Number(/\d+/.exec(words)?.[0] ?? 0) + (words.includes("below") ? -0.5 : 0);
  const choices = copy.tables
    .map((table) => ({ words: table.when.map(choiceWords).join(" or "), table }))
    .sort((a, b) => order(a.words) - order(b.words));
  return `Copies its outline from a table chosen by its frame: ${choices
    .map(({ words, table }) => `${words}, ${table.corners.length} corners ${corners(table.corners)}`)
    .join("; ")}.`;
}
