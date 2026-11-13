/**
 * Runs the original program's 16-bit code: a real-mode 8086 processor with the 286 forms the programs use (`push`
 * of an immediate, `pusha` and `popa`, shifts by an immediate count, `imul` with three operands, `enter`, `leave`
 * and `bound`). It executes the instructions `decodeInstruction` reads, so it runs exactly the code the analysis reads.
 * Interrupts and ports go to the hooks the caller gives: the processor knows nothing about DOS, the BIOS or the
 * hardware, and an interrupt without a handler goes through the interrupt table in memory, as on the machine.
 */
import { decodeInstruction, type Instruction, type Operand } from "../read/x86.ts";

/** One megabyte, plus the 64 KB a segment can reach past it (the address wraps, as on an 8086). */
const MEMORY = 0x100000;

export const CF = 0x0001;
export const PF = 0x0004;
export const AF = 0x0010;
export const ZF = 0x0040;
export const SF = 0x0080;
const TF = 0x0100;
export const IF = 0x0200;
const DF = 0x0400;
export const OF = 0x0800;

export interface CpuHooks {
  /** Handles a software interrupt and returns true, or returns false to go through the interrupt table. */
  interrupt?(cpu: Cpu, vector: number): boolean;
  portIn?(cpu: Cpu, port: number, width: 8 | 16): number;
  portOut?(cpu: Cpu, port: number, value: number, width: 8 | 16): void;
}

/** Stops a run: the code did something the processor can't do, like divide by zero or reach `hlt`. */
export class CpuStop extends Error {
  readonly at: number;
  constructor(message: string, at: number) {
    super(`${message} at ${at.toString(16)}`);
    this.at = at;
  }
}

/** Stops a run that is still going when its limit of instructions is reached. */
export class CpuRunsOn extends CpuStop {}

const WORDS = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
const BYTES: Record<string, [number, number]> = {
  al: [0, 0],
  cl: [1, 0],
  dl: [2, 0],
  bl: [3, 0],
  ah: [0, 8],
  ch: [1, 8],
  dh: [2, 8],
  bh: [3, 8],
};
const SEGMENTS = ["es", "cs", "ss", "ds"];
const parity = (value: number) => {
  let v = value & 0xff;
  v ^= v >> 4;
  v ^= v >> 2;
  v ^= v >> 1;
  return (v & 1) === 0;
};
const mask = (width: number) => (width === 8 ? 0xff : 0xffff);
const top = (width: number) => (width === 8 ? 0x80 : 0x8000);
const signed = (value: number, width: number) => (value & top(width) ? value - (mask(width) + 1) : value);

export class Cpu {
  readonly memory = new Uint8Array(MEMORY + 0x10000);
  /** ax, cx, dx, bx, sp, bp, si, di. */
  readonly regs = new Uint16Array(8);
  /** es, cs, ss, ds. */
  readonly segs = new Uint16Array(4);
  ip = 0;
  flags = 0x0002;
  /** Instructions run so far. */
  steps = 0;
  /** The instruction running now. */
  current?: Instruction;
  private readonly decoded = new Map<number, Instruction>();
  /** How many decoded instructions cover each byte: a write to a covered byte forgets those instructions. */
  private readonly code = new Uint8Array(MEMORY + 0x10000);
  /** The size of the longest instruction decoded, so a write knows how far back an instruction covering it can start. */
  private longest = 0;

  readonly hooks: CpuHooks;
  constructor(hooks: CpuHooks = {}) {
    this.hooks = hooks;
  }

  get cs() {
    return this.segs[1]!;
  }
  get ds() {
    return this.segs[3]!;
  }
  get ss() {
    return this.segs[2]!;
  }
  get es() {
    return this.segs[0]!;
  }

