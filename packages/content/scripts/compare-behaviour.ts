/** Compares saved static reports and checks descriptions against the saved oracle, without running game code. */
import { restoreEvidenceDocument, createEvidenceWriter } from "../src/read/behaviour-evidence.ts";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { transitionCounts, type BehaviourReport } from "../src/read/behaviour.ts";
import { measuredClips, validateMeasuredPart } from "../src/read/behaviour-validation.ts";
import { describeBehaviour, type BehaviourDescription } from "../src/read/describe-behaviour.ts";

import { compareMeasuredWalks, restartWalk, type WalkMatch } from "../src/read/behaviour-walk-validation.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const readJson = (path: string): unknown => restoreEvidenceDocument(JSON.parse(readFileSync(path, "utf8")));
interface Source {
  sha256: string;
  folder?: string;
}

function filesAt(path: string): string[] {
  return statSync(path).isFile()
    ? [path]
    : readdirSync(path)
        .sort()
        .flatMap((name) => {
          const child = join(path, name);
          return statSync(child).isDirectory() ? filesAt(child) : name.endsWith(".json") ? [child] : [];
        });
}
function sourceOf(data: Record<string, unknown>, path: string): Source | undefined {
  if (object(data.source) && typeof data.source.sha256 === "string") return data.source as unknown as Source;
  const candidates = [
    path.replace(/\.json$/, ".source.json"),
    ...(basename(path) === "report.json" ? [join(dirname(path), "source.json")] : []),
  ];
  for (const candidate of candidates)
    if (existsSync(candidate)) {
      const source = readJson(candidate);
      if (object(source) && typeof source.sha256 === "string") return source as unknown as Source;
    }
  return undefined;
}
function extractionMilliseconds(data: Record<string, unknown>, path: string): number | null {
  const candidates: unknown[] = [data.performance];
  for (const candidate of [
    path.replace(/\.json$/, ".metrics.json"),
    ...(basename(path) === "report.json" ? [join(dirname(path), "metrics.json")] : []),
  ])
    if (existsSync(candidate)) candidates.push(readJson(candidate));
  for (const value of candidates)
    if (object(value) && typeof value.milliseconds === "number") return value.milliseconds;
  return null;
}

function metricsOf(report: BehaviourReport) {
  const callbackAddresses = new Set(report.parts.flatMap((part) => part.routines.map((routine) => routine.address)));
  const callbacks = report.routines.filter((routine) => callbackAddresses.has(routine.address));
  const diagnostics = [...new Set(callbacks.flatMap((routine) => routine.uncertainties))];
  return {
    parts: report.parts.length,
    routines: report.routines.length,
    callbackRoutines: callbacks.length,
    transitions: report.parts.reduce((sum, part) => sum + part.transitions.length, 0),
    unresolvedTransitions: report.parts.reduce((sum, part) => sum + transitionCounts(part.transitions).unresolved, 0),
    conditionalTransitions: report.parts.reduce((sum, part) => sum + transitionCounts(part.transitions).conditional, 0),
    unknownWriteTransitions: report.parts.reduce(
      (sum, part) => sum + transitionCounts(part.transitions).unknownWrites,
      0,
    ),
    namedRunValueTransitions: report.parts.reduce(
      (sum, part) => sum + transitionCounts(part.transitions).namedRunValues,
      0,
    ),
    unresolvedCallsites: diagnostics.filter((item) => item.startsWith("Effects of call")).length,
    pointerLosses: diagnostics.filter((item) => /(?:pointer.*lost|lost.*pointer)/i.test(item)).length,
    unresolvedLoops: diagnostics.filter((item) => /back edge|loop invariant/i.test(item)).length,
  };
}
function writeDescription(path: string, description: BehaviourDescription) {
  const evidence = createEvidenceWriter();
  const fd = openSync(path, "w");
  try {
    writeFileSync(
      fd,
      evidence
        .stringify({
          evidenceEncoding: evidence.encoding,
          listId: description.listId,
          confidence: description.confidence,
          assumptions: description.assumptions,
        })
        .slice(0, -1) + ',"parts":[',
    );
    description.parts.forEach((part, index) => writeFileSync(fd, `${index ? "," : ""}${evidence.stringify(part)}`));
    writeFileSync(
      fd,
      `],"evidencePool":${JSON.stringify(evidence.pool)},"assumptionPool":${JSON.stringify(evidence.assumptionPool)}}\n`,
    );
  } finally {
    closeSync(fd);
  }
}

