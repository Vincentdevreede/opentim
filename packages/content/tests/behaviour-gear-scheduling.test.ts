import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { GearRunContract } from "../src/read/behaviour-gear-run.ts";
import { discoverGearScheduling } from "../src/read/behaviour-gear-scheduling.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
function fixture(
  options: {
    es?: boolean;
    shift?: number;
    clearMask?: number;
    clearHead?: number;
    next?: number;
    guardMask?: number;
    pushOther?: boolean;
    wrongRecord?: boolean;
    type?: number;
  } = {},
) {
  const origin = 0x100 + (options.shift ?? 0),
    table = 0x1000,
    gearAddress = 0x800,
    head = 0x900,
    flags = 0x24,
    type = 0x26,
    field = 0x26;
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; label: string }[] = [];
  const emit = (...b: number[]) => bytes.push(...b);
  const label = (name: string) => labels.set(name, origin + bytes.length);
  const jump = (name: string, opcode: number) => {
    emit(opcode, 0);
    patches.push({ at: bytes.length - 1, label: name });
  };
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  emit(0x55, 0x8b, 0xec, 0x56);
  label("clearEntry");
  emit(0x8b, 0x36, ...u16(options.clearHead ?? head));
  jump("clearHeader", 0xeb);
  label("clearStore");
  emit(0x81, 0x64, flags, ...u16(options.clearMask ?? 0xf9bf));
  emit(0x8b, 0x74, options.next ?? 0);
  label("clearHeader");
  emit(0x0b, 0xf6);
  jump("clearStore", 0x75);
  emit(0x90);
  label("passEntry");
  emit(0x8b, 0x36, ...u16(head));
  jump("passHeader", 0xeb);
  label("typeGuard");
  emit(0x83, 0x7c, type, options.type ?? 14);
  jump("advance", 0x75);
  label("flagsGuard");
  emit(0xf7, 0x44, flags, ...u16(options.guardMask ?? 0x2040));
  jump("advance", 0x75);
  emit(options.pushOther ? 0x57 : 0x56, 0x8b, 0x44, type, 0xba, 58, 0, 0xf7, 0xea);
  if (options.es) emit(0xba, 0, 1, 0x8b, 0xd8, 0x8e, 0xc2);
  else emit(0x8b, 0xd8);
  label("dispatch");
  if (options.es) emit(0x26, 0xff, 0x9f, ...u16(field));
  else emit(0xff, 0x9f, ...u16(table + field));
  emit(0x59);
  label("advance");
  emit(0x8b, 0x34);
  label("passHeader");
  emit(0x0b, 0xf6);
  jump("typeGuard", 0x75);
  label("exit");
  emit(0x5e, 0x5d, 0xcb);
  for (const p of patches) bytes[p.at] = (labels.get(p.label)! - (origin + p.at + 1)) & 255;
  const image = new Uint8Array(0x1800);
  image.set([0xb8, 0, 0, 0x8e, 0xd8]);
  image.set([0x9a, ...u16(origin), 0, 0], 0x30);
  image.set(bytes, origin);
  image.set([...u16(options.wrongRecord ? gearAddress + 1 : gearAddress), 0, 0], table + 14 * 58 + field);
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  const layout: BehaviourLayout = {
    fields: [
      { name: "drawingFlags", offset: flags, ...fact },
      { name: "type", offset: type, ...fact },
    ],
    callbacks: [{ role: "run", field, sites: [labels.get("dispatch")!], ...fact }],
    objectArgument: fact,
    diagnostics: [],
  };
  // The scheduler consumes a separately certified run contract; its internal graph is outside this fixture.
  const gear = { address: gearAddress, flagsField: flags, visitedMask: 64, ...fact } satisfies Pick<
    GearRunContract,
    "address" | "flagsField" | "visitedMask" | keyof typeof fact
  >;
  const codes = new Map([[code.address, code]]);
  const discover = () => discoverGearScheduling(image, codes, layout, [gear]);
  return { image, code, codes, layout, gear, labels, discover };
}

describe("conditional gear scheduling", () => {
  it.each([{ es: false }, { es: true }, { es: true, shift: 0x80 }])(
    "links both complete list regions to the actual gear record %s",
    (options) => {
      const f = fixture(options),
        result = f.discover();
      expect(f.code.status).toBe("complete");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        gearType: 14,
        processedMask: 64,
        excludedMask: 0x2040,
        list: { globalHead: 0x900, nextField: 0 },
        clear: { clearedMask: 0x640 },
        pass: { dispatch: f.labels.get("dispatch") },
      });
      expect(result[0]!.evidence.some((e) => e.address === f.labels.get("clearStore"))).toBe(true);
      expect(result[0]!.assumptions.some((s) => s.includes("newly inserted"))).toBe(true);
      expect(result[0]!.description).toContain("earlier passes");
    },
  );
  it("discovers an enclosing graph without mutating the shared code cache", () => {
    const f = fixture();
    f.codes.clear();
    expect(f.discover()).toHaveLength(1);
    expect(f.codes.size).toBe(0);
  });
  it.each([
    { clearMask: 0xffbf },
    { clearHead: 0x902 },
    { next: 2 },
    { guardMask: 0x2000 },
    { pushOther: true },
    { wrongRecord: true },
    { type: 15 },
  ])("rejects a changed binding or eligibility rule %s", (options) => {
    expect(fixture(options).discover()).toEqual([]);
  });
  it("rejects a data-segment change between the list regions", () => {
    const f = fixture();
    const boundary = f.code.instructions.find((i) => i.mnemonic === "nop")!;
    boundary.mnemonic = "pop";
    boundary.operands = [{ kind: "register", name: "ds", width: 16 }];
    expect(f.discover()).toEqual([]);
  });
  it("rejects an alternate entry after either guard", () => {
    const f = fixture();
    f.code.edges.push({ from: f.code.address, to: f.labels.get("dispatch")!, kind: "jump" });
    expect(f.discover()).toEqual([]);
  });
  it("rejects a bypass of the earlier clear phase", () => {
    const f = fixture();
    f.code.edges.push({ from: f.code.address, to: f.labels.get("passEntry")!, kind: "jump" });
    expect(f.discover()).toEqual([]);
  });
  it("rejects an additional outgoing loop edge and a partial enclosing graph", () => {
    const f = fixture();
    f.code.edges.push({ from: f.labels.get("flagsGuard")!, to: f.labels.get("exit")!, kind: "jump" });
    expect(f.discover()).toEqual([]);
    const g = fixture();
    g.code.status = "partial";
    // Remove the discovery reference as well; a partial graph cannot certify the region.
    g.image.fill(0, 0x30, 0x35);
    expect(g.discover()).toEqual([]);
  });
  it("requires the actual site in the discovered run callback layout", () => {
    const f = fixture();
    f.layout.callbacks[0]!.sites = [];
    expect(f.discover()).toEqual([]);
  });
});
