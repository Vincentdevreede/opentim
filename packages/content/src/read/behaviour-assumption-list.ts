/**
 * Every assumption the behaviour analysis states, collected from its reports into one generated list, so they can be
 * rechecked later. A check fails when the analysis states an assumption the list doesn't have yet, so none slips in
 * unseen. The decided ones are explained by hand in docs/assumptions/behaviour-assumptions.md.
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

type Game = "tim1" | "evenmore" | "tim2" | "toons";
const GAMES: Game[] = ["tim1", "evenmore", "tim2", "toons"];
const GAME_NAMES: Record<Game, string> = { tim1: "TIM 1", evenmore: "Even More", tim2: "TIM 2", toons: "Toons" };
/** The games the list always has a column for; the others get one when builds of theirs were read. */
const ALWAYS_SHOWN: Game[] = ["tim1", "evenmore"];
type GameUse = { builds: number; findings: number; parts: Set<string> };
/** The uses of each assumption in the builds of each game. */
export type AssumptionTable = Map<string, Partial<Record<Game, GameUse>>>;

/** Adds one build's uses to the table. */
export function addBuild(table: AssumptionTable, game: Game, uses: Map<string, AssumptionUse>): void {
  for (const [key, use] of uses) {
    const row = table.get(key) ?? {
      tim1: { builds: 0, findings: 0, parts: new Set<string>() },
      evenmore: { builds: 0, findings: 0, parts: new Set<string>() },
    };
    const cell = (row[game] ??= { builds: 0, findings: 0, parts: new Set<string>() });
    cell.builds++;
    cell.findings = Math.max(cell.findings, use.findings);
    for (const part of use.parts) cell.parts.add(part);
    table.set(key, row);
  }
}

/**
 * A table cell: a backslash, pipe or `<` gets a backslash in front, so the text reads back exactly and a placeholder
 * like `<address>` shows as text instead of being taken for HTML.
 */
const cell = (text: string) => text.replace(/[\\|<]/g, (c) => `\\${c}`).replace(/\n/g, " ");
const PARTS_SHOWN = 6;
function partsText(parts: Set<string>): string {
  const list = [...parts].sort();
  if (!list.length) return "none, shared";
  return list.length > PARTS_SHOWN
    ? `${list.slice(0, PARTS_SHOWN).join(", ")} and ${list.length - PARTS_SHOWN} more`
    : list.join(", ");
}

/** The generated list, from the table of every build read. */
export function renderAssumptions(table: AssumptionTable, builds: Partial<Record<Game, number>>): string {
  const decided = new Set(DECIDED_ASSUMPTIONS.flatMap((group) => group.assumptions).map(assumptionKey));
  const games = GAMES.filter((game) => ALWAYS_SHOWN.includes(game) || builds[game]);
  const use = (row: NonNullable<ReturnType<AssumptionTable["get"]>>, game: Game) =>
    row[game]?.builds
      ? `${row[game].findings.toLocaleString("en-GB")} · ${row[game].builds}/${builds[game] ?? 0}`
      : "–";
  const total = (key: string) => games.reduce((n, game) => n + (table.get(key)![game]?.findings ?? 0), 0);
  const counts = games.map((game) => `${builds[game] ?? 0} ${GAME_NAMES[game]}`);
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
    "pnpm --filter @opentim/content list-assumptions --out ../../docs/assumptions/behaviour-assumptions-all.md --tim1 <game folder> --evenmore <game folder>",
    "```",
    "",
    "With `--check` instead of `--out`, the command fails when the analysis states an assumption this list doesn't",
    "have, and names the ones this list has that the builds no longer state.",
    "",
    "Program addresses are written as `<address>`, since they differ between builds. A game's column gives the most",
    "findings stating the assumption in one build, then in how many of the builds read it appears. Parts are those whose",
    "own findings or routines state it; `none, shared` means only shared helpers and report-wide findings do.",
    "",
    `Read from ${counts.slice(0, -1).join(", ")} and ${counts.at(-1)} builds: ${table.size} assumptions, most used first.`,
    "",
    `| Assumption | ${games.map((game) => GAME_NAMES[game]).join(" | ")} | Parts |`,
    `| --- | ${games.map(() => "---").join(" | ")} | --- |`,
  ];
  for (const key of [...table.keys()].sort((a, b) => total(b) - total(a) || a.localeCompare(b))) {
    const row = table.get(key)!;
    const parts = partsText(new Set(games.flatMap((game) => [...(row[game]?.parts ?? [])])));
    lines.push(
      `| ${decided.has(key) ? "**decided** " : ""}${cell(key)} | ${games.map((game) => use(row, game)).join(" | ")} | ${parts} |`,
    );
  }
  return lines.join("\n") + "\n";
}

/** The assumptions the generated list's table holds. */
function listedAssumptions(document: string): Set<string> {
  const listed = new Set<string>();
  const start = document.indexOf("| Assumption |");
  if (start < 0) return listed;
  for (const line of document.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("| ")) break;
    // The first cell ends at the first pipe without a backslash; a backslash keeps the character after it.
    let first = "";
    for (let at = 2; at < line.length && line[at] !== "|"; at++)
      first += line[at] === "\\" ? (line[++at] ?? "") : line[at];
    listed.add(first.trim().replace(/^\*\*decided\*\* /, ""));
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
