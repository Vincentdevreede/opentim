/**
 * Lines for the parts a part makes with the part factory, like the gun's bullet: which part it makes, where, how fast,
 * and which other fields of the new part the routine sets. Each line comes from one way through the routine, with the
 * fields that way leaves on the new part.
 */
import {
  speedLimitOf,
  type BehaviourReport,
  type Expression,
  type FieldWrite,
  type Finding,
  type Predicate,
} from "./behaviour.ts";
import type { CreatedPart } from "./behaviour-created-parts.ts";
import { nameOf } from "./describe-effects.ts";
import { formula, type Names } from "./describe-touch.ts";

const CREATED = /^(?:nullable allocation|fresh object) returned at (0x[0-9a-f]+)$/;

/** The part a routine makes, for a write to the object its factory call returns, when the type it passes is known. */
export function createdPartOf(report: BehaviourReport, object: string): CreatedPart | undefined {
  const match = CREATED.exec(object);
  if (!match) return undefined;
  const call = Number(match[1]);
  return report.createdParts?.find((created) => created.call === call);
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;
const terms = (p: Predicate): Predicate[] => (p.kind === "and" ? p.terms : p.kind === "true" ? [] : [p]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Adds the numbers of a sum, so `(x + 65520) + 96` reads `x + 80` and `x + 65504` reads `x - 32`. */
function tidy(e: Expression): Expression {
  if (e.kind !== "binary" || e.operator !== "+" || e.right.kind !== "constant" || e.width !== 16) return e;
  let left = tidy(e.left),
    sum = e.right.value;
  if (
    left.kind === "binary" &&
    (left.operator === "+" || left.operator === "-") &&
    left.right.kind === "constant" &&
    left.width === 16
  ) {
    sum += left.operator === "+" ? left.right.value : -left.right.value;
    left = left.left;
  }
  sum = ((sum % 0x10000) + 0x10000) % 0x10000;
  if (!sum) return left;
  return sum >= 0x8000
    ? { ...e, left, operator: "-", right: { kind: "constant", value: 0x10000 - sum, width: 16 } }
    : { ...e, left, right: { kind: "constant", value: sum, width: 16 } };
}
const unknownIn = (e: Expression): boolean =>
  e.kind === "unknown" || (e.kind === "binary" && (unknownIn(e.left) || unknownIn(e.right)));
/** A value short enough to give: a number, or a field of a part, plus or minus a number. */
const simple = (e: Expression, own: string): boolean =>
  e.kind === "constant" ||
  (e.kind === "field" && e.object !== own) ||
  (e.kind === "binary" &&
    ["+", "-"].includes(e.operator) &&
    e.left.kind === "field" &&
    e.left.object !== own &&
    e.right.kind === "constant");

export interface CreatedPartLine {
  description: string;
  condition: Predicate;
  routine: number;
  items: Finding[];
}

/** One line per way through the routine that leaves fields on a part it makes. */
export function createdPartLines(
  report: BehaviourReport,
  routine: { address: number; outcomes?: { condition: Predicate; fields: FieldWrite[] }[]; writes: FieldWrite[] },
): CreatedPartLine[] {
  const names = new Map(report.layout.fields.map((field) => [field.offset, field.name]));
  const fieldName = (offset: number) => names.get(offset) ?? hex(offset);
  const lines: CreatedPartLine[] = [];
  for (const outcome of routine.outcomes ?? []) {
    const objects = new Map<string, FieldWrite[]>();
    for (const write of outcome.fields)
      if (createdPartOf(report, write.object)) objects.set(write.object, [...(objects.get(write.object) ?? []), write]);
    for (const [object, writes] of objects) {
      const created = createdPartOf(report, object)!;
      const id = report.parts.find((part) => part.type === created.type)?.id;
      const what = id ? nameOf(id) : `new part`;
      const article = /^[aeiou]/.test(what) ? "an" : "a";
      const wordsOf: Names = {
        field: fieldName,
        of: (owner, field) =>
          owner === "part"
            ? `its ${field}`
            : owner === object
              ? `the ${what}'s ${field}`
              : /^referenced-by\(part\+0x(54|66|68)\)$/.test(owner)
                ? `${field} of the record of its ${owner.includes("54") ? "belt" : "rope"} at 0x${owner.slice(-3, -1)}`
                : `${field} of ${owner}`,
      };
      const byOffset = new Map(writes.map((write) => [write.offset, write]));
      const place: string[] = [];
      const speed: string[] = [];
      const given: string[] = [];
      const other: string[] = [];
      let links = false,
        limited = false;
      for (const write of [...writes].sort((a, b) => a.offset - b.offset)) {
        const name = fieldName(write.offset);
        const into = name === "positionX" || name === "positionY" ? place : name.startsWith("velocity") ? speed : given;
        if (
          (write.value.kind === "unknown" && /ordered-list/.test(write.value.reason)) ||
          (write.value.kind === "field" && / in the ordered list after the insertion at /.test(write.value.object))
        ) {
          links = true;
          continue;
        }
        if (write.value.kind === "unknown" && /contact-velocity-limit/.test(write.value.reason)) {
          // The value the routine stored on this way before the speed limit: its one store there apart from the
          // limit's own, when it has one and it is known. Without one, the new part's own value goes in.
          limited = true;
          const stores = routine.writes.filter(
            (item) =>
              item.object === object &&
              item.offset === write.offset &&
              !same(item.value, write.value) &&
              terms(item.condition).every((term) => terms(outcome.condition).some((known) => same(term, known))),
          );
          const before = new Set(stores.map((item) => JSON.stringify(item.value)));
          if (stores.some((item) => unknownIn(item.value)) || before.size > 1) other.push(name);
          else
            into.push(
              before.size
                ? `${name}${into === given ? " to" : " ="} ${formula(tidy(JSON.parse([...before][0]!) as Expression), wordsOf)}`
                : `the ${what}'s starting ${name}`,
            );
          continue;
        }
        const kept = speedLimitOf(write.value);
        if (kept) {
          // The speed the routine gave before the limit, or the new part's own speed when it gave none.
          limited = true;
          const own = kept.speed.kind === "field" && kept.speed.object === object && kept.speed.offset === write.offset;
          if (own) into.push(`the ${what}'s starting ${name}`);
          else if (unknownIn(kept.speed)) other.push(name);
          else into.push(`${name}${into === given ? " to" : " ="} ${formula(tidy(kept.speed), wordsOf)}`);
          continue;
        }
        const value = tidy(write.value);
        if ((into !== given || simple(value, object)) && !unknownIn(value))
          into.push(`${name}${into === given ? " to" : " ="} ${formula(value, wordsOf)}`);
        else other.push(name);
      }
      const start = report.creation
        ?.find((item) => item.partType === created.type)
        ?.fields.find((field) => field.name === "state");
      const starts = start ? `, which starts on frame ${start.value}` : "";
      const first = id
        ? `Creates ${article} ${what} (type ${created.type}${starts})`
        : `Creates a part of type ${created.type}${starts}${starts ? "," : ""}`;
      const moving = speed.length
        ? `, moving at ${list(speed)}${limited ? ` (${speed.length > 1 ? "each " : ""}kept within the ${what}'s speed limit)` : ""}`
        : "";
      const rest = [
        ...(given.length ? [`sets ${list(given)}`] : []),
        ...(links ? [`links it into a list of parts`] : []),
        ...(other.length ? [`${given.length ? "changes" : "sets"} its ${list(other)}`] : []),
      ];
      const description = `${first}${place.length ? ` at ${list(place)}` : ""}${moving}.${rest.length ? ` It also ${list(rest)}.` : ""}`;
      lines.push({
        description,
        condition: outcome.condition,
        routine: routine.address,
        items: [created, ...[...byOffset.values()]],
      });
    }
  }
  return lines;
}
const list = (items: string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
