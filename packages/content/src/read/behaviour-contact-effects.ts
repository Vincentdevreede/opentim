/** Proves contact-search memory footprints with pointer provenance joined over every CFG edge. */
import type { RoutineCode, RoutineCall } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Evidence, Finding } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";
import { privateStackOutputs } from "./behaviour-buffer-effects.ts";
import { discoverEmptyContactReturn, type EmptyContactReturn } from "./behaviour-contact-empty.ts";

export interface ContactObjectWrite extends Finding {
  objectGlobal: number;
  offset: number;
  width: number;
}
export interface ContactSearch extends Finding {
  emptyReturn?: EmptyContactReturn;
  subjectGlobal: number;
  candidateGlobal: number;
  fields: { offset: number; width: number }[];
  preservesState: true;
  geometry: "unresolved";
  purpose: string;
}
interface Base {
  root: "argument" | "global" | "stack";
  id: number;
  displacement: number;
}
type State = Map<string, Base>;
interface Scope {
  objectWrites: (Base & { offset: number; width: number; evidence: Evidence[] })[];
  globals: { offset: number; width: number; evidence: Evidence[] }[];
  evidence: Evidence[];
  assumptions: string[];
}
const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const mem = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const stack = (o: Operand | undefined) => mem(o) && o.segment === "ss" && o.base.join() === "bp";
const proof = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
const same = (a: Base | undefined, b: Base | undefined) =>
  !!a && !!b && a.root === b.root && a.id === b.id && a.displacement === b.displacement;
const parent: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};
const store = (i: Instruction) =>
  mem(i.operands[0]) && !["cmp", "test", "push", "mul", "imul", "div", "idiv", "call", "jmp"].includes(i.mnemonic);
const writesRegister = (i: Instruction) => reg(i.operands[0]) && !["cmp", "test", "push"].includes(i.mnemonic);
const unique = (items: Evidence[]) => [...new Map(items.map((e) => [e.address, e])).values()];