  register(name: string): number {
    const word = WORDS.indexOf(name);
    if (word >= 0) return this.regs[word]!;
    const segment = SEGMENTS.indexOf(name);
    if (segment >= 0) return this.segs[segment]!;
    const byte = BYTES[name];
    if (!byte) throw new Error(`unknown register ${name}`);
    return (this.regs[byte[0]]! >> byte[1]) & 0xff;
  }
  setRegister(name: string, value: number): void {
    const word = WORDS.indexOf(name);
    if (word >= 0) {
      this.regs[word] = value;
      return;
    }
    const segment = SEGMENTS.indexOf(name);
    if (segment >= 0) {
      this.segs[segment] = value;
      return;
    }
    const byte = BYTES[name];
    if (!byte) throw new Error(`unknown register ${name}`);
    const [index, shift] = byte;
    this.regs[index] = (this.regs[index]! & ~(0xff << shift)) | ((value & 0xff) << shift);
  }

  linear(segment: number, offset: number): number {
    return ((segment << 4) + (offset & 0xffff)) & 0xfffff;
  }
  read8(segment: number, offset: number): number {
    return this.memory[this.linear(segment, offset)]!;
  }
  read16(segment: number, offset: number): number {
    return this.read8(segment, offset) | (this.read8(segment, offset + 1) << 8);
  }
  write8(segment: number, offset: number, value: number): void {
    const at = this.linear(segment, offset);
    this.memory[at] = value;
    if (this.code[at]) this.forgetCodeAt(at);
  }
  write16(segment: number, offset: number, value: number): void {
    this.write8(segment, offset, value);
    this.write8(segment, offset + 1, value >> 8);
  }
  push(value: number): void {
    this.regs[4] = this.regs[4]! - 2;
    this.write16(this.ss, this.regs[4]!, value);
  }
  pop(): number {
    const value = this.read16(this.ss, this.regs[4]!);
    this.regs[4] = this.regs[4]! + 2;
    return value;
  }
  flag(bit: number): boolean {
    return (this.flags & bit) !== 0;
  }
  setFlag(bit: number, on: boolean): void {
    this.flags = on ? this.flags | bit : this.flags & ~bit;
  }

  /** Calls a far routine at `segment:offset` with the given words pushed (the last one nearest), and runs it back. */
  callFar(segment: number, offset: number, args: number[] = [], limit = 50_000_000): number {
    for (const word of [...args].reverse()) this.push(word);
    const returnSegment = 0xffff;
    const returnOffset = 0x0000;
    this.push(returnSegment);
    this.push(returnOffset);
    this.segs[1] = segment;
    this.ip = offset;
    this.runUntil(returnSegment, returnOffset, limit);
    this.regs[4] = this.regs[4]! + args.length * 2;
    return this.regs[0]!;
  }

  /** Runs until the code reaches `segment:offset`, or fails after `limit` instructions. */
  runUntil(segment: number, offset: number, limit: number): void {
    const end = this.steps + limit;
    while (!(this.cs === segment && this.ip === offset)) {
      if (this.steps >= end)
        throw new CpuRunsOn(`still running after ${limit} instructions`, this.linear(this.cs, this.ip));
      this.step();
    }
  }

  private fetch(): Instruction {
    const at = this.linear(this.cs, this.ip);
    const cached = this.decoded.get(at);
    if (cached && cached.segment === this.cs) return cached;
    if (cached) this.cover(at, cached, -1);
    const instruction = decodeInstruction(this.memory, at, this.cs);
    this.decoded.set(at, instruction);
    this.cover(at, instruction, 1);
    this.longest = Math.max(this.longest, instruction.size);
    return instruction;
  }
  /** The bytes of an instruction decoded at `at`: its offsets wrap within its code segment, as the decoder reads them. */
  private covered(at: number, instruction: Instruction): number[] {
    const base = instruction.segment * 16;
    return Array.from({ length: instruction.size }, (_, k) => base + ((at - base + k) & 0xffff));
  }
  private cover(at: number, instruction: Instruction, by: number): void {
    for (const k of this.covered(at, instruction)) this.code[k]! += by;
  }
  /** Forgets the decoded instructions that cover a byte the code wrote. */
  private forgetCodeAt(at: number): void {
    for (let back = 0; back < this.longest; back++)
      // An instruction starts just before the byte, or near the end of its segment and wraps round to the byte.
      for (const start of [at - back, at + 0x10000 - back]) {
        const instruction = this.decoded.get(start);
        if (instruction && this.covered(start, instruction).includes(at)) {
          this.decoded.delete(start);
          this.cover(start, instruction, -1);
        }
      }
  }
  /** Forgets decoded code. A write through the processor does this itself; a caller that writes into `memory` doesn't. */
  forgetCode(): void {
    this.decoded.clear();
    this.code.fill(0);
  }

