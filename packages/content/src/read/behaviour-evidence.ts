/** Shares repeated instruction evidence in saved JSON, while retaining each finding's instruction addresses. */
import type { Evidence } from "./behaviour.ts";

export const EVIDENCE_ENCODING = "opentim-instruction-evidence-1";
interface EvidenceReference {
  address: number;
  evidenceIndex: number;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const instructionEvidence = (value: unknown): value is Evidence =>
  object(value) &&
  typeof value.address === "number" &&
  Array.isArray(value.bytes) &&
  value.bytes.every((byte) => typeof byte === "number") &&
  typeof value.text === "string";

/** One writer belongs to one document. Its pool is written after all document collections have been encoded. */
export function createEvidenceWriter() {
  const pool: Evidence[] = [];
  const byValue = new Map<string, number>();
  const byIdentity = new WeakMap<object, number>();
  const firstAtAddress = new Map<number, number>();
  const assumptionPool: string[] = [];
  const assumptions = new Map<string, number>();
  const reference = (value: Evidence): EvidenceReference | number => {
    let index = byIdentity.get(value);
    if (index === undefined) {
      const encoded = JSON.stringify(value);
      index = byValue.get(encoded);
      if (index === undefined) {
        index = pool.length;
        pool.push(value);
        byValue.set(encoded, index);
      }
      byIdentity.set(value, index);
    }
    if (!firstAtAddress.has(value.address)) firstAtAddress.set(value.address, index);
    return firstAtAddress.get(value.address) === index
      ? value.address
      : { address: value.address, evidenceIndex: index };
  };
  return {
    encoding: EVIDENCE_ENCODING,
    pool,
    assumptionPool,
    stringify(value: unknown): string {
      return (
        JSON.stringify(value, (key, item: unknown) => {
          if (key === "evidence" && Array.isArray(item))
            return item.map((entry) => (instructionEvidence(entry) ? reference(entry) : entry));
          if (key === "assumptions" && Array.isArray(item))
            return item.map((entry) => {
              if (typeof entry !== "string") return entry;
              let index = assumptions.get(entry);
              if (index === undefined) {
                index = assumptionPool.length;
                assumptions.set(entry, index);
                assumptionPool.push(entry);
              }
              return index;
            });
          return item;
        }) ?? "null"
      );
    },
  };
}

/** Restores saved references in place. Legacy reports and unrelated JSON are returned unchanged. */
export function restoreEvidenceDocument(value: unknown): unknown {
  if (!object(value) || value.evidenceEncoding !== EVIDENCE_ENCODING) return value;
  const pool = value.evidencePool;
  if (!Array.isArray(pool) || !pool.every(instructionEvidence))
    throw new Error("The saved instruction evidence pool is invalid");
  const assumptions = value.assumptionPool;
  if (
    assumptions !== undefined &&
    (!Array.isArray(assumptions) || !assumptions.every((item) => typeof item === "string"))
  )
    throw new Error("The saved assumption pool is invalid");
  const firstAtAddress = new Map<number, Evidence>();
  for (const item of pool) if (!firstAtAddress.has(item.address)) firstAtAddress.set(item.address, item);
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || visited.has(item)) continue;
    visited.add(item);
    if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(item)) {
      if (key === "evidencePool" || key === "assumptionPool") continue;
      if (key === "assumptions" && Array.isArray(child)) {
        (item as Record<string, unknown>)[key] = child.map((entry) => {
          if (typeof entry === "string") return entry;
          if (Array.isArray(assumptions) && Number.isInteger(entry) && typeof assumptions[entry] === "string")
            return assumptions[entry];
          throw new Error("A saved assumption reference is invalid");
        });
        continue;
      }
      if (key !== "evidence" || !Array.isArray(child)) {
        pending.push(child);
        continue;
      }
      (item as Record<string, unknown>)[key] = child.map((entry) => {
        if (instructionEvidence(entry)) return entry;
        if (typeof entry === "number" && Number.isInteger(entry)) {
          const evidence = firstAtAddress.get(entry);
          if (!evidence) throw new Error(`No saved instruction evidence matches address 0x${entry.toString(16)}`);
          return evidence;
        }
        if (!object(entry) || !Number.isInteger(entry.evidenceIndex) || typeof entry.address !== "number")
          throw new Error("A saved instruction evidence reference is invalid");
        const evidence = pool[entry.evidenceIndex as number];
        if (!evidence || evidence.address !== entry.address)
          throw new Error(`No saved instruction evidence matches address 0x${entry.address.toString(16)}`);
        return evidence;
      });
    }
  }
  delete value.evidencePool;
  delete value.evidenceEncoding;
  delete value.assumptionPool;
  return value;
}