/** A bounded meet keeps only identical pointer origins on all incoming paths; no scalar game values are evaluated. */
export function proveContactFootprint(
  code: RoutineCode,
  summaries: Map<number, EngineSummary>,
  scopes: Map<number, Scope> = new Map(),
): Scope | undefined {
  if (code.status !== "complete") return;
  const [push, frame] = code.instructions;
  if (
    push?.mnemonic !== "push" ||
    !reg(push.operands[0], "bp") ||
    frame?.mnemonic !== "mov" ||
    !reg(frame.operands[0], "bp") ||
    !reg(frame.operands[1], "sp")
  )
    return;
  if (
    code.instructions.some(
      (i) =>
        /^(movs|stos|ins|outs|lods|scas|cmps)/.test(i.mnemonic) ||
        /^(enter|pusha|popa|int|into|iret|bound|esc|lds|les|xchg|xlat|lahf|aaa|aas|daa|das|aam|aad)$/.test(
          i.mnemonic,
        ) ||
        ["in", "out"].includes(i.mnemonic) ||
        (writesRegister(i) &&
          ["ds", "ss", "bp"].includes((i.operands[0] as Extract<Operand, { kind: "register" }>).name) &&
          i !== frame &&
          !(
            i.mnemonic === "pop" &&
            reg(i.operands[0], "bp") &&
            code.instructions.find((n) => n.address === i.address + i.size)?.flow === "return"
          )),
    )
  )
    return;
  if (
    code.instructions.some(
      (i) =>
        writesRegister(i) &&
        reg(i.operands[0], "sp") &&
        !(i.mnemonic === "mov" && reg(i.operands[1], "bp")) &&
        !(["add", "sub"].includes(i.mnemonic) && i.operands[1]?.kind === "immediate"),
    )
  )
    return;
  const returns = code.instructions.filter((i) => i.flow === "return");
  if (!returns.length || returns.some((i) => i.mnemonic !== "retf" || i.operands.length)) return;
  const reserve = code.instructions[2];
  const frameBytes =
    reserve?.mnemonic === "sub" && reg(reserve.operands[0], "sp") && reserve.operands[1]?.kind === "immediate"
      ? reserve.operands[1].value
      : 0;
  if (frameBytes < 0 || frameBytes > 32767) return;
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  for (const i of code.instructions) {
    const next = i.address + i.size;
    const expected =
      i.flow === "return"
        ? [{ to: null, kind: "return" }]
        : i.flow === "branch"
          ? [
              { to: i.target?.address, kind: "taken" },
              { to: next, kind: "not-taken" },
            ]
          : i.flow === "jump"
            ? [{ to: i.target?.address, kind: "jump" }]
            : ["next", "call"].includes(i.flow)
              ? [{ to: next, kind: "next" }]
              : undefined;
    const actual = code.edges.filter((e) => e.from === i.address);
    if (
      !expected ||
      actual.length !== expected.length ||
      expected.some((e) => e.to === undefined || !actual.some((a) => a.to === e.to && a.kind === e.kind))
    )
      return;
  }
  const outgoing = new Map<number, number[]>(),
    incoming = new Map<number, number[]>();
  for (const e of code.edges) {
    if (!instructions.has(e.from) || e.kind === "unresolved" || e.kind === "stop") return;
    if (e.to !== null) {
      if (!instructions.has(e.to)) return;
      outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
      incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
    }
  }
  const states = new Map<number, State>([[code.address, new Map()]]),
    pending = [code.address];
  const value = (o: Operand | undefined, s: State): Base | undefined => {
    if (reg(o)) return o.width === 16 ? s.get(o.name) : undefined;
    if (!mem(o) || o.width !== 16) return;
    if (stack(o))
      return o.displacement >= 6
        ? { root: "argument", id: o.displacement, displacement: 0 }
        : s.get(`local:${o.displacement}`);
    if (o.segment === "ds" && o.direct)
      return s.get(`global:${o.displacement}`) ?? { root: "global", id: o.displacement, displacement: 0 };
  };
  const mapGlobal = (base: Base, s: State) => {
    if (base.root !== "global") return base;
    const bound = s.get(`global:${base.id}`);
    return bound ? { ...bound, displacement: bound.displacement + base.displacement } : base;
  };
  const argument = (call: RoutineCall, offset: number, s: State): Base | undefined => {
    if (offset < 6 || offset % 2) return;
    let at = call.instruction,
      skipSegment = !call.far;
    for (let n = 0, count = 0; n < 40; n++) {
      const ins = incoming.get(at);
      if (ins?.length !== 1) return;
      const before = instructions.get(ins[0]!)!;
      if (before.flow !== "next" || before.address + before.size !== at) return;
      at = before.address;
      if (before.mnemonic === "push") {
        if (skipSegment && reg(before.operands[0], "cs")) {
          skipSegment = false;
          continue;
        }
        if (skipSegment) return;
        if (count++ === (offset - 6) / 2) return value(before.operands[0], states.get(at) ?? s);
      } else if (before.mnemonic === "pop" || (writesRegister(before) && reg(before.operands[0], "sp"))) return;
    }
  };
  const callEffects = (call: RoutineCall, s: State): Scope | undefined => {
    if (!call.target || call.confidence !== "checked") return;
    const scope = scopes.get(call.target.address),
      helper = summaries.get(call.target.address);
    if (!scope && helper?.globalObjectWrites?.length) return;
    const callee =
      scope ??
      (helper?.footprint.complete
        ? {
            objectWrites: helper.writes
              .filter((w) => w.root === "argument" && !w.path.length && !w.repeated)
              .map((w) => ({
                root: "argument" as const,
                id: w.argumentOffset ?? helper.argumentOffset,
                displacement: 0,
                offset: w.offset,
                width: w.width,
                evidence: w.evidence,
              })),
            globals: helper.writes
              .filter((w) => w.root === "global")
              .map((w) => ({ offset: w.offset, width: w.width, evidence: w.evidence })),
            evidence: helper.evidence,
            assumptions: helper.assumptions,
          }
        : undefined);
    if (!callee) return;
    if (!scope && helper!.writes.some((w) => w.path.length || w.repeated || !["argument", "global"].includes(w.root)))
      return;
    const convention = helper?.returnConvention;
    const previous = instructions.get(incoming.get(call.instruction)?.[0] ?? -1);
    if (!scope && (!convention || convention.kind !== "far" || convention.stackBytes)) return;
    if (
      !call.far &&
      (incoming.get(call.instruction)?.length !== 1 ||
        previous?.mnemonic !== "push" ||
        !reg(previous.operands[0], "cs"))
    )
      return;
    const privateOutput =
      !scope && helper!.kind === "argument-buffer-update" ? privateStackOutputs(code, call, helper!) : undefined;
    const writes: Scope["objectWrites"] = [];
    for (const write of callee.objectWrites) {
      if (privateOutput) continue;
      const mapped = write.root === "argument" ? argument(call, write.id, s) : mapGlobal(write, s);
      if (!mapped) return;
      if (mapped.root === "stack") {
        const at = write.offset + write.displacement + mapped.displacement;
        if (at < -frameBytes || at + write.width / 8 > 0) return;
        continue;
      }
      writes.push({
        ...write,
        ...mapped,
        offset: write.offset + write.displacement + mapped.displacement,
        displacement: 0,
      });
    }
    return { ...callee, objectWrites: writes };
  };
  let budget = code.instructions.length * 24;
  while (pending.length) {
    if (--budget < 0) return;
    const at = pending.pop()!,
      i = instructions.get(at)!;
    const s = new Map(states.get(at));
    const [dest, source] = i.operands;
    if (i.flow === "call") {
      const call = code.calls.find((c) => c.instruction === at);
      const effects = call && callEffects(call, s);
      if (!effects) return;
      for (const key of s.keys()) {
        if (key.startsWith("local:")) s.delete(key);
        if (
          key.startsWith("global:") &&
          effects.globals.some(
            (g) => Number(key.slice(7)) < g.offset + g.width / 8 && g.offset < Number(key.slice(7)) + 2,
          )
        )
          s.delete(key);
      }
      for (const name of ["ax", "bx", "cx", "dx", "es"]) s.delete(name);
    } else {
      let next: Base | undefined;
      if (i.mnemonic === "mov") next = value(source, s);
      else if (i.mnemonic === "lea" && stack(source))
        next = { root: "stack", id: 0, displacement: (source as Extract<Operand, { kind: "memory" }>).displacement };
      else if (["add", "sub"].includes(i.mnemonic) && reg(dest) && source?.kind === "immediate") {
        const old = s.get(dest.name);
        if (old)
          next = { ...old, displacement: old.displacement + (i.mnemonic === "add" ? source.value : -source.value) };
      } else if (["or", "and"].includes(i.mnemonic) && reg(dest) && reg(source, dest.name)) next = s.get(dest.name);
      if (store(i) && mem(dest)) {
        if (stack(dest)) {
          for (const key of s.keys())
            if (key.startsWith("local:") && Math.abs(Number(key.slice(6)) - dest.displacement) < 2) s.delete(key);
          if (next && dest.width === 16) s.set(`local:${dest.displacement}`, next);
        } else if (dest.segment === "ds" && dest.direct) {
          for (const key of s.keys())
            if (key.startsWith("global:") && Math.abs(Number(key.slice(7)) - dest.displacement) < 2) s.delete(key);
          if (next && dest.width === 16) s.set(`global:${dest.displacement}`, next);
        }
      }
      if (writesRegister(i) && reg(dest)) {
        const name = parent[dest.name] ?? dest.name;
        if (next && dest.width === 16) s.set(name, next);
        else s.delete(name);
      }
      if (["mul", "imul", "div", "idiv", "cwd"].includes(i.mnemonic)) {
        s.delete("dx");
        if (i.mnemonic !== "cwd") s.delete("ax");
      }
      if (i.mnemonic === "cbw") s.delete("ax");
      if (i.mnemonic.startsWith("loop")) s.delete("cx");
    }
    for (const to of outgoing.get(at) ?? []) {
      const before = states.get(to),
        joined = before ? new Map([...before].filter(([k, v]) => same(v, s.get(k)))) : s;
      if (!before || before.size !== joined.size || [...before].some(([k, v]) => !same(v, joined.get(k)))) {
        states.set(to, new Map(joined));
        pending.push(to);
      }
    }
  }
  const result: Scope = { objectWrites: [], globals: [], evidence: code.instructions.map(proof), assumptions: [] };
  for (const i of code.instructions) {
    const s = states.get(i.address);
    if (!s) return;
    if (i.flow === "call") {
      const effects = callEffects(
        code.calls.find((c) => c.instruction === i.address)!,
        s,
      );
      if (!effects) return;
      result.objectWrites.push(...effects.objectWrites);
      result.globals.push(...effects.globals);
      result.evidence.push(...effects.evidence);
      result.assumptions.push(...effects.assumptions);
    }
    if (!store(i)) continue;
    const dest = i.operands[0] as Extract<Operand, { kind: "memory" }>;
    if (stack(dest)) {
      if (dest.displacement >= 0 || dest.displacement < -frameBytes || dest.displacement + dest.width / 8 > 0) return;
      continue;
    }
    if (dest.segment !== "ds" || dest.width > 16) return;
    if (dest.direct) result.globals.push({ offset: dest.displacement, width: dest.width, evidence: [proof(i)] });
    else {
      const base = dest.base.length === 1 ? s.get(dest.base[0]!) : undefined;
      if (!base || base.root === "stack") return;
      result.objectWrites.push({
        ...base,
        offset: base.displacement + dest.displacement,
        displacement: 0,
        width: dest.width,
        evidence: [proof(i)],
      });
    }
  }
  result.evidence = unique(result.evidence);
  result.assumptions = [...new Set(result.assumptions)];
  return result;
}

