/** Describes the scratch rectangles prepared before the shared contact searches. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";

export interface ContactBounds extends Finding {
  kind: "candidate" | "movement" | "swept-subject";
  objectGlobal: number;
  width: 16;
  arithmetic: "wrappingWords";
  values: {
    global: number;
    operation: "copy" | "add" | "addSignedHalf" | "subtract" | "signedMinimum" | "addWordAbsolute";
    inputs: ({ kind: "objectField"; offset: number } | { kind: "global"; offset: number })[];
  }[];
}

const movement = `push bp
mov bp,sp
mov bx,16:ds[{subject}]
mov ax,16:ds[{x}]
sub ax,16:ds[bx+{previousX}]
mov 16:ds[{dx}],ax
mov ax,16:ds[{y}]
sub ax,16:ds[bx+{previousY}]
mov 16:ds[{dy}],ax
pop bp
retf`;

const candidate = `push bp
mov bp,sp
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+{xField}]
mov 16:ds[{left}],ax
mov ax,16:ds[bx+{yField}]
mov 16:ds[{top}],ax
mov ax,16:ds[{left}]
add ax,16:ds[bx+{widthField}]
mov 16:ds[{right}],ax
mov ax,16:ds[{top}]
add ax,16:ds[bx+{heightField}]
mov 16:ds[{bottom}],ax
mov ax,16:ds[bx+{baseWidth}]
sar ax,#1
mov dx,16:ds[{left}]
add dx,ax
mov 16:ds[{centerX}],dx
mov ax,16:ds[bx+{baseHeight}]
sar ax,#1
mov dx,16:ds[{top}]
add dx,ax
mov 16:ds[{centerY}],dx
pop bp
retf`;

const swept = `push bp
mov bp,sp
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+{xField}]
mov 16:ds[{x}],ax
mov 16:ds[{left}],ax
mov ax,16:ds[bx+{yField}]
mov 16:ds[{y}],ax
mov 16:ds[{top}],ax
mov ax,16:ds[{x}]
add ax,16:ds[bx+{widthField}]
mov 16:ds[{right}],ax
mov ax,16:ds[{y}]
add ax,16:ds[bx+{heightField}]
mov 16:ds[{bottom}],ax
mov ax,16:ds[bx+{baseWidth}]
sar ax,#1
mov dx,16:ds[{x}]
add dx,ax
mov 16:ds[{centerX}],dx
mov ax,16:ds[bx+{baseHeight}]
sar ax,#1
mov dx,16:ds[{y}]
add dx,ax
mov 16:ds[{centerY}],dx
push cs
call $movement
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+{previousX}]
cmp ax,16:ds[{x}]
jge @vertical
mov 16:ds[{left}],ax
vertical: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+{previousY}]
cmp ax,16:ds[{y}]
jge @expand
mov 16:ds[{top}],ax
expand: mov ax,16:ds[{dx}]
cwd
xor ax,dx
sub ax,dx
add 16:ds[{right}],ax
mov ax,16:ds[{dy}]
cwd
xor ax,dx
sub ax,dx
add 16:ds[{bottom}],ax
pop bp
retf`;

// Some compilers reload the context pointer before each field read and again on the taken minimum branch.
const reloaded = (pattern: string) => {
  let first = true;
  return pattern
    .split("\n")
    .flatMap((line, index, lines) => {
      if (line.startsWith("mov ax,16:ds[bx+")) {
        if (first) {
          first = false;
          return [line];
        }
        return lines[index - 1]?.endsWith("mov bx,16:ds[{subject}]") ? [line] : ["mov bx,16:ds[{subject}]", line];
      }
      if (line.startsWith("mov ax,16:ds[{") && lines[index + 1]?.startsWith("add ax,16:ds[bx+"))
        return ["mov bx,16:ds[{subject}]", line];
      if (
        line.startsWith("mov ax,16:ds[{") &&
        lines[index + 1]?.startsWith("sub ax,16:ds[bx+") &&
        !lines[index - 1]?.endsWith("mov bx,16:ds[{subject}]")
      )
        return ["mov bx,16:ds[{subject}]", line];
      if (line === "mov 16:ds[{left}],ax" && lines[index - 1]?.startsWith("jge"))
        return ["mov bx,16:ds[{subject}]", "mov ax,16:ds[bx+{previousX}]", line];
      if (line === "mov 16:ds[{top}],ax" && lines[index - 1]?.startsWith("jge"))
        return ["mov bx,16:ds[{subject}]", "mov ax,16:ds[bx+{previousY}]", line];
      return [line];
    })
    .join("\n");
};
const match = (code: RoutineCode, pattern: string) =>
  matchHeapRoutine(code, pattern, new Map()) ?? matchHeapRoutine(code, reloaded(pattern), new Map());

/** A complete operand and CFG match makes the scratch footprint independent of code and data relocation. */
export function discoverContactBounds(code: RoutineCode, codes: Map<number, RoutineCode>): EngineSummary | undefined {
  let bindings = match(code, candidate);
  let kind: ContactBounds["kind"] = "candidate";
  let dependency: EngineSummary | undefined;
  if (!bindings) {
    kind = "movement";
    bindings = match(code, movement);
  }
  if (!bindings) {
    kind = "swept-subject";
    bindings = match(code, swept);
    if (!bindings) return;
    const nested = codes.get(bindings.get("movement")!);
    if (!nested || !match(nested, movement)) return;
    dependency = nested && discoverContactBounds(nested, new Map());
    if (dependency?.contactBounds?.kind !== "movement") return;
    const relation = dependency.contactBounds;
    if (relation.objectGlobal !== bindings.get("subject")) return;
    for (const [name, index] of [
      ["dx", 0],
      ["dy", 1],
    ] as const) {
      const value = relation.values[index]!;
      const coordinate = index === 0 ? "x" : "y";
      const previous = index === 0 ? "previousX" : "previousY";
      if (
        value.global !== bindings.get(name) ||
        value.inputs[0]?.offset !== bindings.get(coordinate) ||
        value.inputs[1]?.offset !== bindings.get(previous)
      )
        return;
    }
  }
  const get = (name: string) => bindings!.get(name)!;
  const global = (name: string) => ({ kind: "global" as const, offset: get(name) });
  const object = (name: string) => ({ kind: "objectField" as const, offset: get(name) });
  const values: ContactBounds["values"] = [];
  const add = (
    name: string,
    operation: ContactBounds["values"][number]["operation"],
    ...inputs: ContactBounds["values"][number]["inputs"]
  ) => values.push({ global: get(name), operation, inputs });
  if (kind === "movement") {
    add("dx", "subtract", global("x"), object("previousX"));
    add("dy", "subtract", global("y"), object("previousY"));
  } else {
    if (kind === "swept-subject") {
      add("x", "copy", object("xField"));
      add("y", "copy", object("yField"));
    }
    add(
      "left",
      kind === "candidate" ? "copy" : "signedMinimum",
      object("xField"),
      ...(kind === "candidate" ? [] : [object("previousX")]),
    );
    add(
      "top",
      kind === "candidate" ? "copy" : "signedMinimum",
      object("yField"),
      ...(kind === "candidate" ? [] : [object("previousY")]),
    );
    add("right", "add", object("xField"), object("widthField"));
    add("bottom", "add", object("yField"), object("heightField"));
    add("centerX", "addSignedHalf", object("xField"), object("baseWidth"));
    add("centerY", "addSignedHalf", object("yField"), object("baseHeight"));
    if (dependency) {
      values.push(...dependency.contactBounds!.values);
      add("right", "addWordAbsolute", global("right"), global("dx"));
      add("bottom", "addWordAbsolute", global("bottom"), global("dy"));
    }
  }
  const words = [
    ...new Set([
      get("subject"),
      ...values.map((value) => value.global),
      ...values.flatMap((value) =>
        value.inputs.filter((input) => input.kind === "global").map((input) => input.offset),
      ),
    ]),
  ];
  if (
    words.some((word, n) => word < 0 || word > 65534 || words.some((other, m) => n !== m && Math.abs(word - other) < 2))
  )
    return;
  if (
    values
      .flatMap((value) => value.inputs)
      .some((input) => input.kind === "objectField" && (input.offset < 0 || input.offset > 65534))
  )
    return;
  const finding: Finding = {
    confidence: "inferred",
    evidence: [
      ...code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
      ...(dependency?.evidence ?? []),
    ],
    assumptions: [
      "The bound global words are distinct valid scratch storage, separate from parts and private C stack frames. The subject global denotes a valid part throughout the call.",
      "Every arithmetic result wraps to 16 bits. Signed minimum uses the original signed coordinate comparison; signed half uses arithmetic right shift. Word absolute leaves 0x8000 unchanged.",
      "The relation prepares rectangle coordinates and movement only. It does not establish that a contact exists or choose a contact partner.",
    ],
  };
  return {
    ...finding,
    address: code.address,
    kind: "contact-bounds",
    purpose:
      kind === "candidate"
        ? "Prepares a candidate part's rectangle and centre coordinates for contact tests."
        : kind === "movement"
          ? "Subtracts the subject's previous coordinates from its current coordinates to record movement."
          : "Prepares the moving subject's rectangle, centres and movement-expanded bounds for contact tests.",
    argumentOffset: 6,
    argumentKind: "unknown",
    contactBounds: { ...finding, kind, objectGlobal: get("subject"), width: 16, arithmetic: "wrappingWords", values },
    writes: [...new Set(values.map((value) => value.global))].map((offset) => ({
      ...finding,
      root: "global",
      path: [],
      offset,
      width: 16,
      value: {
        kind: "unknown",
        reason:
          "The contact scratch value depends on a global object pointer; its ordered relation is recorded in contactBounds.",
        width: 16,
      },
      condition: { kind: "true" },
    })),
    returns: [],
    calls: dependency ? [dependency.address] : [],
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
