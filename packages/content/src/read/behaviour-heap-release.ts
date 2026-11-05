/** Recognises a heap release contract that is valid only for a fresh, exclusively owned allocation. */
import type { Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Operand } from "./x86.ts";

type Bindings = Map<string, number>;
const operand = (o: Operand): string | undefined => {
  if (o.kind === "register") return o.name;
  if (o.kind === "immediate") return `#${o.value}`;
  if (o.kind === "memory") return `${o.width}:${o.segment}[${[...o.base, o.displacement].join("+")}]`;
};

/** Matches decoded operands and every CFG edge, rather than trusting disassembly text or a byte prefix. */
export function matchHeapRoutine(code: RoutineCode, pattern: string, bindings: Bindings): Bindings | undefined {
  return matchSequence(code, pattern, bindings);
}

/** Checks a complete region and rejects every external edge into its interior. The exit remains a real CFG address. */
export function matchInstructionRegion(
  code: RoutineCode,
  instructions: RoutineCode["instructions"],
  exit: number,
  pattern: string,
  bindings: Bindings,
): Bindings | undefined {
  if (code.status !== "complete" || !instructions.length || instructions.some((i) => !code.instructions.includes(i)))
    return;
  const addresses = new Set(instructions.map((i) => i.address));
  const entry = instructions[0]!.address;
  if (
    addresses.size !== instructions.length ||
    addresses.has(exit) ||
    (addresses.has(code.address) && code.address !== entry) ||
    code.edges.some((e) => e.to !== null && addresses.has(e.to) && !addresses.has(e.from) && e.to !== entry) ||
    code.edges.some((e) => addresses.has(e.from) && (e.to === null || (!addresses.has(e.to) && e.to !== exit)))
  )
    return;
  return matchSequence(
    {
      ...code,
      address: entry,
      instructions,
      edges: code.edges.filter((e) => addresses.has(e.from)),
      calls: code.calls.filter((c) => addresses.has(c.instruction)),
    },
    pattern,
    bindings,
    exit,
  );
}

