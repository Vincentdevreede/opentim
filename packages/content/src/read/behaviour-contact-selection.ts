/** Describes candidate ordering and rejection rules from the complete shared contact scanner. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { selectionPatterns, type SelectionPattern } from "./behaviour-contact-selection-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";
import type { ContactOutline } from "./behaviour-contact-outline.ts";

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
  /** Set when a pair is excluded only with the subject's type first; absent when either order is excluded. */
  excludedTypePairOrder?: "subjectThenCandidate";
  candidateFilter?: {
    routine: number;
    requiredSubjectType: number;
    headField: number;
    nextField: number;
    excludesWhen: "candidateOccursInSubjectList";
  };
  motionAngleSource?: {
    routine: number;
    subjectGlobal: number;
    outputGlobal: number;
    refresh: "atEntryAndAfterEachSuccessfulPass";
  };
  passes: {
    role: "firstContactTest" | "secondContactTest";
    routine: number;
    previousContactBounds: "strict";
    listCandidateBounds: "strict" | "inclusive";
    outlineMode?: ContactOutline["mode"];
  }[];
  selection: "laterAcceptedContactsCanReplaceEarlierOnes";
  normalReturnValues: [0, 1];
  noAcceptedContact: "clearContactPointer";
  sideBytesClearedBeforeSearch: number[];
}

/** The type gate and excluded pairs of a scan, from how its form of the code skips a candidate by type. */
export function candidateTypePairs(
  pattern: SelectionPattern,
  helperIsTypeFilter: boolean,
): (Pick<ContactSelection, "excludedTypePairs" | "excludedTypePairOrder"> & { gate: string }) | undefined {
  if (pattern.typePairs !== "helper")
    return {
      gate: "The subject's type and the candidate's type are not an excluded pair, tested in that order.",
      excludedTypePairs: pattern.typePairs.map(({ subject, candidate }): [number, number] => [subject, candidate]),
      excludedTypePairOrder: "subjectThenCandidate",
    };
  if (!helperIsTypeFilter) return undefined;
  return {
    gate: "The unordered type-pair exclusion helper returns zero.",
    excludedTypePairs: [
      [12, 42],
      [42, 52],
      [54, 58],
      [54, 54],
    ],
  };
}

/** A footprint alone cannot establish ordering; every branch and direct target is checked separately here. */
export function addContactSelection(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  for (const code of codes.values()) {
    const summary = summaries.get(code.address);
    if (!summary?.contactSearch || summary.globalObjectWrites?.length) continue;
    let bound: Map<string, number> | undefined, matched: SelectionPattern | undefined;
    for (const pattern of selectionPatterns) {
      bound = matchHeapRoutine(code, pattern.code, new Map());
      if (bound) {
        matched = pattern;
        break;
      }
    }
    if (
      !bound ||
      !matched ||
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
    const motion = summaries.get(bound.get("calleeB")!);
    const typePairs = candidateTypePairs(matched, summaries.get(bound.get("calleeI")!)?.kind === "contact-type-filter");
    const membership = summaries.get(bound.get("calleeD")!);
    const list = membership?.contactSmall?.kind === "typed-list-membership" ? membership.contactSmall : undefined;
    const membershipPurpose = list
      ? "The candidate is not found in the subject's type-specific contact list."
      : "The first read-only candidate filter returns zero.";
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
        ...(motion?.contactMotionAngle?.wrapper
          ? {
              motionAngleSource: {
                routine: motion.address,
                subjectGlobal: bound.get("globalA")!,
                outputGlobal: bound.get("globalE")!,
                refresh: "atEntryAndAfterEachSuccessfulPass" as const,
              },
            }
          : {}),
        previousContactField: 132,
        outlineField: 130,
        flagsField: 8,
        ignoredMask: 8192,
        ...(list && membership
          ? {
              candidateFilter: {
                routine: membership.address,
                requiredSubjectType: list.requiredType,
                headField: list.headField,
                nextField: list.nextField,
                excludesWhen: "candidateOccursInSubjectList" as const,
              },
            }
          : {}),
        headMask: 12288,
        nextMask: 4096,
        ordering: "previousContactThenGlobalLists",
        previousContactGates: [
          "The previous contact pointer is nonzero.",
          membershipPurpose,
          "The previous contact has an outline pointer and its ignored flag is clear.",
        ],
        candidateGates: [
          membershipPurpose,
          "The candidate differs from the subject and from the previous contact.",
          "The candidate has an outline pointer and its ignored flag is clear.",
          ...(typePairs ? [typePairs.gate] : []),
        ],
        ...(typePairs
          ? {
              excludedTypePairs: typePairs.excludedTypePairs,
              ...(typePairs.excludedTypePairOrder ? { excludedTypePairOrder: typePairs.excludedTypePairOrder } : {}),
            }
          : {}),
        passes: [
          {
            role: "firstContactTest",
            routine: first.address,
            previousContactBounds: "strict",
            listCandidateBounds: "strict",
            ...(first.contactOutline ? { outlineMode: first.contactOutline.mode } : {}),
          },
          {
            role: "secondContactTest",
            routine: second.address,
            previousContactBounds: "strict",
            listCandidateBounds: "inclusive",
            ...(second.contactOutline ? { outlineMode: second.contactOutline.mode } : {}),
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