  private segmentOf(operand: Extract<Operand, { kind: "memory" }>): number {
    return this.register(operand.segment);
  }
  /** The offset a memory operand addresses. */
  offsetOf(operand: Extract<Operand, { kind: "memory" }>): number {
    let offset = operand.displacement;
    for (const base of operand.base) offset += this.register(base);
    return offset & 0xffff;
  }
  get(operand: Operand, width = 16): number {
    switch (operand.kind) {
      case "register":
        return this.register(operand.name);
      case "immediate":
        return operand.value & mask(width);
      case "memory": {
        const segment = this.segmentOf(operand),
          offset = this.offsetOf(operand);
        return operand.width === 8 ? this.read8(segment, offset) : this.read16(segment, offset);
      }
      case "address":
        throw new Error("an address is not a value");
    }
  }
  set(operand: Operand, value: number): void {
    switch (operand.kind) {
      case "register":
        this.setRegister(operand.name, value & (operand.width === 8 ? 0xff : 0xffff));
        return;
      case "memory": {
        const segment = this.segmentOf(operand),
          offset = this.offsetOf(operand);
        if (operand.width === 8) this.write8(segment, offset, value);
        else this.write16(segment, offset, value);
        return;
      }
      default:
        throw new Error(`can't write ${operand.kind}`);
    }
  }
  private widthOf(operand: Operand | undefined): 8 | 16 {
    if (!operand) return 16;
    if (operand.kind === "register") return operand.width;
    if (operand.kind === "memory") return operand.width === 8 ? 8 : 16;
    return 16;
  }

  private logicFlags(result: number, width: number): number {
    const r = result & mask(width);
    this.flags &= ~(CF | OF | ZF | SF | PF | AF);
    if (r === 0) this.flags |= ZF;
    if (r & top(width)) this.flags |= SF;
    if (parity(r)) this.flags |= PF;
    return r;
  }
  private add(a: number, b: number, width: number, carry = 0): number {
    const m = mask(width);
    const sum = a + b + carry;
    const r = sum & m;
    this.flags &= ~(CF | OF | ZF | SF | PF | AF);
    if (sum > m) this.flags |= CF;
    if (((a ^ r) & (b ^ r) & top(width)) !== 0) this.flags |= OF;
    if ((a ^ b ^ r) & 0x10) this.flags |= AF;
    if (r === 0) this.flags |= ZF;
    if (r & top(width)) this.flags |= SF;
    if (parity(r)) this.flags |= PF;
    return r;
  }
  private sub(a: number, b: number, width: number, borrow = 0): number {
    const m = mask(width);
    const difference = a - b - borrow;
    const r = difference & m;
    this.flags &= ~(CF | OF | ZF | SF | PF | AF);
    if (difference < 0) this.flags |= CF;
    if (((a ^ b) & (a ^ r) & top(width)) !== 0) this.flags |= OF;
    if ((a ^ b ^ r) & 0x10) this.flags |= AF;
    if (r === 0) this.flags |= ZF;
    if (r & top(width)) this.flags |= SF;
    if (parity(r)) this.flags |= PF;
    return r;
  }
  private condition(mnemonic: string): boolean {
    const f = this.flags;
    const c = (f & CF) !== 0,
      z = (f & ZF) !== 0,
      s = (f & SF) !== 0,
      o = (f & OF) !== 0,
      p = (f & PF) !== 0;
    switch (mnemonic) {
      case "jo":
        return o;
      case "jno":
        return !o;
      case "jb":
        return c;
      case "jae":
        return !c;
      case "je":
        return z;
      case "jne":
        return !z;
      case "jbe":
        return c || z;
      case "ja":
        return !c && !z;
      case "js":
        return s;
      case "jns":
        return !s;
      case "jp":
        return p;
      case "jnp":
        return !p;
      case "jl":
        return s !== o;
      case "jge":
        return s === o;
      case "jle":
        return z || s !== o;
      case "jg":
        return !z && s === o;
    }
    throw new Error(`unknown condition ${mnemonic}`);
  }