function matchSequence(code: RoutineCode, pattern: string, bindings: Bindings, exit?: number): Bindings | undefined {
  if (code.status !== "complete") return;
  const rows = pattern
    .trim()
    .split("\n")
    .map((row) => row.trim());
  const labels = new Map<string, number>();
  if (exit !== undefined) labels.set("exit", exit);
  const parsed = rows.map((row, n) => {
    const label = /^([A-Za-z]+): /.exec(row);
    if (label) {
      labels.set(label[1]!, code.instructions[n]?.address ?? -1);
      return row.slice(label[0].length);
    }
    return row;
  });
  if (parsed.length !== code.instructions.length || code.address !== code.instructions[0]?.address) return;
  const result = new Map(bindings);
  const bind = (name: string, value: number) => {
    if (result.has(name) && result.get(name) !== value) return false;
    result.set(name, value);
    return true;
  };
  for (let n = 0; n < parsed.length; n++) {
    let row = parsed[n]!;
    const i = code.instructions[n]!;
    const prefixes = row.startsWith("rep ") ? ["rep"] : [];
    if (prefixes.length) row = row.slice(4);
    if (i.prefixes.join() !== prefixes.join()) return;
    const [mnemonic, target] = row.split(" ");
    if (mnemonic === "call" || mnemonic === "callf") {
      const call = code.calls.find((c) => c.instruction === i.address);
      if (
        i.flow !== "call" ||
        i.mnemonic !== "call" ||
        !call?.target ||
        call.confidence !== "checked" ||
        call.far !== (mnemonic === "callf") ||
        i.target?.address !== call.target.address ||
        !target?.startsWith("$") ||
        !bind(target.slice(1), call.target.address)
      )
        return;
    } else if (target?.startsWith("@")) {
      if (
        i.mnemonic !== mnemonic ||
        !["branch", "jump"].includes(i.flow) ||
        i.target?.address !== labels.get(target.slice(1))
      )
        return;
    } else {
      const values = i.operands.map(operand);
      if (values.some((v) => v === undefined)) return;
      const text = `${i.mnemonic}${values.length ? " " + values.join(",") : ""}`;
      const names: string[] = [];
      const expression = row
        .split(/(\{[A-Za-z]+\})/)
        .map((part) => {
          if (part.startsWith("{")) {
            names.push(part.slice(1, -1));
            return "(-?[0-9]+)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      const matched = new RegExp(`^${expression}$`).exec(text);
      if (!matched || names.some((name, index) => !bind(name, Number(matched[index + 1])))) return;
    }
    if (
      i.mnemonic === "ret" || i.mnemonic === "retf"
        ? i.flow !== "return"
        : !row.includes(" @") && !["call", "callf"].includes(mnemonic!) && i.flow !== "next"
    )
      return;
    const next = code.instructions[n + 1]?.address ?? exit;
    if (["next", "call", "branch"].includes(i.flow) && next !== i.address + i.size) return;
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
            : [{ to: next, kind: "next" }];
    const edges = code.edges.filter((e) => e.from === i.address);
    if (
      expected.some((e) => e.to === undefined) ||
      edges.length !== expected.length ||
      expected.some((expectedEdge) => !edges.some((e) => e.to === expectedEdge.to && e.kind === expectedEdge.kind))
    )
      return;
  }
  if (
    code.edges.some((e) => !code.instructions.some((i) => i.address === e.from)) ||
    code.calls.length !== code.instructions.filter((i) => i.flow === "call").length
  )
    return;
  return result;
}

const release = `push si
push di
mov si,sp
mov bx,16:ds[si+8]
sub bx,#4
jb @done
cmp bx,16:ds[{last}]
je @tail
call $coalesce
jmp @done
tail: call $tail
done: pop di
pop si
retf`;
const coalesce = `dec 16:ds[bx+0]
cmp bx,16:ds[{first}]
je @insert
mov si,16:ds[bx+2]
mov ax,16:ds[si+0]
test al,#1
jne @insert
add ax,16:ds[bx+0]
mov 16:ds[si+0],ax
mov di,16:ds[bx+0]
add di,bx
mov 16:ds[di+2],si
mov bx,si
jmp @next
insert: call $insert
next: mov di,16:ds[bx+0]
add di,bx
mov ax,16:ds[di+0]
test al,#1
je @merge
ret
merge: add 16:ds[bx+0],ax
mov si,di
add si,ax
mov 16:ds[si+2],bx
mov bx,di
unlink: mov di,16:ds[bx+6]
cmp bx,di
je @single
mov 16:ds[{free}],di
mov si,16:ds[bx+4]
mov 16:ds[di+4],si
mov 16:ds[si+6],di
ret
single: mov 16:ds[{free}],#0
ret`;
const tail = `cmp 16:ds[{first}],bx
je @empty
mov si,16:ds[bx+2]
test 8:ds[si+0],#1
je @merge
mov 16:ds[{last}],si
jmp @finish
merge: cmp si,16:ds[{first}]
je @first
mov bx,si
call $unlink
mov ax,16:ds[bx+2]
mov 16:ds[{last}],ax
jmp @finish
first: mov bx,si
empty: xor ax,ax
mov 16:ds[{first}],ax
mov 16:ds[{last}],ax
mov 16:ds[{free}],ax
finish: push bx
call $boundary
pop bx
ret`;
const insert = `mov si,16:ds[{free}]
or si,si
je @empty
mov di,16:ds[si+6]
mov 16:ds[si+6],bx
mov 16:ds[di+4],bx
mov 16:ds[bx+6],di
mov 16:ds[bx+4],si
ret
empty: mov 16:ds[{free}],bx
mov 16:ds[bx+4],bx
mov 16:ds[bx+6],bx
ret`;
const boundary = `push bp
mov bp,sp
mov ax,16:ss[bp+4]
mov dx,sp
sub dx,#512
cmp ax,dx
jae @fail
mov 16:ds[{break}],ax
xor ax,ax
jmp @done
fail: mov 16:ds[{error}],#8
mov ax,#65535
done: pop bp
ret`;
const allocator = `push si
push di
mov si,sp
mov ax,16:ds[si+8]
or ax,ax
je @done
add ax,#5
jb @fail
and ax,#65534
cmp ax,#8
jae @minimum
mov ax,#8
minimum: cmp 16:ds[{first}],#0
je @initialize
mov bx,16:ds[{free}]
or bx,bx
je @grow
mov dx,bx
search: cmp 16:ds[bx+0],ax
jae @found
mov bx,16:ds[bx+6]
cmp bx,dx
jne @search
grow: call $grow
jmp @done
split: call $split
jmp @done
initialize: call $initialize
jmp @done
fail: xor ax,ax
jmp @done
found: mov si,ax
add si,#8
cmp 16:ds[bx+0],si
jae @split
call $unlink
inc 16:ds[bx+0]
mov ax,bx
add ax,#4
done: pop di
pop si
retf`;
const initialize = `push ax
xor ax,ax
push ax
push ax
call $extend
pop bx
pop bx
and ax,#1
je @aligned
xor dx,dx
push dx
push ax
call $extend
pop bx
pop bx
aligned: pop ax
push ax
xor bx,bx
push bx
push ax
call $extend
pop bx
pop bx
cmp ax,#65535
je @fail
mov bx,ax
mov 16:ds[{first}],bx
mov 16:ds[{last}],bx
pop ax
inc ax
mov 16:ds[bx+0],ax
add bx,#4
mov ax,bx
ret
fail: pop bx
xor ax,ax
ret`;
const grow = `push ax
xor bx,bx
push bx
push ax
call $extend
pop bx
pop bx
cmp ax,#65535
je @fail
mov bx,ax
mov ax,16:ds[{last}]
mov 16:ds[bx+2],ax
mov 16:ds[{last}],bx
pop ax
inc ax
mov 16:ds[bx+0],ax
add bx,#4
mov ax,bx
ret
fail: pop ax
xor ax,ax
ret`;
const split = `sub 16:ds[bx+0],ax
mov si,bx
add si,16:ds[bx+0]
mov di,si
add di,ax
inc ax
mov 16:ds[si+0],ax
mov 16:ds[si+2],bx
mov 16:ds[di+2],si
add si,#4
mov ax,si
ret`;
const extend = `push bp
mov bp,sp
mov ax,16:ss[bp+4]
mov dx,16:ss[bp+6]
add ax,16:ds[{break}]
adc dx,#0
mov cx,ax
or dx,dx
jne @fail
add cx,#512
jb @fail
cmp cx,sp
jae @fail
xchg 16:ds[{break}],ax
jmp @done
fail: mov 16:ds[{error}],#8
mov ax,#65535
done: pop bp
ret`;
const wrapper = `push bp
mov bp,sp
push 16:ss[bp+6]
nop
push cs
call $release
inc sp
inc sp
pop bp
retf`;
const checkedWrapper = `push bp
mov bp,sp
nop
push cs
call $validate
push 16:ss[bp+6]
nop
push cs
call $wrapper
pop cx
nop
push cs
call $validate
pop bp
retf`;

/**
 * The same checked wrapper with its release made as a real far call. A far call pushes the same return CS:IP as the
 * linker's `nop`, `push cs`, near `call` form, so the wrapper still finds its argument at [bp+6] and returns by retf.
 */
const farCheckedWrapper = `push bp
mov bp,sp
nop
push cs
call $validate
push 16:ss[bp+6]
callf $wrapper
pop cx
nop
push cs
call $validate
pop bp
retf`;

/** Binds the validation helper and the release wrapper in either call form; every other instruction and edge matches. */
export function matchCheckedReleaseWrapper(code: RoutineCode): Bindings | undefined {
  return matchHeapRoutine(code, checkedWrapper, new Map()) ?? matchHeapRoutine(code, farCheckedWrapper, new Map());
}

export interface OwnedHeapRelease extends Finding {
  address: number;
  allocator: number;
  headerSize: 4;
  globals: { first: number; last: number; free: number; boundary: number; error: number };
}

/** Never grants an arbitrary free call a part-preserving summary: the released payload ceases to be live. */
export function proveOwnedHeapRelease(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  allocationEvidence: Set<number>,
): OwnedHeapRelease | undefined {
  let bindings = matchCheckedReleaseWrapper(code);
  const matched = [code];
  const match = (role: string, pattern: string) => {
    const target = bindings?.get(role),
      next = target === undefined ? undefined : codes.get(target);
    if (!bindings || !next) return false;
    const result = matchHeapRoutine(next, pattern, bindings);
    if (!result) return false;
    bindings = result;
    matched.push(next);
    return true;
  };
  if (
    !bindings ||
    !match("wrapper", wrapper) ||
    !match("release", release) ||
    !match("coalesce", coalesce) ||
    !match("tail", tail) ||
    !match("insert", insert) ||
    !match("boundary", boundary)
  )
    return;
  const validate = summaries.get(bindings.get("validate")!);
  if (!validate?.footprint.complete || !validate.footprint.preservesArgumentMemory || validate.writes.length) return;
  const coalescer = codes.get(bindings.get("coalesce")!)!;
  if (coalescer.instructions[26]?.address !== bindings.get("unlink")) return;
  const candidates = [...codes.values()].filter((candidate) => allocationEvidence.has(candidate.address));
  const raw = candidates.find((candidate) => matchHeapRoutine(candidate, allocator, bindings!));
  if (!raw) return;
  bindings = matchHeapRoutine(raw, allocator, bindings)!;
  matched.push(raw);
  if (
    !match("initialize", initialize) ||
    !match("grow", grow) ||
    !match("split", split) ||
    !match("extend", extend) ||
    ["initialize", "grow", "split", "extend", "unlink"].some((role) => !allocationEvidence.has(bindings!.get(role)!))
  )
    return;
  const globals = ["first", "last", "free", "break", "error"].map((name) => bindings!.get(name)!);
  if (
    globals.some((at) => at < 0 || at > 65534) ||
    globals.some((at, n) => globals.some((other, m) => n !== m && Math.abs(at - other) < 2))
  )
    return;
  return {
    address: code.address,
    allocator: raw.address,
    headerSize: 4,
    globals: { first: globals[0]!, last: globals[1]!, free: globals[2]!, boundary: globals[3]!, error: globals[4]! },
    confidence: "inferred",
    evidence: matched
      .flatMap((c) => c.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })))
      .concat(validate.evidence),
    assumptions: [
      ...validate.assumptions,
      "The C runtime uses the same segment for DS and SS while its SI-based stack argument loads execute.",
      "This contract applies only to a nonnull fresh allocation exclusively owned by the caller. Its payload becomes invalid after release; other live allocations remain separate.",
      "The allocator's aligned block headers form a valid finite chain, the low size bit marks allocation, and the free ring contains only free blocks. Header and free-node storage is separate from live payloads and the C stack.",
      "The shared allocator proof establishes valid sizes and links. Release changes the current header, free neighbours, free-ring links and recorded heap globals. Its tail boundary lies beyond every retained live block.",
      "The boundary helper only updates its recorded globals; no operating-system call or payload store occurs. Heap validation may fail to return on malformed metadata. The contract describes normal returns with valid stack capacity.",
    ],
  };
}

