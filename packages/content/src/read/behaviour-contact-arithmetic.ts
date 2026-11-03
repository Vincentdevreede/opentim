/** Proves the scalar arithmetic contracts used by the contact endpoint test. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { divisionPatterns } from "./behaviour-contact-division-patterns.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { Finding } from "./behaviour.ts";

export interface ContactArithmetic extends Finding {
  operation: "signedWordProduct" | "signedLongQuotient";
  inputWidth: 16 | 32;
  outputWidth: 32;
  rounding?: "towardsZero";
  overflow: "wrap32";
  zeroDivisor?: "noNormalReturn";
  invariant?: string;
}
const product = `mov bx,sp
mov ax,16:ds[bx+4]
imul 16:ds[bx+6]
retf`;

/** The restoring-division invariant is a proof about all inputs, rather than an instruction interpreter. */
export function discoverContactArithmetic(code: RoutineCode): ContactArithmetic | undefined {
  const multiplication = !!matchHeapRoutine(code, product, new Map());
  if (!multiplication && !divisionPatterns.some((pattern) => matchHeapRoutine(code, pattern, new Map()))) return;
  const invariant =
    "After k iterations, the remainder is the processed dividend prefix minus the denominator times its quotient, is nonnegative and smaller than the positive denominator, and the shifted dividend/quotient pair contains the unprocessed bits and the k quotient bits. Shifting the next bit into the remainder, comparing high then low words, subtracting at most once and incrementing the low quotient word preserves this relation. CX starts at 32 and LOOP performs exactly 32 iterations.";
  return {
    operation: multiplication ? "signedWordProduct" : "signedLongQuotient",
    inputWidth: multiplication ? 16 : 32,
    outputWidth: 32,
    overflow: "wrap32",
    ...(multiplication ? {} : { rounding: "towardsZero", zeroDivisor: "noNormalReturn", invariant }),
    confidence: "inferred",
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    assumptions: [
      "Call words and saved registers occupy a valid private C stack, with stack offsets readable through the data segment and separate from part, input and output buffers. The checked return bridge and cleanup are used as encoded.",
      ...(multiplication
        ? ["IMUL returns the full signed product of the two word inputs in DX:AX."]
        : [
            invariant,
            "The checked entry clears the mode word to zero. Sign normalisation therefore produces unsigned magnitudes at most 2^31, retaining the quotient sign in bit 2. The remainder cannot overflow 32 bits when shifted because it is smaller than that denominator. The remainder-result selector in bit 1 remains clear.",
            "A zero high divisor word and zero high dividend word use hardware unsigned DIV with a zero high numerator, which yields the same nonnegative quotient without overflow. A zero divisor always reaches hardware division by zero and establishes no normal return.",
            "The final conditional two-word negation restores the quotient sign, discards the remainder and implements truncation towards zero. INT_MIN divided by minus one wraps to INT_MIN; the software quotient is not a claim of a signed hardware overflow trap.",
          ]),
    ],
  };
}