/** Only roots established by the independently checked rectangle producers are admitted as complete parts. */
export function addContactEffectSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout: BehaviourLayout | undefined,
) {
  const state = layout?.fields.find((f) => f.name === "state");
  if (!state) return;
  const bounds = [...summaries.values()].filter((s) => s.contactBounds);
  const subjects = new Set(
    bounds.filter((s) => s.contactBounds!.kind === "swept-subject").map((s) => s.contactBounds!.objectGlobal),
  );
  const candidates = new Set(
    bounds.filter((s) => s.contactBounds!.kind === "candidate").map((s) => s.contactBounds!.objectGlobal),
  );
  const scopes = new Map<number, Scope>();
  for (let pass = 0; pass < 4; pass++)
    for (const code of codes.values()) {
      if (
        scopes.has(code.address) ||
        summaries.get(code.address)?.footprint.complete ||
        !code.calls.some((c) => c.target && bounds.some((b) => b.address === c.target!.address))
      )
        continue;
      const scope = proveContactFootprint(code, summaries, scopes);
      if (
        !scope ||
        !scope.objectWrites.length ||
        scope.objectWrites.some(
          (w) =>
            w.offset < 0 ||
            w.offset + w.width / 8 > 65536 ||
            (w.offset < state.offset + 2 && state.offset < w.offset + w.width / 8),
        )
      )
        continue;
      const globalRoots = [...new Set(scope.objectWrites.filter((w) => w.root === "global").map((w) => w.id))];
      if (globalRoots.some((root) => !subjects.has(root))) continue;
      const argumentRoots = [...new Set(scope.objectWrites.filter((w) => w.root === "argument").map((w) => w.id))];
      if (argumentRoots.some((root) => root !== 6)) continue;
      if (globalRoots.length && argumentRoots.length) continue;
      const subjectGlobal =
        globalRoots[0] ??
        scope.globals.find((g) =>
          code.instructions.some(
            (i) =>
              i.mnemonic === "mov" &&
              mem(i.operands[0]) &&
              i.operands[0].direct &&
              i.operands[0].displacement === g.offset &&
              reg(i.operands[1], "ax") &&
              code.instructions.some(
                (p) =>
                  p.address + p.size === i.address &&
                  p.mnemonic === "mov" &&
                  reg(p.operands[0], "ax") &&
                  stack(p.operands[1]) &&
                  (p.operands[1] as Extract<Operand, { kind: "memory" }>).displacement === 6,
              ),
          ),
        )?.offset;
      if (subjectGlobal === undefined || !subjects.has(subjectGlobal)) continue;
      const candidateGlobal =
        [...candidates].find((g) =>
          code.instructions.some((i) => i.operands.some((o) => mem(o) && o.direct && o.displacement === g)),
        ) ?? [...candidates][0];
      if (candidateGlobal === undefined) continue;
      scopes.set(code.address, scope);
      const fields = [
        ...new Map(
          scope.objectWrites.map((w) => [`${w.offset}:${w.width}`, { offset: w.offset, width: w.width }]),
        ).values(),
      ];
      const finding: Finding = {
        confidence: "inferred",
        evidence: scope.evidence,
        assumptions: [
          ...scope.assumptions,
          "The subject and candidate context globals denote complete valid parts and remain separate from scratch globals, private stack locals, outline records and the program image. All indirect part stores retain an identical pointer origin at every incoming CFG edge.",
          "This is a may-write footprint conditional on normal return, not a geometric contact predicate or a termination proof. Arithmetic traps and nonreturning lists do not establish successful continuations.",
          "Every direct callee has a complete memory footprint. Output buffers passed to geometric helpers stay in the checked private frame; owner geometry calls receive the proved part pointer. The C convention preserves SI, DI, BP and DS.",
        ],
      };
      const purpose =
        "Searches contact candidates and outline edges, adjusting only the subject's recorded geometry, contact fields and flags; the exact selected contact remains unresolved.";
      summaries.set(code.address, {
        ...finding,
        address: code.address,
        kind: "contact-search",
        purpose,
        argumentOffset: 6,
        argumentKind: argumentRoots.length ? "object" : "scalar",
        contactSearch: {
          emptyReturn: argumentRoots.length ? discoverEmptyContactReturn(code) : undefined,
          ...finding,
          subjectGlobal,
          candidateGlobal,
          fields,
          preservesState: true,
          geometry: "unresolved",
          purpose,
        },
        globalObjectWrites: scope.objectWrites
          .filter((w) => w.root === "global")
          .map((w) => ({ ...finding, objectGlobal: w.id, offset: w.offset, width: w.width, evidence: w.evidence })),
        writes: [
          ...scope.objectWrites
            .filter((w) => w.root === "argument")
            .map((w) => ({
              ...finding,
              root: "argument" as const,
              argumentOffset: w.id,
              path: [],
              offset: w.offset,
              width: w.width,
              value: {
                kind: "unknown" as const,
                width: w.width,
                reason: "A contact search may change this field; its selected geometric result is unresolved.",
              },
              condition: { kind: "unknown" as const, reason: "The contact search reaches this store." },
              evidence: w.evidence,
            })),
          ...scope.globals.map((w) => ({
            ...finding,
            root: "global" as const,
            path: [],
            ...w,
            value: { kind: "unknown" as const, width: w.width, reason: "Contact scratch output" },
            condition: { kind: "true" as const },
          })),
        ],
        returns: [],
        calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
        returnConvention: { kind: "far", stackBytes: 0 },
        footprint: {
          complete: true,
          partMemoryComplete: true,
          preservesArgumentMemory: !argumentRoots.length,
          preservesPartState: true,
          unknownEffects: [],
        },
      });
    }
}