  private shift(mnemonic: string, value: number, count: number, width: number): number {
    const m = mask(width),
      bits = width;
    count &= 0x1f;
    if (count === 0) return value;
    let r = value & m;
    let carry = this.flag(CF);
    switch (mnemonic) {
      case "shl":
      case "sal":
        for (let n = 0; n < count; n++) {
          carry = (r & top(width)) !== 0;
          r = (r << 1) & m;
        }
        this.logicFlags(r, width);
        this.setFlag(CF, carry);
        this.setFlag(OF, ((r & top(width)) !== 0) !== carry);
        return r;
      case "shr":
        this.setFlag(OF, (r & top(width)) !== 0);
        for (let n = 0; n < count; n++) {
          carry = (r & 1) !== 0;
          r >>= 1;
        }
        {
          const of = this.flag(OF);
          this.logicFlags(r, width);
          this.setFlag(OF, count === 1 && of);
        }
        this.setFlag(CF, carry);
        return r;
      case "sar":
        for (let n = 0; n < count; n++) {
          carry = (r & 1) !== 0;
          r = (r >> 1) | (r & top(width));
        }
        this.logicFlags(r, width);
        this.setFlag(CF, carry);
        return r;
      case "rol":
        for (let n = 0; n < count; n++) {
          const out = (r & top(width)) !== 0;
          r = ((r << 1) & m) | (out ? 1 : 0);
        }
        this.setFlag(CF, (r & 1) !== 0);
        this.setFlag(OF, ((r & top(width)) !== 0) !== ((r & 1) !== 0));
        return r;
      case "ror":
        for (let n = 0; n < count; n++) {
          const out = r & 1;
          r = (r >> 1) | (out ? top(width) : 0);
        }
        this.setFlag(CF, (r & top(width)) !== 0);
        this.setFlag(OF, ((r & top(width)) !== 0) !== ((r & (top(width) >> 1)) !== 0));
        return r;
      case "rcl":
        for (let n = 0; n < count % (bits + 1); n++) {
          const out = (r & top(width)) !== 0;
          r = ((r << 1) & m) | (carry ? 1 : 0);
          carry = out;
        }
        this.setFlag(CF, carry);
        this.setFlag(OF, ((r & top(width)) !== 0) !== carry);
        return r;
      case "rcr":
        this.setFlag(OF, ((r & top(width)) !== 0) !== carry);
        for (let n = 0; n < count % (bits + 1); n++) {
          const out = (r & 1) !== 0;
          r = (r >> 1) | (carry ? top(width) : 0);
          carry = out;
        }
        this.setFlag(CF, carry);
        return r;
    }
    throw new Error(`unknown shift ${mnemonic}`);
  }

  /** Raises an interrupt: the hook first, then the interrupt table. */
  interrupt(vector: number, returnIp: number): void {
    this.ip = returnIp;
    if (this.hooks.interrupt?.(this, vector)) return;
    const offset = this.read16(0, vector * 4),
      segment = this.read16(0, vector * 4 + 2);
    if (offset === 0 && segment === 0)
      throw new CpuStop(`interrupt ${vector.toString(16)} has no handler`, this.linear(this.cs, this.ip));
    this.push(this.flags);
    this.push(this.cs);
    this.push(this.ip);
    this.setFlag(IF, false);
    this.setFlag(TF, false);
    this.segs[1] = segment;
    this.ip = offset;
  }

