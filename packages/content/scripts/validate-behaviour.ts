/**
 * Checks static graphs against v25's saved callback measurements, without running the measurement code.
 *
 *   pnpm --filter @opentim/content validate-behaviour --reports <folder> --oracle <v25/animations.json> --out <folder>
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BehaviourReport } from "../src/read/behaviour.ts";
import { measuredClips, validateMeasuredPart, type MeasurementCoverage } from "../src/read/behaviour-validation.ts";

interface BuildReport extends BehaviourReport {
  source: { folder: string; sha256: string };
}

function statePairs(coverage: MeasurementCoverage, status: "missed" | "unresolved") {
  const pairs = new Map<string, { from: number; to: number; occurrences: number; exampleClips: string[] }>();
  for (const step of coverage.transitions) {
    if (step.unchanged || step.status !== status) continue;
    const key = `${step.from}:${step.to}`;
    const pair = pairs.get(key) ?? { from: step.from, to: step.to, occurrences: 0, exampleClips: [] };
    pair.occurrences++;
    if (pair.exampleClips.length < 3 && !pair.exampleClips.includes(step.clip)) pair.exampleClips.push(step.clip);
    pairs.set(key, pair);
  }
  return [...pairs.values()].sort((left, right) => left.from - right.from || left.to - right.to);
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
  options: {
    reports: { type: "string" },
    oracle: { type: "string" },
    models: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.reports || !values.oracle || !values.out)
  throw new Error("Give --reports <report folder>, --oracle <v25 animations.json> and --out <validation folder>");
const reportsFolder = resolve(values.reports);
const oraclePath = resolve(values.oracle);
const modelsFolder = values.models ? resolve(values.models) : join(dirname(oraclePath), "models");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const oracle = readJson(oraclePath);
if (!object(oracle)) throw new Error("The oracle must be an object keyed by measured game version");
const oracleSha256 = createHash("sha256").update(readFileSync(oraclePath)).digest("hex");
const versions = Object.keys(oracle).map((version) => {
  const metadata = readJson(join(modelsFolder, `${version}.json`));
  if (
    !object(metadata) ||
    typeof metadata.sourceExeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(metadata.sourceExeSha256)
  )
    throw new Error(`${version}: model metadata has no complete executable SHA-256`);
  return { version, sha256: metadata.sourceExeSha256.toLowerCase() };
});
const totals = { builds: 0, parts: 0, clips: 0, checked: 0, inferred: 0, unresolved: 0, missed: 0, unchangedSteps: 0 };
const lines = [
  "# Static graph coverage against v25 measurements",
  "",
  "The validator reads saved frames and checks static graph expressions. It never runs the game or its callbacks.",
  "",
  `Oracle SHA-256: \`${oracleSha256}\`.`,
  "",
  "Only reports whose executable hash exactly matches the oracle model are eligible. Other builds are listed as unmatched.",
  "",
  "Checked and inferred counts describe changed-state steps. Unchanged steps are checked against explicit graph edges preserving state and counted separately. Conditions using unrecorded fields remain unresolved.",
  "",
];
const unmatched: { filename: string; sha256: string }[] = [];
const matched = new Set<string>();
for (const filename of readdirSync(reportsFolder)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const data = readJson(join(reportsFolder, filename));
  if (!object(data) || !object(data.source) || typeof data.source.sha256 !== "string" || !Array.isArray(data.parts))
    continue;
  const report = data as unknown as BuildReport;
  const version = versions.find((item) => item.sha256 === report.source.sha256.toLowerCase());
  if (!version) {
    unmatched.push({ filename, sha256: report.source.sha256 });
    continue;
  }
  matched.add(version.version);
  const measured = oracle[version.version];
  if (!object(measured)) throw new Error(`${version.version}: the oracle part list is malformed`);
  const parts = report.parts.map((part) => {
    const clips = measuredClips(measured[String(part.type)], `${version.version}.${part.type}`);
    const run = part.routines.find((callback) => callback.slot === 1);
    const runTransitions = part.transitions.flatMap((transition, index) =>
      run && transition.routine === run.address ? [{ transition, index }] : [],
    );
    if (!clips.length) return { type: part.type, id: part.id, status: "unmeasured", coverage: null };
    const coverage = validateMeasuredPart(
      runTransitions.map((item) => item.transition),
      clips,
    );
    coverage.transitions.forEach((item) => {
      item.transitions = item.transitions.map((index) => runTransitions[index]!.index);
    });
    coverage.unseenTransitions = coverage.unseenTransitions.map((index) => runTransitions[index]!.index);
    return {
      type: part.type,
      id: part.id,
      status: "measured",
      coverage,
      graphTransitions: runTransitions.map(({ transition, index }) => ({
        index,
        evidence: transition.evidence,
        confidence: transition.confidence,
      })),
      runRoutine: run?.address ?? null,
      missedStateChanges: statePairs(coverage, "missed"),
      unresolvedStateChanges: statePairs(coverage, "unresolved"),
    };
  });
  const missingParts = Object.keys(measured).filter((type) => !report.parts.some((part) => String(part.type) === type));
  const measuredParts = parts.filter(
    (part): part is typeof part & { coverage: MeasurementCoverage } => part.coverage !== null,
  );
  const summary = {
    parts: measuredParts.length,
    unmeasuredParts: parts.length - measuredParts.length,
    missingParts,
    clips: measuredParts.reduce((total, part) => total + part.coverage.clips, 0),
    checked: measuredParts.reduce((total, part) => total + part.coverage.checked, 0),
    inferred: measuredParts.reduce((total, part) => total + part.coverage.inferred, 0),
    unresolved: measuredParts.reduce((total, part) => total + part.coverage.unresolved, 0),
    missed: measuredParts.reduce((total, part) => total + part.coverage.missed, 0),
    unchangedSteps: measuredParts.reduce((total, part) => total + part.coverage.unchangedSteps, 0),
    unchanged: {
      checked: measuredParts.reduce((total, part) => total + part.coverage.unchanged.checked, 0),
      inferred: measuredParts.reduce((total, part) => total + part.coverage.unchanged.inferred, 0),
      unresolved: measuredParts.reduce((total, part) => total + part.coverage.unchanged.unresolved, 0),
      missed: measuredParts.reduce((total, part) => total + part.coverage.unchanged.missed, 0),
    },
  };
  totals.builds++;
  for (const key of ["parts", "clips", "checked", "inferred", "unresolved", "missed", "unchangedSteps"] as const)
    totals[key] += summary[key];
  writeFileSync(
    join(out, filename),
    JSON.stringify(
      {
        source: report.source,
        report: join(reportsFolder, filename),
        oracle: { path: oraclePath, sha256: oracleSha256, version: version.version, sourceExeSha256: version.sha256 },
        summary,
        parts,
      },
      null,
      2,
    ) + "\n",
  );
  lines.push(
    `## ${version.version}: ${report.source.folder}`,
    "",
    `Source SHA-256: \`${report.source.sha256}\`. Details: [${filename}](${filename}).`,
    "",
    "| Part | Clips | Checked | Inferred | Unresolved | Missed | Unchanged | Static transitions not observed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const part of parts) {
    const c = part.coverage;
    lines.push(
      c
        ? `| ${part.type}: ${part.id} | ${c.clips} | ${c.checked} | ${c.inferred} | ${c.unresolved} | ${c.missed} | ${c.unchangedSteps} | ${c.unseenTransitions.length} |`
        : `| ${part.type}: ${part.id} | Unmeasured | — | — | — | — | — | — |`,
    );
  }
  lines.push("");
  for (const part of parts) {
    if ("missedStateChanges" in part && part.missedStateChanges?.length)
      lines.push(
        `${part.type}: ${part.id}, missed state changes: ${part.missedStateChanges.map((pair) => `${pair.from} → ${pair.to} (${pair.occurrences})`).join(", ")}.`,
        "",
      );
  }
  lines.push(
    "",
    `${summary.clips} clips: ${summary.checked} checked, ${summary.inferred} inferred, ${summary.unresolved} unresolved and ${summary.missed} missed changed-state steps. ${missingParts.length} measured parts are absent from the static report.`,
    "",
    `Unchanged steps: ${summary.unchanged.checked} checked, ${summary.unchanged.inferred} inferred, ${summary.unchanged.unresolved} unresolved and ${summary.unchanged.missed} missed.`,
    "",
  );
  console.log(
    `${version.version}: ${summary.clips} clips; ${summary.checked} checked, ${summary.inferred} inferred, ${summary.unresolved} unresolved, ${summary.missed} missed`,
  );
}
const missingVersions = versions.filter((version) => !matched.has(version.version)).map((version) => version.version);
lines.push(
  "## Scope limits",
  "",
  "The measurements isolated callbacks and skipped engine services. They are an oracle for the saved visual sequences, not complete evidence about interactions or timing.",
  "",
  "Only run-callback transitions are eligible; reset, collision and other callbacks cannot explain a measured run step. Static transitions not observed are listed by their indices in the build report.",
  "",
  "Each changed step must have an edge whose destination and recorded conditions agree. Unknown predicates or destinations produce unresolved coverage, not a pass. Checking individual steps cannot establish consistency of unrecorded fields across a whole clip.",
  "",
);
if (unmatched.length)
  lines.push(
    "## Builds without matching measurements",
    "",
    ...unmatched.map((item) => `- ${item.filename}: ${item.sha256}`),
    "",
  );
if (missingVersions.length)
  lines.push(`Missing source reports for oracle versions: ${missingVersions.join(", ")}.`, "");
writeFileSync(join(out, "coverage.json"), JSON.stringify({ totals, unmatched, missingVersions }, null, 2) + "\n");
writeFileSync(join(out, "report.md"), lines.join("\n") + "\n");
if (missingVersions.length) process.exitCode = 1;