const clearedWrapper = `push bp
mov bp,sp
push 16:ss[bp+8]
push 16:ss[bp+6]
nop
push cs
call $cleared
add sp,#4
pop bp
retf`;
const cleared = `push bp
mov bp,sp
sub sp,#4
push si
mov bx,16:ss[bp+6]
xor cx,cx
mov ax,16:ss[bp+8]
xor dx,dx
call $multiply
mov 16:ss[bp+-2],dx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-2],#0
jb @allocate
ja @fail
cmp 16:ss[bp+-4],#-1
jbe @allocate
fail: xor ax,ax
jmp @assigned
allocate: push 16:ss[bp+-4]
nop
push cs
call $allocator
pop cx
assigned: mov si,ax
or si,si
je @done
mov al,#0
push ax
push 16:ss[bp+-4]
push si
nop
push cs
call $fill
add sp,#6
done: mov ax,si
pop si
mov sp,bp
pop bp
retf`;
const fill = `push bp
mov bp,sp
push di
push ds
pop es
mov di,16:ss[bp+6]
mov cx,16:ss[bp+8]
mov al,8:ss[bp+10]
mov ah,al
cld
test di,#1
je @words
jcxz @done
stosb
dec cx
words: shr cx,#1
rep stosw
jae @done
stosb
done: pop di
pop bp
retf`;
const multiply = `push si
xchg ax,si
xchg ax,dx
test ax,ax
je @low
mul bx
low: jcxz @product
xchg ax,cx
mul si
add ax,cx
product: xchg ax,si
mul bx
add dx,si
pop si
ret`;

/** Certifies that every nonnull return has the whole requested product-sized payload filled with zero bytes. */
export function proveClearedAllocation(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  allocation: OwnedHeapRelease,
): Finding | undefined {
  let bindings = matchHeapRoutine(code, clearedWrapper, new Map([["allocator", allocation.allocator]]));
  if (!bindings) return;
  const matched = [code];
  for (const [role, pattern] of [
    ["cleared", cleared],
    ["fill", fill],
    ["multiply", multiply],
  ]) {
    const target = codes.get(bindings.get(role!)!);
    if (!target) return;
    const result = matchHeapRoutine(target, pattern!, bindings);
    if (!result) return;
    bindings = result;
    matched.push(target);
  }
  return {
    confidence: "inferred",
    evidence: [
      ...allocation.evidence,
      ...matched.flatMap((c) => c.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }))),
    ],
    assumptions: [
      ...allocation.assumptions,
      "The product is checked for a 16-bit payload size before allocation. On a nonnull return, the decoded forward byte/word fill writes exactly that many zero bytes to the new payload. The C stack and fresh payload are separate and do not wrap.",
    ],
  };
}