  /** Runs one instruction (a whole `rep` string instruction counts as one). */
  step(): void {
    const i = this.fetch();
    this.current = i;
    this.steps++;
    const next = (this.ip + i.size) & 0xffff;
    const [a, b, c] = i.operands;
    const width = this.widthOf(a);
    this.ip = next;
    switch (i.mnemonic) {
      case "nop":
      case "wait":
      case "lock":
        return;
      case "mov":
        this.set(a!, this.get(b!, width));
        return;
      case "xchg": {
        const x = this.get(a!, width),
          y = this.get(b!, width);
        this.set(a!, y);
        this.set(b!, x);
        return;
      }
      case "lea":
        this.set(a!, this.offsetOf(b as Extract<Operand, { kind: "memory" }>));
        return;
      case "les":
      case "lds": {
        const m = b as Extract<Operand, { kind: "memory" }>;
        const segment = this.segmentOf(m),
          offset = this.offsetOf(m);
        this.set(a!, this.read16(segment, offset));
        this.setRegister(i.mnemonic === "les" ? "es" : "ds", this.read16(segment, offset + 2));
        return;
      }
      case "push":
        this.push(this.get(a!, 16));
        return;
      case "pop":
        this.set(a!, this.pop());
        return;
      case "pusha": {
        const sp = this.regs[4]!;
        for (let n = 0; n < 8; n++) this.push(n === 4 ? sp : this.regs[n]!);
        return;
      }
      case "popa":
        for (let n = 7; n >= 0; n--) {
          const value = this.pop();
          if (n !== 4) this.regs[n] = value;
        }
        return;
      case "pushf":
        this.push(this.flags);
        return;
      case "popf":
        this.flags = (this.pop() & 0x0fd5) | 0x0002;
        return;
      case "lahf":
        this.setRegister("ah", (this.flags & 0xd5) | 0x02);
        return;
      case "sahf":
        this.flags = (this.flags & ~0xd5) | (this.register("ah") & 0xd5);
        return;
      case "cbw":
        this.regs[0] = signed(this.regs[0]! & 0xff, 8) & 0xffff;
        return;
      case "cwd":
        this.regs[2] = this.regs[0]! & 0x8000 ? 0xffff : 0;
        return;
      case "add":
      case "adc":
        this.set(
          a!,
          this.add(this.get(a!, width), this.get(b!, width), width, i.mnemonic === "adc" && this.flag(CF) ? 1 : 0),
        );
        return;
      case "sub":
      case "sbb":
        this.set(
          a!,
          this.sub(this.get(a!, width), this.get(b!, width), width, i.mnemonic === "sbb" && this.flag(CF) ? 1 : 0),
        );
        return;
      case "cmp":
        this.sub(this.get(a!, width), this.get(b!, width), width);
        return;
      case "and":
        this.set(a!, this.logicFlags(this.get(a!, width) & this.get(b!, width), width));
        return;
      case "or":
        this.set(a!, this.logicFlags(this.get(a!, width) | this.get(b!, width), width));
        return;
      case "xor":
        this.set(a!, this.logicFlags(this.get(a!, width) ^ this.get(b!, width), width));
        return;
      case "test":
        this.logicFlags(this.get(a!, width) & this.get(b!, width), width);
        return;
      case "inc":
      case "dec": {
        const carry = this.flag(CF);
        this.set(
          a!,
          i.mnemonic === "inc" ? this.add(this.get(a!, width), 1, width) : this.sub(this.get(a!, width), 1, width),
        );
        this.setFlag(CF, carry);
        return;
      }
      case "neg": {
        const value = this.get(a!, width);
        this.set(a!, this.sub(0, value, width));
        this.setFlag(CF, value !== 0);
        return;
      }
      case "not":
        this.set(a!, ~this.get(a!, width) & mask(width));
        return;
      case "shl":
      case "sal":
      case "shr":
      case "sar":
      case "rol":
      case "ror":
      case "rcl":
      case "rcr":
        this.set(a!, this.shift(i.mnemonic, this.get(a!, width), this.get(b!, 8), width));
        return;
      case "mul":
      case "imul": {
        if (c) {
          // imul r16, r/m16, imm
          const product = signed(this.get(b!, 16), 16) * signed(this.get(c, 16), 16);
          this.set(a!, product & 0xffff);
          const fits = product === signed(product & 0xffff, 16);
          this.setFlag(CF, !fits);
          this.setFlag(OF, !fits);
          return;
        }
        const isSigned = i.mnemonic === "imul";
        if (width === 8) {
          const x = this.regs[0]! & 0xff,
            y = this.get(a!, 8);
          const product = isSigned ? signed(x, 8) * signed(y, 8) : x * y;
          this.regs[0] = product & 0xffff;
          const fits = isSigned ? product === signed(product & 0xff, 8) : product < 0x100;
          this.setFlag(CF, !fits);
          this.setFlag(OF, !fits);
        } else {
          const x = this.regs[0]!,
            y = this.get(a!, 16);
          const product = isSigned ? signed(x, 16) * signed(y, 16) : x * y;
          this.regs[0] = product & 0xffff;
          this.regs[2] = Math.floor(product / 0x10000) & 0xffff;
          const fits = isSigned ? product === signed(product & 0xffff, 16) : product < 0x10000;
          this.setFlag(CF, !fits);
          this.setFlag(OF, !fits);
        }
        return;
      }
      case "div":
      case "idiv": {
        const isSigned = i.mnemonic === "idiv";
        const divisor = this.get(a!, width);
        const fail = () => {
          throw new CpuStop("division overflow", i.address);
        };
        if (divisor === 0) fail();
        if (width === 8) {
          const dividend = isSigned ? signed(this.regs[0]!, 16) : this.regs[0]!;
          const d = isSigned ? signed(divisor, 8) : divisor;
          const quotient = Math.trunc(dividend / d),
            remainder = dividend - quotient * d;
          if (isSigned ? quotient < -128 || quotient > 127 : quotient > 0xff) fail();
          this.regs[0] = ((remainder & 0xff) << 8) | (quotient & 0xff);
        } else {
          const high = this.regs[2]!,
            low = this.regs[0]!;
          const dividend = isSigned ? signed(high, 16) * 0x10000 + low : high * 0x10000 + low;
          const d = isSigned ? signed(divisor, 16) : divisor;
          const quotient = Math.trunc(dividend / d),
            remainder = dividend - quotient * d;
          if (isSigned ? quotient < -32768 || quotient > 32767 : quotient > 0xffff) fail();
          this.regs[0] = quotient & 0xffff;
          this.regs[2] = remainder & 0xffff;
        }
        return;
      }
      case "daa": {
        let al = this.regs[0]! & 0xff;
        const carry = this.flag(CF);
        let cf = false;
        if ((al & 0x0f) > 9 || this.flag(AF)) {
          al += 6;
          this.setFlag(AF, true);
        } else this.setFlag(AF, false);
        if ((al & 0x1ff) > 0x9f || carry) {
          al += 0x60;
          cf = true;
        }
        const af = this.flag(AF);
        this.setRegister("al", al);
        this.logicFlags(al & 0xff, 8);
        this.setFlag(AF, af);
        this.setFlag(CF, cf);
        return;
      }
      case "das": {
        const old = this.regs[0]! & 0xff;
        const carry = this.flag(CF);
        let al = old;
        let cf = false;
        if ((al & 0x0f) > 9 || this.flag(AF)) {
          cf = carry || al < 6;
          al = (al - 6) & 0xff;
          this.setFlag(AF, true);
        } else this.setFlag(AF, false);
        if (old > 0x99 || carry) {
          al = (al - 0x60) & 0xff;
          cf = true;
        }
        const af = this.flag(AF);
        this.setRegister("al", al);
        this.logicFlags(al, 8);
        this.setFlag(AF, af);
        this.setFlag(CF, cf);
        return;
      }
      case "aas": {
        let ax = this.regs[0]!;
        if ((ax & 0x0f) > 9 || this.flag(AF)) {
          ax = (ax - 6) & 0xffff;
          ax = (ax & 0x00ff) | ((((ax >> 8) - 1) & 0xff) << 8);
          this.setFlag(AF, true);
          this.setFlag(CF, true);
        } else {
          this.setFlag(AF, false);
          this.setFlag(CF, false);
        }
        this.regs[0] = ax & 0xff0f;
        return;
      }
      case "aaa": {
        let ax = this.regs[0]!;
        if ((ax & 0x0f) > 9 || this.flag(AF)) {
          ax = (ax + 0x106) & 0xffff;
          this.setFlag(AF, true);
          this.setFlag(CF, true);
        } else {
          this.setFlag(AF, false);
          this.setFlag(CF, false);
        }
        this.regs[0] = ax & 0xff0f;
        return;
      }
      case "aam": {
        const base = this.get(a!, 8);
        if (base === 0) throw new CpuStop("division overflow", i.address);
        const al = this.regs[0]! & 0xff;
        this.regs[0] = (Math.floor(al / base) << 8) | (al % base);
        this.logicFlags(al % base, 8);
        return;
      }
      case "aad": {
        const base = this.get(a!, 8);
        const al = ((this.regs[0]! >> 8) * base + (this.regs[0]! & 0xff)) & 0xff;
        this.regs[0] = al;
        this.logicFlags(al, 8);
        return;
      }
      case "clc":
        this.setFlag(CF, false);
        return;
      case "stc":
        this.setFlag(CF, true);
        return;
      case "cmc":
        this.setFlag(CF, !this.flag(CF));
        return;
      case "cld":
        this.setFlag(DF, false);
        return;
      case "std":
        this.setFlag(DF, true);
        return;
      case "cli":
        this.setFlag(IF, false);
        return;
      case "sti":
        this.setFlag(IF, true);
        return;
      case "xlat":
        this.setRegister(
          "al",
          this.read8(this.register(i.segmentOverride ?? "ds"), this.regs[3]! + (this.regs[0]! & 0xff)),
        );
        return;
      case "in":
        this.set(a!, this.hooks.portIn?.(this, this.get(b!, 16), this.widthOf(a)) ?? mask(this.widthOf(a)));
        return;
      case "out":
        this.hooks.portOut?.(this, this.get(a!, 16), this.get(b!, this.widthOf(b)), this.widthOf(b));
        return;
      case "int":
        this.interrupt(this.get(a!, 8), next);
        return;
      case "into":
        if (this.flag(OF)) this.interrupt(4, next);
        return;
      case "iret":
        this.ip = this.pop();
        this.segs[1] = this.pop();
        this.flags = (this.pop() & 0x0fd5) | 0x0002;
        return;
      case "hlt":
        throw new CpuStop("halted", i.address);
      case "bound": {
        const m = b as Extract<Operand, { kind: "memory" }>;
        const segment = this.segmentOf(m),
          offset = this.offsetOf(m);
        const value = signed(this.get(a!, 16), 16);
        if (value < signed(this.read16(segment, offset), 16) || value > signed(this.read16(segment, offset + 2), 16))
          this.interrupt(5, i.offset);
        return;
      }
      case "enter": {
        const size = this.get(a!, 16),
          level = this.get(b!, 8) & 0x1f;
        this.push(this.regs[5]!);
        const frame = this.regs[4]!;
        for (let n = 1; n < level; n++) {
          this.regs[5] = this.regs[5]! - 2;
          this.push(this.read16(this.ss, this.regs[5]!));
        }
        if (level) this.push(frame);
        this.regs[5] = frame;
        this.regs[4] = this.regs[4]! - size;
        return;
      }
      case "leave":
        this.regs[4] = this.regs[5]!;
        this.regs[5] = this.pop();
        return;
      case "jmp":
        this.jump(i, a!, false);
        return;
      case "call":
        this.jump(i, a!, true);
        return;
      case "ret":
        this.ip = this.pop();
        if (a) this.regs[4] = this.regs[4]! + this.get(a, 16);
        return;
      case "retf":
        this.ip = this.pop();
        this.segs[1] = this.pop();
        if (a) this.regs[4] = this.regs[4]! + this.get(a, 16);
        return;
      case "loop":
      case "loope":
      case "loopne": {
        this.regs[1] = this.regs[1]! - 1;
        const more =
          this.regs[1] !== 0 && (i.mnemonic === "loop" || (i.mnemonic === "loope" ? this.flag(ZF) : !this.flag(ZF)));
        if (more) this.ip = i.target!.offset;
        return;
      }
      case "jcxz":
        if (this.regs[1] === 0) this.ip = i.target!.offset;
        return;
      case "movsb":
      case "movsw":
      case "stosb":
      case "stosw":
      case "lodsb":
      case "lodsw":
      case "scasb":
      case "scasw":
      case "cmpsb":
      case "cmpsw":
      case "insb":
      case "insw":
      case "outsb":
      case "outsw":
        this.string(i);
        return;
    }
    if (i.flow === "branch") {
      if (this.condition(i.mnemonic)) this.ip = i.target!.offset;
      return;
    }
    throw new CpuStop(`can't run ${i.text}`, i.address);
  }

