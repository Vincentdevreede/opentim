/**
 * Every assumption the behaviour analysis states, collected from its reports into one generated list, so they can be
 * rechecked later. A check fails when the analysis states an assumption the list doesn't have yet, so none slips in
 * unseen. The decided ones are explained by hand in docs/behaviour-assumptions.md.
 */
import type { BehaviourReport } from "./behaviour.ts";
import { DECIDED_ASSUMPTIONS } from "./behaviour-assumptions.ts";

/** How one assumption is used in one build: by how many findings, and by which parts. */
export interface AssumptionUse {
  findings: number;
  parts: Set<string>;
}

/** The text an assumption is listed by: program addresses differ between builds, so they are left out. */
export const assumptionKey = (text: string) => text.replace(/\b0x[0-9a-f]{4,}\b/gi, "<address>");

/** The assumptions of one report, with the findings that state them and the parts whose findings those are. */
export function collectAssumptions(report: BehaviourReport): Map<string, AssumptionUse> {
  const uses = new Map<string, AssumptionUse>();
  const partsOfRoutine = new Map<number, string[]>();
  for (const part of report.parts)
    for (const routine of part.routines)
      partsOfRoutine.set(routine.address, [...(partsOfRoutine.get(routine.address) ?? []), part.id]);
  const visit = (value: unknown, parts: readonly string[]) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parts);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.assumptions))
      for (const text of new Set(item.assumptions.filter((a): a is string => typeof a === "string"))) {
        const key = assumptionKey(text);
        const use = uses.get(key) ?? { findings: 0, parts: new Set<string>() };
        use.findings++;
        for (const part of parts) use.parts.add(part);
        uses.set(key, use);
      }
    for (const [name, child] of Object.entries(item)) if (name !== "assumptions") visit(child, parts);
  };
  const { parts, routines, ...rest } = report;
  visit(rest, []);
  for (const part of parts) visit(part, [part.id]);
  for (const routine of routines) visit(routine, partsOfRoutine.get(routine.address) ?? []);
  return uses;
}

type Game = "tim1" | "evenmore";
/** The uses of each assumption in the builds of each game. */
export type AssumptionTable = Map<string, Record<Game, { builds: number; findings: number; parts: Set<string> }>>;

/** Adds one build's uses to the table. */
export function addBuild(table: AssumptionTable, game: Game, uses: Map<string, AssumptionUse>): void {
  for (const [key, use] of uses) {
    const row = table.get(key) ?? {
      tim1: { builds: 0, findings: 0, parts: new Set<string>() },
      evenmore: { builds: 0, findings: 0, parts: new Set<string>() },
    };
    row[game].builds++;
    row[game].findings = Math.max(row[game].findings, use.findings);
    for (const part of use.parts) row[game].parts.add(part);
    table.set(key, row);
  }
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const PARTS_SHOWN = 6;
function partsText(parts: Set<string>): string {
  const list = [...parts].sort();
  if (!list.length) return "none, shared";
  return list.length > PARTS_SHOWN
    ? `${list.slice(0, PARTS_SHOWN).join(", ")} and ${list.length - PARTS_SHOWN} more`
    : list.join(", ");
}

/** The generated list, from the table of every build read. */
export function renderAssumptions(table: AssumptionTable, builds: Record<Game, number>): string {
  const decided = new Set(DECIDED_ASSUMPTIONS.flatMap((group) => group.assumptions).map(assumptionKey));
  const use = (row: NonNullable<ReturnType<AssumptionTable["get"]>>, game: Game) =>
    row[game].builds ? `${row[game].findings.toLocaleString("en-GB")} · ${row[game].builds}/${builds[game]}` : "–";
  const total = (key: string) => table.get(key)!.tim1.findings + table.get(key)!.evenmore.findings;
  const lines = [
    "# All behaviour assumptions",
    "",
    "Generated from the game files; don't edit it by hand. Every assumption the static behaviour analysis states, read",
    "from the supplied builds. Most are general rules about the compiler and memory. The ones decided during the",
    "research are marked **decided** and explained in [the decided assumptions](behaviour-assumptions.md).",
    "",
    "Regenerate it after changing the analysis, with every build you have:",
    "",
    "```sh",
    "pnpm --filter @opentim/content list-assumptions --out ../../docs/behaviour-assumptions-all.md --tim1 <game folder> --evenmore <game folder>",
    "```",
    "",
    "With `--check` instead of `--out`, the command fails when the analysis states an assumption this list doesn't",
    "have, and names the ones this list has that the builds no longer state.",
    "",
    "Program addresses are written as `<address>`, since they differ between builds. A game's column gives the most",
    "findings stating the assumption in one build, then in how many of the builds read it appears. Parts are those whose",
    "own findings or routines state it; `none, shared` means only shared helpers and report-wide findings do.",
    "",
    `Read from ${builds.tim1} TIM 1 and ${builds.evenmore} Even More builds: ${table.size} assumptions, most used first.`,
    "",
    "| Assumption | TIM 1 | Even More | Parts |",
    "| --- | --- | --- | --- |",
  ];
  for (const key of [...table.keys()].sort((a, b) => total(b) - total(a) || a.localeCompare(b))) {
    const row = table.get(key)!;
    const parts = partsText(new Set([...row.tim1.parts, ...row.evenmore.parts]));
    lines.push(
      `| ${decided.has(key) ? "**decided** " : ""}${cell(key)} | ${use(row, "tim1")} | ${use(row, "evenmore")} | ${parts} |`,
    );
  }
  return lines.join("\n") + "\n";
}

/** The assumptions the generated list's table holds. */
export function listedAssumptions(document: string): Set<string> {
  const listed = new Set<string>();
  const start = document.indexOf("| Assumption |");
  if (start < 0) return listed;
  for (const line of document.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("| ")) break;
    const first = line.slice(2).split(/(?<!\\)\|/)[0]!;
    listed.add(
      first
        .trim()
        .replace(/^\*\*decided\*\* /, "")
        .replace(/\\\|/g, "|"),
    );
  }
  return listed;
}

/** What the builds state that the list doesn't have, and what it has that they no longer state. */
export function compareAssumptions(table: AssumptionTable, document: string): { missing: string[]; stale: string[] } {
  const listed = listedAssumptions(document);
  return {
    missing: [...table.keys()].filter((key) => !listed.has(key)).sort(),
    stale: [...listed].filter((key) => !table.has(key)).sort(),
  };
}