function writeDescriptionMarkdown(path: string, description: BehaviourDescription) {
  const fd = openSync(path, "w");
  const write = (value: string) => writeFileSync(fd, value + "\n");
  try {
    write(`# Part behaviour: ${description.listId}\n`);
    write(
      "These descriptions come from static instruction evidence. Conditional input cases describe possible inputs shown by the code; they do not assert that a level supplies them. Durations count run invocations.\n",
    );
    for (const part of description.parts) {
      write(`## ${part.type}: ${part.id}\n`);
      write(`Rest: ${part.rest.description}\n`);
      if (part.creation) write(`Creation: ${part.creation.description}\n`);
      if (!part.animations.length)
        write("No complete starting configuration or conditional input walk was established.\n");
      const seen = new Set<string>();
      for (const animation of part.animations) {
        const walk = animation.walk;
        const states =
          walk.parameterised?.kind === "cycle"
            ? (animation.description ?? "The level-supplied frame block cycles.")
            : walk.parameterised
              ? "The input frame remains unchanged."
              : walk.frames.length
                ? walk.frames
                    .map(
                      (frame) =>
                        `frame ${frame.frame ?? frame.state}${frame.runCalls > 1 ? ` (${frame.runCalls} run invocations)` : ""}`,
                    )
                    .join(" → ")
                : "No numeric starting frame was established.";
        const trigger = animation.trigger.description ?? animation.trigger.name;
        const stopping =
          walk.status === "unresolved" || walk.status === "limit"
            ? walk.reason
            : walk.status === "loop"
              ? "The walk repeats."
              : walk.status === "joins"
                ? "The walk continues like another branch."
                : "The ending is stable.";
        const text = `${trigger} ${states} ${stopping ?? ""}`;
        if (seen.has(text)) continue;
        seen.add(text);
        write(
          `- ${text} Confidence: ${animation.confidence}. Evidence: ${[...new Set(animation.evidence.map((item) => `0x${item.address.toString(16)}`))].slice(0, 6).join(", ") || "See the structured rule evidence"}.`,
        );
      }
      write("");
      if (part.effects.length) {
        write("Other effects:\n");
        for (const text of new Set(part.effects.map((effect) => effect.description))) write(`- ${text}`);
        write("");
      }
      if (part.uncertainties.length) write(`Remaining uncertainty: ${part.uncertainties[0]}\n`);
    }
  } finally {
    closeSync(fd);
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, index) => index > 0 || arg !== "--"),
  options: {
    baseline: { type: "string", multiple: true },
    reports: { type: "string", multiple: true },
    oracle: { type: "string" },
    models: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.baseline?.length || !values.reports?.length || !values.oracle || !values.out)
  throw new Error(
    "Give --baseline <saved file or folder>, --reports <new file or folder>, --oracle <animations.json> and --out <folder>. Repeat report options as needed.",
  );
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const oraclePath = resolve(values.oracle);
const oracle = readJson(oraclePath);
if (!object(oracle)) throw new Error("The oracle must be keyed by version");
const models = values.models ? resolve(values.models) : join(dirname(oraclePath), "models");
const versions = Object.keys(oracle).map((version) => {
  const model = readJson(join(models, `${version}.json`));
  if (!object(model) || typeof model.sourceExeSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(model.sourceExeSha256))
    throw new Error(`${version}: no complete source SHA-256 in the oracle model`);
  return { version, sha256: model.sourceExeSha256.toLowerCase() };
});
interface ComparisonPart {
  type: number;
  id: string;
  rest: string;
  stableStates: number[];
  describedAnimations: number;
  measuredClips: number;
  oneFrameClips: number;
  walkMatches: { complete: number; prefix: number; different: number; unavailable: number };
  walkBasis: {
    completeFromCreation: number;
    completeFromSeededStates: number;
    completeFromResetOrRest: number;
    completeFromInputCases: number;
    /** Complete only with what the recorder writes or clears between runs: not a proof about the game. */
    completeFromRecorderFields: number;
    /** Complete only with that and the recorder's empty found list for a search it skipped: not a proof about the game. */
    completeFromRecorderSkippedSearches: number;
    completeWithUntouchedStart: number;
    animatedComplete: number;
  };
  walks: WalkMatch[];
  edgeChecks: { checked: number; inferred: number; unresolved: number; missed: number } | null;
  uncertainties: string[];
}
interface ComparisonResult {
  phase: "baseline" | "final";
  report: string;
  source: Source | null;
  oracleVersion: string | null;
  description: string;
  summary: ReturnType<typeof metricsOf> & {
    extractionMilliseconds: number | null;
    describeMilliseconds: number;
    knownResetStates: number;
    levelResets: number;
    unresolvedResets: number;
    vagueEffects: number;
    partsWithoutStableStates: number;
    unmeasuredParts: number;
    measuredClips: number;
    oneFrameClips: number;
    walkMatches: { complete: number; prefix: number; different: number; unavailable: number };
    walkBasis: ComparisonPart["walkBasis"];
  };
  parts: ComparisonPart[];
  qualification: string;
}
const VAGUE = /isn't established|not established/;
const results: ComparisonResult[] = [];
for (const phase of ["baseline", "reports"] as const) {
  const paths = [...new Set(values[phase]!.flatMap((path) => filesAt(resolve(path))))];
  for (const path of paths) {
    const data = readJson(path);
    if (!object(data) || !Array.isArray(data.parts) || !Array.isArray(data.routines) || typeof data.listId !== "string")
      continue;
    const report = data as unknown as BehaviourReport;
    const source = sourceOf(data, path);
    const match = source && versions.find((version) => version.sha256 === source.sha256.toLowerCase());
    const started = performance.now();
    const description = describeBehaviour(report);
    const describeMilliseconds = performance.now() - started;
    const descriptionName: string = `${phase}-${results.length + 1}-${basename(path, ".json")}.description.json`;
    writeDescription(join(out, descriptionName), description);
    writeDescriptionMarkdown(join(out, descriptionName.replace(/\.json$/, ".md")), description);
    const measured = match ? oracle[match.version] : undefined;
    const parts = report.parts.map((part) => {
      const clips = object(measured)
        ? measuredClips(measured[String(part.type)], `${match!.version}.${part.type}`)
        : [];
      const described = description.parts.find((item) => item.type === part.type)!;
      const walkFrom = restartWalk(report, part.type);
      const walks = clips.map((clip) => compareMeasuredWalks(described.animations, clip, report, walkFrom, part.type));
      const run = part.routines.find((item) => item.slot === 1);
      const edgeCoverage = clips.length
        ? validateMeasuredPart(
            part.transitions.filter((transition) => transition.routine === run?.address),
            clips,
          )
        : null;
      return {
        type: part.type,
        id: part.id,
        rest: described.rest.status,
        stableStates: described.stableStates.map((item) => item.state),
        describedAnimations: described.animations.length,
        measuredClips: clips.length,
        oneFrameClips: clips.filter((clip) => clip.frames.length === 1 && clip.loopStart === null).length,
        walkMatches: {
          complete: walks.filter((walk) => walk.classification === "complete").length,
          prefix: walks.filter((walk) => walk.classification === "prefix").length,
          different: walks.filter((walk) => walk.classification === "different").length,
          unavailable: walks.filter((walk) => walk.classification === "unavailable").length,
        },
        walkBasis: {
          completeFromCreation: walks.filter((walk) => walk.classification === "complete" && walk.basis === "creation")
            .length,
          completeFromSeededStates: walks.filter(
            (walk) => walk.classification === "complete" && walk.basis === "seeded-state",
          ).length,
          completeFromResetOrRest: walks.filter(
            (walk) => walk.classification === "complete" && walk.basis === "reset-or-rest",
          ).length,
          completeFromInputCases: walks.filter(
            (walk) => walk.classification === "complete" && walk.basis === "input-case",
          ).length,
          completeFromRecorderFields: walks.filter(
            (walk) => walk.classification === "complete" && walk.basis === "recorder-fields",
          ).length,
          completeFromRecorderSkippedSearches: walks.filter(
            (walk) => walk.classification === "complete" && walk.basis === "recorder-skipped-search",
          ).length,
          completeWithUntouchedStart: walks.filter((walk) => walk.classification === "complete" && walk.untouchedStart)
            .length,
          animatedComplete: walks.filter(
            (walk) =>
              walk.classification === "complete" &&
              clips
                .find((clip) => clip.path === walk.clip)
                ?.frames.some((frame, index, frames) => index > 0 && frame.state !== frames[index - 1]!.state),
          ).length,
        },
        walks,
        edgeChecks: edgeCoverage
          ? {
              checked: edgeCoverage.checked,
              inferred: edgeCoverage.inferred,
              unresolved: edgeCoverage.unresolved,
              missed: edgeCoverage.missed,
            }
          : null,
        uncertainties: described.uncertainties,
      };
    });
    const summary = {
      ...metricsOf(report),
      extractionMilliseconds: extractionMilliseconds(data, path),
      describeMilliseconds,
      knownResetStates: description.parts.filter((part) => part.rest.status === "known").length,
      // Resets that keep the saved frame or set it from the sockets are the game's own: the level gives the frame.
      levelResets: description.parts.filter((part) => ["saved", "sockets"].includes(part.rest.status)).length,
      unresolvedResets: description.parts.filter((part) => part.rest.status === "unresolved").length,
      // Effect lines that say their meaning or value isn't known, counted once per part and wording.
      vagueEffects: description.parts.reduce(
        (sum, part) =>
          sum + new Set(part.effects.map((effect) => effect.description).filter((text) => VAGUE.test(text))).size,
        0,
      ),
      partsWithoutStableStates: parts.filter((part) => !part.stableStates.length).length,
      unmeasuredParts: parts.filter((part) => !part.measuredClips).length,
      measuredClips: parts.reduce((sum, part) => sum + part.measuredClips, 0),
      oneFrameClips: parts.reduce((sum, part) => sum + part.oneFrameClips, 0),
      walkBasis: {
        completeFromCreation: parts.reduce((sum, part) => sum + part.walkBasis.completeFromCreation, 0),
        completeFromSeededStates: parts.reduce((sum, part) => sum + part.walkBasis.completeFromSeededStates, 0),
        completeFromResetOrRest: parts.reduce((sum, part) => sum + part.walkBasis.completeFromResetOrRest, 0),
        completeFromInputCases: parts.reduce((sum, part) => sum + part.walkBasis.completeFromInputCases, 0),
        completeFromRecorderFields: parts.reduce((sum, part) => sum + part.walkBasis.completeFromRecorderFields, 0),
        completeFromRecorderSkippedSearches: parts.reduce(
          (sum, part) => sum + part.walkBasis.completeFromRecorderSkippedSearches,
          0,
        ),
        completeWithUntouchedStart: parts.reduce((sum, part) => sum + part.walkBasis.completeWithUntouchedStart, 0),
        animatedComplete: parts.reduce((sum, part) => sum + part.walkBasis.animatedComplete, 0),
      },
      walkMatches: {
        complete: parts.reduce((sum, part) => sum + part.walkMatches.complete, 0),
        prefix: parts.reduce((sum, part) => sum + part.walkMatches.prefix, 0),
        different: parts.reduce((sum, part) => sum + part.walkMatches.different, 0),
        unavailable: parts.reduce((sum, part) => sum + part.walkMatches.unavailable, 0),
      },
    };
    results.push({
      phase: phase === "reports" ? "final" : phase,
      report: path,
      source: source ?? null,
      oracleVersion: match?.version ?? null,
      description: descriptionName,
      summary,
      parts,
      qualification: match
        ? "Only described walks are compared. No recorded fields or manually selected states seed the description."
        : "No exact executable hash matched an oracle model; measured walk coverage is unavailable.",
    });
    console.log(
      `${phase}: ${basename(path)}: ${summary.unresolvedTransitions}/${summary.transitions} unresolved transitions, ${summary.conditionalTransitions} conditional, ${summary.unknownWriteTransitions} with unknown writes, ${summary.namedRunValueTransitions} with named run values, ${summary.vagueEffects} vague effect lines; ${summary.unresolvedResets} unresolved resets, ${summary.levelResets} resets the level gives, ${summary.partsWithoutStableStates} parts without resting frames, ${summary.unmeasuredParts} unmeasured parts; ${summary.measuredClips} oracle clips: ${summary.walkMatches.complete} complete (${summary.walkBasis.completeFromSeededStates} of them from a seeded state, ${summary.walkBasis.completeFromRecorderFields} through the recorder's fields, ${summary.walkBasis.completeFromRecorderSkippedSearches} through a recorder-skipped search, ${summary.walkBasis.completeWithUntouchedStart} taking the part as untouched at the start), ${summary.walkMatches.prefix} prefix, ${summary.walkMatches.different} different, ${summary.walkMatches.unavailable} unavailable`,
    );
  }
}
const comparisons = results
  .filter((result) => result.phase === "final")
  .map((final) => {
    const baseline = results.find(
      (result) =>
        result.phase === "baseline" && result.source?.sha256 === final.source?.sha256 && result.source !== null,
    );
    const numeric = [
      "transitions",
      "unresolvedTransitions",
      "conditionalTransitions",
      "unknownWriteTransitions",
      "namedRunValueTransitions",
      "unresolvedCallsites",
      "pointerLosses",
      "unresolvedLoops",
      "knownResetStates",
      "levelResets",
      "unresolvedResets",
      "vagueEffects",
      "partsWithoutStableStates",
      "unmeasuredParts",
    ] as const;
    return {
      source: final.source,
      baseline: baseline?.report ?? null,
      final: final.report,
      changes: baseline
        ? Object.fromEntries(
            numeric.map((key) => [
              key,
              {
                before: baseline.summary[key],
                after: final.summary[key],
                difference: final.summary[key] - baseline.summary[key],
              },
            ]),
          )
        : null,
      walkMatches: { before: baseline?.summary.walkMatches ?? null, after: final.summary.walkMatches },
    };
  });
