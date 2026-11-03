/** Exact scalar relations used to reject contact candidates and check computed endpoint coordinates. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { rangePatterns, typesPatterns } from "./behaviour-contact-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression } from "./behaviour.ts";
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const argument = (offset: number): Expression => ({ kind: "field", object: "argument", offset, width: 16 });
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});

/** Complete CFG matches check every accepting branch and the zero return before constructing a closed relation. */
export function discoverContactScalar(code: RoutineCode): EngineSummary | undefined {
  const range = rangePatterns.some((pattern) => matchHeapRoutine(code, pattern, new Map()));
  if (!range && !typesPatterns.some((pattern) => matchHeapRoutine(code, pattern, new Map()))) return;
  const a = argument(6),
    b = argument(8),
    c = argument(10);
  let value: Expression;
  if (range) {
    const ordered = binary("<=", binary("^", b, constant(0x8000)), binary("^", c, constant(0x8000)));
    value = binary(
      "|",
      binary("*", ordered, binary("<=", binary("-", a, b), binary("-", c, b))),
      binary("*", binary("==", ordered, constant(0)), binary("<=", binary("-", a, c), binary("-", b, c))),
    );
  } else {
    const pair = (x: number, y: number) =>
      binary(
        "|",
        binary("*", binary("==", a, constant(x)), binary("==", b, constant(y))),
        binary("*", binary("==", a, constant(y)), binary("==", b, constant(x))),
      );
    value = binary(
      "|",
      binary("|", pair(12, 42), pair(42, 52)),
      binary("|", pair(54, 58), binary("*", binary("==", a, constant(54)), binary("==", b, constant(54)))),
    );
  }
  const finding = {
    confidence: "inferred" as const,
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    assumptions: [
      "The scalar words occupy a valid private C stack frame, separate from parts and program data. Arithmetic wraps to 16 bits.",
      range
        ? "The endpoints are ordered by signed comparison, then unsigned wrapped differences test the inclusive span. This is not an unsigned numerical minimum and maximum."
        : "The code sorts the two signed type words and accepts four positive constant pairs. Symmetric equalities describe the same relation for every word input; the caller determines what rejection means.",
    ],
  };
  return {
    ...finding,
    address: code.address,
    kind: range ? "contact-coordinate-range" : "contact-type-filter",
    purpose: range
      ? "Checks whether a word coordinate lies inclusively between two signed endpoint coordinates, using wrapped differences."
      : "Recognises four unordered type pairs that the contact scanner excludes.",
    argumentOffset: 6,
    argumentKind: "scalar",
    writes: [],
    returns: [{ ...finding, register: "ax", value, condition: { kind: "true" } }],
    calls: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}
