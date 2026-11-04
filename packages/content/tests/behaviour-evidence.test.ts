import { describe, expect, it } from "vitest";
import { createEvidenceWriter, EVIDENCE_ENCODING, restoreEvidenceDocument } from "../src/read/behaviour-evidence.ts";
const instruction = { address: 0x123, bytes: [0xff, 0x44, 12], text: "inc word [si+0x0c]" };
function encode(value: Record<string, unknown>) {
  const writer = createEvidenceWriter();
  const body = writer.stringify({ evidenceEncoding: writer.encoding, ...value });
  return JSON.parse(
    body.slice(0, -1) +
      ',"evidencePool":' +
      JSON.stringify(writer.pool) +
      ',"assumptionPool":' +
      JSON.stringify(writer.assumptionPool) +
      "}",
  );
}

describe("saved instruction evidence", () => {
  it("shares repeated bytes and text without losing instruction addresses", () => {
    const original = {
      assumptions: ["A stated analysis assumption."],
      parts: [
        { assumptions: ["A stated analysis assumption."], confidence: "checked", evidence: [instruction] },
        { confidence: "inferred", evidence: [{ ...instruction }] },
      ],
    };
    const saved = encode(original);
    expect(saved.evidencePool).toHaveLength(1);
    expect(saved.parts[0].evidence[0]).toEqual(0x123);
    const restored = restoreEvidenceDocument(saved);
    expect(restored).toEqual(original);
    expect(saved.parts[0].evidence[0]).toBe(saved.parts[1].evidence[0]);
  });

  it("keeps different decoded interpretations of the same bytes separate", () => {
    const variant = { ...instruction, text: "word table entry" };
    const original = { evidence: [instruction, variant] };
    const saved = encode(original);
    expect(saved.evidencePool).toHaveLength(2);
    expect(restoreEvidenceDocument(saved)).toEqual(original);
  });

  it("rejects missing evidence instead of silently substituting an instruction", () => {
    expect(() =>
      restoreEvidenceDocument({
        evidenceEncoding: EVIDENCE_ENCODING,
        evidencePool: [instruction],
        evidence: [{ address: 0x124, evidenceIndex: 0 }],
      }),
    ).toThrow("No saved instruction evidence");
  });

  it("leaves earlier full-evidence reports unchanged", () => {
    const original = { evidence: [instruction] };
    expect(restoreEvidenceDocument(original)).toBe(original);
  });
});
