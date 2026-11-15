import { describe, expect, it } from "vitest";
import { candidateTypePairs } from "../src/read/behaviour-contact-selection.ts";
import { selectionPatterns } from "../src/read/behaviour-contact-selection-patterns.ts";

describe("contact scanner type pairs", () => {
  it("says for each form how its code skips a candidate by type", () => {
    const helperCall =
      /push 16:ds\[bx\+4\]\nmov bx,16:ds\[\{globalA\}\]\npush 16:ds\[bx\+4\]\n(?:nop\npush cs\ncall|callf) \$calleeI\n/;
    for (const { code, typePairs } of selectionPatterns) {
      expect(helperCall.test(code)).toBe(typePairs === "helper");
      if (typePairs === "helper") continue;
      for (const { subject, candidate } of typePairs)
        expect(code).toMatch(
          new RegExp(
            `mov bx,16:ds\\[\\{globalA\\}\\]\\ncmp 16:ds\\[bx\\+4\\],#${subject}\\njne @\\w+\\nmov bx,16:ds\\[\\{globalF\\}\\]\\ncmp 16:ds\\[bx\\+4\\],#${candidate}\\n`,
          ),
        );
    }
  });

  it("reports the scan's own type test as a gate with its one ordered pair", () => {
    const inline = selectionPatterns.find((pattern) => pattern.typePairs !== "helper")!;
    expect(candidateTypePairs(inline, false)).toEqual({
      gate: "The subject's type and the candidate's type are not an excluded pair, tested in that order.",
      excludedTypePairs: [[12, 42]],
      excludedTypePairOrder: "subjectThenCandidate",
    });
  });

  it("reports the helper's pairs only when the helper is the type pair filter", () => {
    const helper = selectionPatterns[0]!;
    expect(candidateTypePairs(helper, false)).toBeUndefined();
    expect(candidateTypePairs(helper, true)?.excludedTypePairs).toHaveLength(4);
    expect(candidateTypePairs(helper, true)?.excludedTypePairOrder).toBeUndefined();
  });
});
