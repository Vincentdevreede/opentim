/** Describes candidate ordering and rejection rules from the complete shared contact scanner. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { selectionPatterns } from "./behaviour-contact-selection-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";

export interface ContactSelection extends Finding {
  previousContactField: number;
  outlineField: number;
  flagsField: number;
  ignoredMask: number;
  headMask: number;
  nextMask: number;
  ordering: "previousContactThenGlobalLists";
  candidateGates: string[];
  previousContactGates: string[];
  excludedTypePairs?: [number, number][];
  passes: {
    role: "firstContactTest" | "secondContactTest";
    routine: number;
    previousContactBounds: "strict";
    listCandidateBounds: "strict" | "inclusive";
  }[];
  selection: "laterAcceptedContactsCanReplaceEarlierOnes";
  normalReturnValues: [0, 1];
  noAcceptedContact: "clearContactPointer";
  sideBytesClearedBeforeSearch: number[];
}

/** A footprint alone cannot establish ordering; every branch and direct target is checked separately here. */
export function addContactSelection(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  for (const code of codes.values()) {
    const summary = summaries.get(code.address);
    if (!summary?.contactSearch || summary.globalObjectWrites?.length) continue;
    let bound: Map<string, number> | undefined;
    for (const pattern of selectionPatterns) {
      bound = matchHeapRoutine(code, pattern, new Map());
      if (bound) break;
    }
    if (
      !bound ||
      bound.get("globalA") !== summary.contactSearch.subjectGlobal ||
      bound.get("globalF") !== summary.contactSearch.candidateGlobal
    )
      continue;
    const subject = summaries.get(bound.get("calleeC")!),
      candidate = summaries.get(bound.get("calleeE")!);
    const first = summaries.get(bound.get("calleeF")!),
      second = summaries.get(bound.get("calleeG")!);
    if (
      subject?.contactBounds?.kind !== "swept-subject" ||
      candidate?.contactBounds?.kind !== "candidate" ||
      !first?.contactSearch ||
      !second?.contactSearch
    )
      continue;
    if (
      subject.contactBounds.objectGlobal !== bound.get("globalA") ||
      candidate.contactBounds.objectGlobal !== bound.get("globalF")
    )
      continue;
    const filter = summaries.get(bound.get("calleeI")!);
    const excluded = filter?.kind === "contact-type-filter";
    const purpose =
      "Tests the previous contact first, then eligible listed parts in order, using two contact tests; the second admits touching rectangle boundaries in the global-list search. Later accepted contacts can replace earlier contacts.";
    const finding: Finding = {
      confidence: "inferred",
      evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
      assumptions: [
        ...summary.assumptions,
        "The complete scanner graph establishes candidate ordering and rectangle gates, conditional on normal returns from list and geometry helpers. It does not supply runtime contacts, outline coordinates, movement angles or a list termination guarantee.",
        "The two outline searches may update the subject and its bounds before later tests. This is not a first-hit, nearest-contact or immutable-rectangle search.",
      ],
    };
    summaries.set(code.address, {
      ...summary,
      purpose,
      contactSelection: {
        ...finding,
        previousContactField: 132,
        outlineField: 130,
        flagsField: 8,
        ignoredMask: 8192,
        headMask: 12288,
        nextMask: 4096,
        ordering: "previousContactThenGlobalLists",
        previousContactGates: [
          "The previous contact pointer is nonzero.",
          "The first read-only candidate filter returns zero.",
          "The previous contact has an outline pointer and its ignored flag is clear.",
        ],
        candidateGates: [
          "The first read-only candidate filter returns zero.",
          "The candidate differs from the subject and from the previous contact.",
          "The candidate has an outline pointer and its ignored flag is clear.",
          ...(excluded ? ["The unordered type-pair exclusion helper returns zero."] : []),
        ],
        ...(excluded
          ? {
              excludedTypePairs: [
                [12, 42],
                [42, 52],
                [54, 58],
                [54, 54],
              ] as [number, number][],
            }
          : {}),
        passes: [
          {
            role: "firstContactTest",
            routine: first.address,
            previousContactBounds: "strict",
            listCandidateBounds: "strict",
          },
          {
            role: "secondContactTest",
            routine: second.address,
            previousContactBounds: "strict",
            listCandidateBounds: "inclusive",
          },
        ],
        selection: "laterAcceptedContactsCanReplaceEarlierOnes",
        normalReturnValues: [0, 1],
        noAcceptedContact: "clearContactPointer",
        sideBytesClearedBeforeSearch: [134, 135],
      },
    });
  }
}