  private jump(i: Instruction, target: Operand, call: boolean): void {
    let segment = this.cs,
      offset: number;
    if (target.kind === "address") {
      segment = target.segment;
      offset = target.offset;
    } else if (i.far) {
      const m = target as Extract<Operand, { kind: "memory" }>;
      const s = this.segmentOf(m),
        o = this.offsetOf(m);
      offset = this.read16(s, o);
      segment = this.read16(s, o + 2);
    } else offset = this.get(target, 16);
    if (call) {
      if (i.far) this.push(this.cs);
      this.push(this.ip);
    }
    this.segs[1] = segment;
    this.ip = offset;
  }

  private string(i: Instruction): void {
    const width = i.mnemonic.endsWith("w") ? 16 : 8;
    const size = width / 8;
    const step = this.flag(DF) ? -size : size;
    const source = this.register(i.segmentOverride ?? "ds");
    const repeat = i.prefixes.includes("rep") ? "rep" : i.prefixes.includes("repne") ? "repne" : undefined;
    const kind = i.mnemonic.slice(0, -1);
    const compares = kind === "scas" || kind === "cmps";
    for (;;) {
      if (repeat && this.regs[1] === 0) return;
      const si = this.regs[6]!,
        di = this.regs[7]!;
      const readSource = () => (width === 8 ? this.read8(source, si) : this.read16(source, si));
      const readTarget = () => (width === 8 ? this.read8(this.es, di) : this.read16(this.es, di));
      const writeTarget = (value: number) =>
        width === 8 ? this.write8(this.es, di, value) : this.write16(this.es, di, value);
      const accumulator = width === 8 ? this.regs[0]! & 0xff : this.regs[0]!;
      switch (kind) {
        case "movs":
          writeTarget(readSource());
          this.regs[6] = si + step;
          this.regs[7] = di + step;
          break;
        case "stos":
          writeTarget(accumulator);
          this.regs[7] = di + step;
          break;
        case "lods":
          if (width === 8) this.setRegister("al", readSource());
          else this.regs[0] = readSource();
          this.regs[6] = si + step;
          break;
        case "scas":
          this.sub(accumulator, readTarget(), width);
          this.regs[7] = di + step;
          break;
        case "cmps":
          this.sub(readSource(), readTarget(), width);
          this.regs[6] = si + step;
          this.regs[7] = di + step;
          break;
        case "ins":
          writeTarget(this.hooks.portIn?.(this, this.regs[2]!, width as 8 | 16) ?? mask(width));
          this.regs[7] = di + step;
          break;
        case "outs":
          this.hooks.portOut?.(this, this.regs[2]!, readSource(), width as 8 | 16);
          this.regs[6] = si + step;
          break;
      }
      if (!repeat) return;
      this.regs[1] = this.regs[1]! - 1;
      if (compares && (repeat === "rep" ? !this.flag(ZF) : this.flag(ZF))) return;
    }
  }
}