const limitations = [
  "Unresolved transitions leave out conditional ones: a conditional transition tests only values found during that run, like a query's answer, the part a loop found or what a list scan leaves behind, and its routine lost no effect. Transitions with unknown writes are counted apart from both, whatever their condition: they write a value nobody named, an unknown or a value read again after one. Transitions with named run values write only known values and values named after the run-time thing that gives them, like a search's found list, a value a list scan leaves behind, what a call writes to the parts it selects, or the part's field after such a call, and at least one of those.",
  "Oracle coverage is counted in saved clips. Changed-state edge checks are a separate count.",
  "Complete walks refer to state-selected frame numbers and run-call positions. Hiding, reflection, physics and wall time are outside these match counts.",
  "A complete match requires a proved stable ending or matching repeating visible cycles; unknown endings are prefixes.",
  "One-frame clips have no measured transition; a complete match for one requires a statically proved stable walk.",
  "Descriptions use reset fields, actual extracted trigger assignments and explicitly labelled input cases taken from run predicates and producer constants. No oracle seed or invented collision supplies inputs.",
  "Complete matches retain their basis: reset/rest, creation, conditional input case or seeded state. A conditional input case does not prove that the level or another part supplies those values.",
  "The recorder performs no trigger: it puts each part alone on a cleared bench, writes the fields its action names and only calls the run routine. A walk from a trigger (another callback of the part, or another part's write) therefore counts only when its start is the recorder's: the trigger's writes are values the action gives and the trigger's other tests on the part hold for them. Those matches have their own basis, seeded state, and say nothing about the trigger happening.",
  "A clip that lists a search the recorder skipped may match with what the recorder gave in its place (0 and no memory written, so an empty found list). Those matches have their own basis, recorder-skipped search, and are counted apart: they show the walk agrees with the recorder, not what the game finds.",
  "Where the walks don't match as they are, a clip may also match with what the recorder itself writes before every run (the position words at 0x1e to 0x28, the previous frames at 0x0e and 0x10) and the bytes it clears that nothing in the clip can write. Those matches have their own basis, recorder fields, and are counted apart too: they describe the recorder's bench, not the game.",
  "A recording starts from the recorder's part as it was: a walk whose start knows another value for a field the run reads (a reset value the recorder cleared, for example) doesn't count, and the comparison looks for one that starts from the recorder's value.",
  "Matches that need the part to touch nothing at the start (its contact bits at 0x06 clear, decided with the user) say so and are counted apart, whatever their basis.",
  "Repeated externally supplied inputs remain outside a single-trigger description and cannot establish complete coverage.",
  "Callback-only diagnostics are counted once per distinct string; engine helper diagnostics are excluded from these comparison totals.",
  "Extraction milliseconds come from saved capture metadata when available. Description timings are measured separately in this process.",
];
writeFileSync(
  join(out, "comparison.json"),
  JSON.stringify(
    {
      oracle: { path: oraclePath, sha256: createHash("sha256").update(readFileSync(oraclePath)).digest("hex") },
      limitations,
      comparisons,
      results,
    },
    null,
    2,
  ) + "\n",
);
const lines = [
  "# Behaviour descriptions before and after",
  "",
  ...limitations.map((item) => `- ${item}`),
  "",
  "| Phase and build | Unresolved transitions | Conditional transitions | Transitions with unknown writes | Transitions with named run values | Vague effect lines | Unresolved resets | Parts without resting frames | Unmeasured parts | Unresolved call sites | Pointer losses | Loops | Oracle clips | Complete walks | Of them through the recorder's fields | Of them through a recorder-skipped search | Prefixes | Different | No compatible start | Extract ms | Describe ms |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const result of results) {
  const s = result.summary;
  lines.push(
    `| ${result.phase}: ${result.source?.folder ?? result.report} | ${s.unresolvedTransitions}/${s.transitions} | ${s.conditionalTransitions} | ${s.unknownWriteTransitions} | ${s.namedRunValueTransitions} | ${s.vagueEffects} | ${s.unresolvedResets} | ${s.partsWithoutStableStates} | ${s.unmeasuredParts} | ${s.unresolvedCallsites} | ${s.pointerLosses} | ${s.unresolvedLoops} | ${s.measuredClips} | ${s.walkMatches.complete} | ${s.walkBasis.completeFromRecorderFields} | ${s.walkBasis.completeFromRecorderSkippedSearches} | ${s.walkMatches.prefix} | ${s.walkMatches.different} | ${s.walkMatches.unavailable} | ${s.extractionMilliseconds?.toFixed(1) ?? "Unavailable"} | ${s.describeMilliseconds.toFixed(1)} |`,
  );
}
for (const result of results.filter((item) => item.phase === "final")) {
  lines.push(
    "",
    `## ${result.source?.folder ?? result.report}`,
    "",
    `Description: [${result.description}](${result.description}).`,
    "",
    "| Part | Reset | Documented stable states | Measured clips | Complete | Prefix | Different | No compatible start | Main uncertainty |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const part of result.parts)
    lines.push(
      `| ${part.type}: ${part.id} | ${part.rest} | ${part.stableStates.join(", ") || "Unknown"} | ${part.measuredClips || "Unmeasured"} | ${part.walkMatches.complete} | ${part.walkMatches.prefix} | ${part.walkMatches.different} | ${part.walkMatches.unavailable} | ${(part.uncertainties[0] ?? "None in the recovered rules").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
    );
}
writeFileSync(join(out, "report.md"), lines.join("\n") + "\n");
if (!results.some((result) => result.phase === "baseline") || !results.some((result) => result.phase === "final"))
  throw new Error("No valid baseline or final behaviour reports were found");
