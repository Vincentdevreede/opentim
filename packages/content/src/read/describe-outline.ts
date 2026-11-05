import type { BehaviourReport, Expression, FieldWrite } from "./behaviour.ts";

/**
 * A part's outline is a list of four-byte records reached through its outline pointer (the layout's `outlinePoints`,
 * `0x82` in every build): an X byte, a Y byte and an edge word the geometry helper derives from the corners. Writes
 * through that pointer change the part's own outline, not another part, so they are described as outline corners.
 */
export function outlineObject(report: BehaviourReport): string | undefined {
  const field = report.layout.fields.find((item) => item.name === "outlinePoints");
  return field && `referenced-by(part+0x${field.offset.toString(16)})`;
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
export function outlineWords(writes: FieldWrite[], report: BehaviourReport): string | undefined {
  const object = outlineObject(report);
  const corners = new Map<number, { x?: string; y?: string }>();
  for (const write of writes) {
    if (write.object !== object || write.width !== 8 || write.offset % 4 > 1) continue;
    const corner = corners.get(write.offset >> 2) ?? {};
    corner[write.offset % 4 ? "y" : "x"] = words(write.value, report, write.width) ?? "a calculated value";
    corners.set(write.offset >> 2, corner);
  }
  if (!corners.size)
    return writes.some((write) => write.object === object) ? "Updates its outline's edge records." : undefined;
  const indexes = [...corners.keys()].sort((a, b) => a - b);
  const whole = indexes.every((index, at) => index === at && corners.get(index)!.x && corners.get(index)!.y);
  if (whole)
    return `Sets its outline to ${indexes.length} corners: ${indexes
      .map((index) => `(${corners.get(index)!.x}, ${corners.get(index)!.y})`)
      .join(", ")}.`;
  return `Moves outline ${indexes
    .map((index) => {
      const corner = corners.get(index)!;
      const parts = [corner.x && `x to ${corner.x}`, corner.y && `y to ${corner.y}`].filter(Boolean).join(" and ");
      return `corner ${index + 1} ${parts}`;
    })
    .join(", ")}.`;
}
