/**
 * Extracts static behaviour reports from local game files. Reports are derived data and belong outside src/lists.
 * They leave out the loops read once for each type of found part (`readLoopsPerType`): those ways would make a report
 * too large to write, and they only add what parts do to each other, which `list-other-part-pairs` and the Lab read
 * from the game files themselves.
 *
 *   pnpm --filter @opentim/content extract-behaviour --out <folder> --tim1 <game folder> --evenmore <game folder>
 */
import { createHash } from "node:crypto";
import { createEvidenceWriter } from "../src/read/behaviour-evidence.ts";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import { readBehaviourInSteps, transitionCounts, type BehaviourReport } from "../src/read/behaviour.ts";
import { partSemantics } from "../src/read/behaviour-build-comparison.ts";
import { readProgramParts } from "../src/read/parts.ts";

function readResources(folder: string): Map<string, Uint8Array> {
  const at = [folder, dirname(folder)].find((dir) => readdirSync(dir).some(isArchiveName));
  if (!at) throw new Error(`${folder}: no RESOURCE files here or in the parent folder`);
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(at).filter(isArchiveName).sort())
    for (const entry of readArchive(readFileSync(join(at, name)), name)) files.set(entry.name, entry.data);
  return files;
}

function timingSemantics(timing: BehaviourReport["timing"]) {
  return {
    pit: timing.pit
      ? { parameter: timing.pit.parameter, divisor: timing.pit.divisor, confidence: timing.pit.confidence }
      : null,
    cycle: timing.cycle
      ? {
          reset: timing.cycle.reset,
          minimumInterrupts: timing.cycle.minimumInterrupts,
          minimumPeriodMilliseconds: timing.cycle.minimumPeriodMilliseconds,
          confidence: timing.cycle.confidence,
        }
      : null,
  };
}

/** Writes top-level collections one item at a time, keeping a whole report out of the string heap. */
function writeReport(path: string, source: { folder: string; sha256: string }, report: BehaviourReport) {
  const evidence = createEvidenceWriter();
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, "w");
  try {
    writeFileSync(fd, "{");
    let first = true;
    for (const [key, value] of Object.entries({ evidenceEncoding: evidence.encoding, source, ...report })) {
      if (value === undefined) continue;
      writeFileSync(fd, `${first ? "" : ","}${JSON.stringify(key)}:`);
      first = false;
      if (Array.isArray(value)) {
        writeFileSync(fd, "[");
        for (const [index, item] of value.entries())
          writeFileSync(fd, `${index ? "," : ""}${evidence.stringify(item)}`);
        writeFileSync(fd, "]");
      } else writeFileSync(fd, evidence.stringify(value));
    }
    writeFileSync(
      fd,
      `,"evidencePool":${JSON.stringify(evidence.pool)},"assumptionPool":${JSON.stringify(evidence.assumptionPool)}}\n`,
    );
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

function partSummary(part: BehaviourReport["parts"][number], report: BehaviourReport) {
  const semantics = partSemantics(part, report);
  const hashes = Object.fromEntries(
    Object.entries(semantics).map(([scope, fields]) => [
      scope,
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          createHash("sha256").update(JSON.stringify(value)).digest("hex"),
        ]),
      ),
    ]),
  ) as {
    resolved: Record<string, string>;
    unresolved: Record<string, string>;
  };
  const callbacks = part.routines.map((callback) =>
    report.routines.find((routine) => routine.address === callback.address),
  );
  const partial = callbacks.filter((routine) => !routine || routine.status !== "complete").length;
  const counts = transitionCounts(part.transitions);
  const notes = [
    ...part.uncertainties.slice(0, 2),
    ...(part.uncertainties.length > 2 ? [`${part.uncertainties.length - 2} further uncertainties in JSON`] : []),
    `${partial} incomplete callbacks; ${counts.unresolved} unresolved transition conditions; ${counts.conditional} conditional on run values; ${counts.unknownWrites} with unknown writes; ${counts.callWritten} with values a call writes but nobody follows; ${counts.namedRunValues} with named run values`,
  ];
  const row = `| ${part.type}: ${part.id} | ${part.stateWrites.length} | ${part.transitions.length} | ${part.reset.length} | ${part.counters.length} | ${part.visibleEffects.length} | ${notes.join("; ").replaceAll("|", "\\|").replaceAll("\n", " ")} |`;
  return { type: part.type, id: part.id, semantics: hashes, row };
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
  options: {
    out: { type: "string" },
    tim1: { type: "string", multiple: true },
    evenmore: { type: "string", multiple: true },
  },
});
if (!values.out || (!values.tim1?.length && !values.evenmore?.length))
  throw new Error("Give --out <report folder> and at least one --tim1 <game folder> or --evenmore <game folder>");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const failures: { listId: string; folder: string; error: string }[] = [];
