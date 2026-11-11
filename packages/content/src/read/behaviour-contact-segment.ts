/** Records the endpoint test's integer formulas without replacing them with ideal line geometry. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { discoverContactArithmetic, type ContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import { segmentPatterns } from "./behaviour-contact-segment-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression, Finding } from "./behaviour.ts";
import { binary } from "./behaviour-terms.ts";

export interface ContactSegmentTest extends Finding {
  firstArgument: number;
  secondArgument: number;
  outputArgument: number;
  coefficientWidth: 16;
  coefficients: { name: string; value: Expression }[];
  determinant: Expression;
  parallel: {
    test: Expression;
    whenZero: "firstSegmentSecondEndpoint";
    otherwise: "origin";
  };
  nonparallel: Finding & {
    arithmeticHelpers: number[];
    contracts: ContactArithmetic[];
    numeratorX: Expression;
    numeratorY: Expression;
    denominator: Expression;
    output: "lowWordOfSignedLongQuotient";
    rounding: "towardsZero";
  };
  rangeRoutine: number;
  acceptance: "outputCoordinatesInBothSignedEndpointSpans";
  outputWrittenBeforeAcceptance: true;
  normalReturnValues: [0, 1];
}
const input = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });

/** The full match includes both determinant paths, the output stores, all four range calls and every return. */
export function addContactSegmentSummaries(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  for (const code of codes.values()) {
    const prior = summaries.get(code.address);
    if (prior?.kind !== "argument-buffer-update" || !prior.footprint.complete) continue;
    let binding: Map<string, number> | undefined;
    for (const pattern of segmentPatterns) {
      binding = matchHeapRoutine(code, pattern, new Map());
      if (binding) break;
    }
    if (!binding) continue;
    const range = summaries.get(binding.get("calleeC")!);
    const arithmetic = [binding.get("calleeA")!, binding.get("calleeB")!];
    if (
      range?.kind !== "contact-coordinate-range" ||
      arithmetic.some(
        (a) =>
          !summaries.get(a)?.footprint.complete ||
          !summaries.get(a)?.footprint.preservesArgumentMemory ||
          summaries.get(a)!.writes.length,
      )
    )
      continue;
    const contracts = arithmetic.map((address) => {
      const body = codes.get(address);
      return body && discoverContactArithmetic(body);
    });
    if (contracts[0]?.operation !== "signedWordProduct" || contracts[1]?.operation !== "signedLongQuotient") continue;
    const first = (offset: number) => input("first segment", offset),
      second = (offset: number) => input("second segment", offset);
    const a = binary("-", first(2), first(6)),
      b = binary("-", first(0), first(4));
    const c = binary("-", binary("*", first(4), a), binary("*", first(6), b));
    const d = binary("-", second(6), second(2)),
      e = binary("-", second(4), second(0));
    const f = binary("-", binary("*", second(0), d), binary("*", second(2), e));
    const finding: Finding = {
      confidence: "inferred",
      evidence: [
        ...code.instructions,
        ...codes.get(range.address)!.instructions,
        ...arithmetic.flatMap((address) => codes.get(address)!.instructions),
      ].map(({ address, bytes, text }) => ({
        address,
        bytes,
        text,
      })),
      assumptions: [
        ...prior.assumptions,
        ...range.assumptions,
        ...contracts.flatMap((contract) => contract!.assumptions),
        "The two endpoint inputs each occupy four valid words and the output occupies two separate valid words; their storage is stable throughout the call. Arithmetic shown in the coefficients and determinant wraps to 16 bits, including low halves of products.",
        "The zero-determinant branch tests a wrapped addition of two products. It does not subtract the second segment's constant coefficient. No general line-collinearity theorem is substituted for these instructions.",
        "The normal-return set and endpoint checks do not establish that the arithmetic helpers return, that a quotient is representable, or that an accepted point is an ideal geometric intersection.",
      ],
    };
    const signExtend = (word: Expression): Expression => ({
      kind: "binary",
      operator: "-",
      left: {
        kind: "binary",
        operator: "^",
        left: word,
        right: { kind: "constant", value: 32768, width: 16 },
        width: 16,
      },
      right: { kind: "constant", value: 32768, width: 32 },
      width: 32,
    });
    const wide = (operator: string, left: Expression, right: Expression): Expression => ({
      kind: "binary",
      operator,
      left,
      right,
      width: 32,
    });
    const product = (left: Expression, right: Expression) => wide("*", signExtend(left), signExtend(right));
    const determinant = binary("-", binary("*", d, b), binary("*", a, e));
    summaries.set(code.address, {
      ...prior,
      contactSegment: {
        ...finding,
        firstArgument: 6,
        secondArgument: 8,
        outputArgument: 10,
        coefficientWidth: 16,
        coefficients: [
          { name: "a", value: a },
          { name: "b", value: b },
          { name: "c", value: c },
          { name: "d", value: d },
          { name: "e", value: e },
          { name: "f", value: f },
        ],
        determinant,
        parallel: {
          test: binary("+", binary("*", first(0), d), binary("*", first(2), e)),
          whenZero: "firstSegmentSecondEndpoint",
          otherwise: "origin",
        },
        nonparallel: {
          ...finding,
          arithmeticHelpers: arithmetic,
          contracts: contracts as ContactArithmetic[],
          numeratorX: wide("-", product(f, b), product(c, e)),
          numeratorY: wide("-", product(a, f), product(d, c)),
          denominator: signExtend(determinant),
          output: "lowWordOfSignedLongQuotient",
          rounding: "towardsZero",
        },
        rangeRoutine: range.address,
        acceptance: "outputCoordinatesInBothSignedEndpointSpans",
        outputWrittenBeforeAcceptance: true,
        normalReturnValues: [0, 1],
      },
      purpose:
        "Computes a candidate point with integer endpoint formulas, writes it before testing acceptance, and checks its coordinates against both segments' endpoint spans.",
    });
  }
}