const results: {
  source: { folder: string; sha256: string };
  filename: string;
  listId: string;
  parts: ReturnType<typeof partSummary>[];
  timing: ReturnType<typeof timingSemantics>;
}[] = [];
for (const listId of ["tim1", "evenmore"] as const) {
  for (const [index, folderValue] of (values[listId] ?? []).entries()) {
    const folder = resolve(folderValue);
    try {
      const program = readFileSync(join(folder, "TIM.EXE"));
      const files = readResources(folder);
      const parts = readProgramParts(
        listId,
        program,
        (sheet) => {
          const data = files.get(`${sheet}.BMP`);
          return data && decodeImage(data).frames.length;
        },
        (sheet) => files.get(`${sheet}.BMP`),
      );
      const started = performance.now();
      const { report } = readBehaviourInSteps(program, parts);
      const milliseconds = performance.now() - started;
      const source = { folder, sha256: createHash("sha256").update(program).digest("hex") };
      const name = basename(folder)
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      const filename = `${listId}-${String(index + 1).padStart(2, "0")}-${name}.json`;
      writeReport(join(out, filename), source, report);
      writeFileSync(
        join(out, filename.replace(/\.json$/, ".metrics.json")),
        JSON.stringify({ milliseconds }, null, 2) + "\n",
      );
      results.push({
        source,
        filename,
        listId: report.listId,
        parts: report.parts.map((part) => partSummary(part, report)),
        timing: timingSemantics(report.timing),
      });
      const incomplete = report.routines.filter((routine) => routine.status !== "complete").length;
      console.log(
        `${listId}: ${folder}: ${report.parts.length} parts, ${report.routines.length} routines, ${incomplete} incomplete, ${milliseconds.toFixed(1)} ms`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ listId, folder, error: message });
      console.error(`${listId}: ${folder}: ${message}`);
    }
  }
}
const comparisons = results.flatMap((current, index) => {
  const first = results.find((item) => item.listId === current.listId);
  if (!first || first === current) return [];
  const parts = current.parts.flatMap((part) => {
    const baseline = first.parts.find((item) => item.type === part.type);
    const left = baseline?.semantics;
    const right = part.semantics;
    if (JSON.stringify(left) === JSON.stringify(right)) return [];
    const resolvedFields = Object.keys(right.resolved).filter(
      (key) => JSON.stringify(left?.resolved[key]) !== JSON.stringify(right.resolved[key]),
    );
    const unresolvedFields = Object.keys(right.unresolved).filter(
      (key) => JSON.stringify(left?.unresolved[key]) !== JSON.stringify(right.unresolved[key]),
    );
    return [
      {
        type: part.type,
        id: part.id,
        fields: [
          ...resolvedFields.map((field) => `resolved.${field}`),
          ...unresolvedFields.map((field) => `unresolved.${field}`),
        ],
        resolvedFields,
        unresolvedFields,
      },
    ];
  });
  const missingTypes = first.parts
    .filter((part) => !current.parts.some((item) => item.type === part.type))
    .map((part) => part.type);
  return [
    {
      index,
      listId: current.listId,
      baseline: first.filename,
      other: current.filename,
      differences: parts,
      timingDiffers: JSON.stringify(first.timing) !== JSON.stringify(current.timing),
      missingTypes,
      qualification:
        "Resolved finding differences and unresolved summary differences are separate. Differences can reflect analysis coverage rather than program behaviour. Equal summaries do not prove equal unresolved behaviour; table contents and cross-build global-variable identities are unresolved.",
    },
  ];
});
writeFileSync(join(out, "comparisons.json"), JSON.stringify(comparisons, null, 2) + "\n");
writeFileSync(join(out, "failures.json"), JSON.stringify(failures, null, 2) + "\n");
const lines = [
  "# Static behaviour extraction",
  "",
  "The extractor decodes instructions and follows control flow. It does not execute or emulate the program.",
  "",
  "Each JSON file contains the executable hash, source folder and instruction evidence. Unresolved paths remain explicit.",
  "",
  "Equal extracted summaries across builds are evidence of agreement within coverage, not proof that unresolved behaviour agrees.",
  "",
];
for (const { source, filename, listId, parts } of results) {
  lines.push(
    `## ${listId}: ${source.folder}`,
    "",
    `Source SHA-256: \`${source.sha256}\`. Details: [${filename}](${filename}).`,
    "",
    "| Part | State writes | Transitions | Reset writes | Counters | Visible effects | Uncertain |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...parts.map((part) => part.row),
    "",
  );
}
lines.push("## Build comparisons", "");
for (const comparison of comparisons)
  lines.push(
    `${comparison.other} against ${comparison.baseline}: ${comparison.differences.length} part summaries differ${comparison.differences.length ? ` (${comparison.differences.map((part) => `${part.type}: ${part.fields.join(", ")}`).join("; ")})` : ""}; ${comparison.missingTypes.length} missing types.`,
    "",
  );
if (failures.length)
  lines.push("## Extraction failures", "", ...failures.map((failure) => `- ${failure.folder}: ${failure.error}`), "");
writeFileSync(join(out, "report.md"), lines.join("\n") + "\n");
if (failures.length) process.exitCode = 1;
console.log(`Wrote ${results.length} build reports to ${out}; ${failures.length} failures`);
