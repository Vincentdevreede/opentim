/**
 * Instruction cases for checking the processor against DOSBox: each case sets registers, flags and a 16-byte memory
 * window, runs a few bytes of code and saves the registers, flags and window. `cpuCasePrograms` packs them into COM
 * programs that write their results to R<n>.BIN; `scripts/record-cpu-cases.ts` runs them in DOSBox, and the test runs
 * them in the processor and compares. Flags an instruction leaves undefined are not compared.
 */
export interface CpuCase {
  name: string;
  bytes: number[];
  /** ax, cx, dx, bx, sp (not set), bp, si, di. */
  regs: number[];
  flags: number;
  mem: number[];
  /** Flags whose value the instruction leaves undefined. */
  undefined: number;
}
/** Bytes each case saves: eight registers, the flags and the memory window. */
export const RESULT = 34;
/** The seed the recorded DOSBox results in `dosbox-cpu` were made with. */
export const CPU_CASE_SEED = 7;

export function cpuCasePrograms(start: number): {
  cases: CpuCase[];
  programs: { name: string; bytes: Uint8Array; cases: number[] }[];
} {
  let seed = start;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed;
  };
  const pick = <T>(items: T[]) => items[rand() % items.length]!;
  const word = () => {
    const r = rand() % 10;
    if (r === 0) return pick([0, 1, 0x7fff, 0x8000, 0xffff, 0x00ff, 0xff00, 0x7f, 0x80]);
    return rand() & 0xffff;
  };
  const byte = () => (rand() % 6 === 0 ? pick([0, 1, 0x7f, 0x80, 0xff, 0x0f, 0x10]) : rand() & 0xff);

  const DATA = 0xf000; // 16 bytes the memory forms address, through bx = DATA, si = 2
  const CF = 1,
    PF = 4,
    AF = 0x10,
    ZF = 0x40,
    SF = 0x80,
    OF = 0x800;
  const cases: CpuCase[] = [];
  const add = (name: string, bytes: number[], undefinedFlags = 0, setup: Partial<CpuCase> = {}) => {
    const regs = [word(), word(), word(), DATA, 0, word(), 2, 4];
    const c: CpuCase = {
      name,
      bytes,
      regs,
      flags: (rand() & (CF | PF | AF | ZF | SF | OF)) | 0x0200,
      mem: Array.from({ length: 16 }, byte),
      undefined: undefinedFlags,
      ...setup,
    };
    if (setup.regs) c.regs = setup.regs.map((r, k) => (r < 0 ? regs[k]! : r));
    cases.push(c);
  };
  const ALU = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
  // modrm: register-register forms with all register pairs, and the memory form [bx+si+disp8].
  const regRm = () => 0xc0 | ((rand() % 8) << 3) | pick([0, 1, 2, 5, 6, 7]);
  const memRm = (reg: number) => [0x40 | (reg << 3), rand() % 8];
  for (let n = 0; n < 6; n++)
    for (let op = 0; op < 8; op++) {
      const logic = op === 1 || op === 4 || op === 6 ? AF : 0;
      for (const w of [0, 1]) {
        add(`${ALU[op]} r/m,r w${w}`, [(op << 3) | w, regRm()], logic);
        add(`${ALU[op]} r,r/m w${w}`, [(op << 3) | 2 | w, regRm()], logic);
        add(`${ALU[op]} [m],r w${w}`, [(op << 3) | w, ...memRm(rand() % 8)], logic);
        add(`${ALU[op]} acc,imm w${w}`, [(op << 3) | 4 | w, byte(), ...(w ? [byte()] : [])], logic);
      }
      add(`${ALU[op]} r/m,imm8 (80)`, [0x80, 0xc0 | (op << 3) | (rand() % 8), byte()], logic);
      add(`${ALU[op]} r/m,imm16 (81)`, [0x81, 0xc0 | (op << 3) | pick([0, 1, 2, 5, 6, 7]), byte(), byte()], logic);
      add(`${ALU[op]} r/m,simm8 (83)`, [0x83, 0xc0 | (op << 3) | pick([0, 1, 2, 5, 6, 7]), byte()], logic);
      add(`${ALU[op]} [m],imm (81)`, [0x81, 0x40 | (op << 3), rand() % 8, byte(), byte()], logic);
    }
  for (let n = 0; n < 8; n++) {
    for (const r of [0, 1, 2, 5]) {
      add("inc r16", [0x40 | r]);
      add("dec r16", [0x48 | r]);
    }
    add("inc r8", [0xfe, 0xc0 | (rand() % 8)]);
    add("dec r8", [0xfe, 0xc8 | (rand() % 8)]);
    for (const w of [0, 1]) {
      add(`test w${w}`, [0x84 | w, regRm()], AF);
      add(`not w${w}`, [0xf6 | w, 0xd0 | pick([0, 1, 2, 5])]);
      add(`neg w${w}`, [0xf6 | w, 0xd8 | pick([0, 1, 2, 5])]);
      add(`mul w${w}`, [0xf6 | w, 0xe0 | pick([1, 2, 3, 5])], SF | ZF | AF | PF);
      add(`imul w${w}`, [0xf6 | w, 0xe8 | pick([1, 2, 3, 5])], SF | ZF | AF | PF);
      add(`xchg w${w}`, [0x86 | w, regRm()]);
      add(`mov w${w}`, [0x88 | w, regRm()]);
      add(`mov [m] w${w}`, [0x8a | w, ...memRm(rand() % 8)]);
    }
    add("imul r,rm,imm8", [0x6b, 0xc0 | (pick([0, 1, 2, 5]) << 3) | pick([0, 1, 2, 5]), byte()], SF | ZF | AF | PF);
    add(
      "imul r,rm,imm16",
      [0x69, 0xc0 | (pick([0, 1, 2, 5]) << 3) | pick([0, 1, 2, 5]), byte(), byte()],
      SF | ZF | AF | PF,
    );
    add("cbw", [0x98]);
    add("cwd", [0x99]);
    add("lahf", [0x9f]);
    add("sahf", [0x9e]);
    add("cmc", [0xf5]);
    add("daa", [0x27], OF);
    add("das", [0x2f], OF);
    add("aaa", [0x37], OF | SF | ZF | PF);
    add("aas", [0x3f], OF | SF | ZF | PF);
    add("aam", [0xd4, 0x0a], OF | AF | CF);
    add("aad", [0xd5, 0x0a], OF | AF | CF);
    add("lea", [0x8d, 0x40 | (pick([0, 1, 2, 5]) << 3) | (rand() % 8), rand() & 0xff]);
    add("xlat", [0xd7], 0, { regs: [-1, -1, -1, DATA, 0, -1, 2, 4].map((v, k) => (k === 0 ? rand() % 16 : v)) });
  }
  // Division without overflow: the quotient and remainder are chosen first, the remainder with the dividend's sign.
  const signedDivision = (limit: number, divisorLimit: number) => {
    const divisor = ((rand() % (2 * divisorLimit)) - divisorLimit) | 0 || 3;
    const quotient = (rand() % (2 * limit + 1)) - limit;
    const product = quotient * divisor;
    const size = rand() % Math.abs(divisor);
    const remainder = product < 0 ? -size : product > 0 ? size : rand() % 2 ? size : -size;
    return { dividend: product + remainder, divisor };
  };
  for (let n = 0; n < 24; n++) {
    const divisor = (word() | 1) & 0xffff;
    const quotient = rand() & 0xffff;
    const value = quotient * divisor + (rand() % divisor);
    add("div w1", [0xf7, 0xf1], 0x8d5, {
      regs: [value & 0xffff, divisor, Math.floor(value / 0x10000) & 0xffff, DATA, 0, -1, 2, 4],
    });
    const s16 = signedDivision(32000, 30000);
    add("idiv w1", [0xf7, 0xf9], 0x8d5, {
      regs: [
        s16.dividend & 0xffff,
        s16.divisor & 0xffff,
        Math.floor(s16.dividend / 0x10000) & 0xffff,
        DATA,
        0,
        -1,
        2,
        4,
      ],
    });
    const d8 = (byte() | 1) & 0xff;
    const v8 = (rand() % 256) * d8 + (rand() % d8);
    add("div w0", [0xf6, 0xf1], 0x8d5, { regs: [v8 & 0xffff, d8, -1, DATA, 0, -1, 2, 4] });
    const s8 = signedDivision(120, 120);
    add("idiv w0", [0xf6, 0xf9], 0x8d5, { regs: [s8.dividend & 0xffff, s8.divisor & 0xff, -1, DATA, 0, -1, 2, 4] });
  }
  // Shifts and rotates: by 1, by CL and by an immediate count.
  const SHIFT = ["rol", "ror", "rcl", "rcr", "shl", "shr", "sal", "sar"];
  for (let n = 0; n < 5; n++)
    for (let op = 0; op < 8; op++) {
      if (op === 6) continue;
      const rotate = op < 4;
      for (const w of [0, 1]) {
        const count = pick([1, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 0]);
        const und = (c: number) => (c === 1 ? 0 : OF) | (rotate ? 0 : AF);
        add(`${SHIFT[op]} 1 w${w}`, [0xd0 | w, 0xc0 | (op << 3) | pick([0, 2, 3, 5])], rotate ? 0 : AF);
        add(`${SHIFT[op]} cl w${w}`, [0xd2 | w, 0xc0 | (op << 3) | pick([0, 2, 3, 5])], und(count), {
          regs: [-1, count, -1, DATA, 0, -1, 2, 4],
        });
        add(`${SHIFT[op]} imm w${w}`, [0xc0 | w, 0xc0 | (op << 3) | pick([0, 2, 3, 5]), count], und(count));
      }
    }
  // Conditional jumps: dl says whether the jump was taken.
  const CONDITIONS = [
    "jo",
    "jno",
    "jb",
    "jae",
    "je",
    "jne",
    "jbe",
    "ja",
    "js",
    "jns",
    "jp",
    "jnp",
    "jl",
    "jge",
    "jle",
    "jg",
  ];
  for (let n = 0; n < 6; n++)
    for (let cc = 0; cc < 16; cc++) {
      // mov dl, 0; jcc +2; mov dl, 1  -> dl = 0 when taken
      add(CONDITIONS[cc]!, [0xb2, 0x00, 0x70 | cc, 0x02, 0xb2, 0x01]);
    }
  for (let n = 0; n < 6; n++) {
    add("loop", [0xb2, 0x00, 0xe2, 0x02, 0xb2, 0x01], 0, { regs: [-1, pick([0, 1, 2, 5]), -1, DATA, 0, -1, 2, 4] });
    add("jcxz", [0xb2, 0x00, 0xe3, 0x02, 0xb2, 0x01], 0, { regs: [-1, pick([0, 1, 2]), -1, DATA, 0, -1, 2, 4] });
  }
  // String instructions over the data window: si = DATA, di = DATA + 8, with cx small; es = ds.
  const STRINGS: [string, number][] = [
    ["movsb", 0xa4],
    ["movsw", 0xa5],
    ["stosb", 0xaa],
    ["stosw", 0xab],
    ["lodsb", 0xac],
    ["lodsw", 0xad],
    ["scasb", 0xae],
    ["cmpsb", 0xa6],
  ];
  for (let n = 0; n < 4; n++)
    for (const [name, op] of STRINGS) {
      add(name, [op], 0, { regs: [-1, -1, -1, DATA, 0, -1, DATA, DATA + 8] });
      add(`rep ${name}`, [0xf3, op], 0, { regs: [-1, pick([0, 1, 3]), -1, DATA, 0, -1, DATA, DATA + 8] });
      if (op === 0xa6 || op === 0xae)
        add(`repne ${name}`, [0xf2, op], 0, { regs: [-1, pick([1, 3, 4]), -1, DATA, 0, -1, DATA, DATA + 8] });
    }

  // Stack, calls and segments; each case leaves the stack and the segment registers as it found them.
  for (let n = 0; n < 6; n++) {
    add("pusha popa", [0x60, 0x61]);
    add("pusha pops", [0x60, 0x58, 0x59, 0x5a, 0x5b, 0x5d, 0x5d, 0x5e, 0x5f]);
    add("push imm pop", [0x68, byte(), byte(), 0x5b]);
    add("push simm8 pop", [0x6a, byte(), 0x5a]);
    add("push [m] pop [m]", [0xff, 0x70, rand() % 6, 0x8f, 0x40, rand() % 6]);
    add("call ret", [0xe8, 0x02, 0x00, 0xeb, 0x02, 0x40, 0xc3]);
    add("call ret imm", [0x68, byte(), byte(), 0xe8, 0x02, 0x00, 0xeb, 0x04, 0x40, 0xc2, 0x02, 0x00]);
    add("call far retf", [0x0e, 0xe8, 0x02, 0x00, 0xeb, 0x02, 0x41, 0xcb]);
    add("enter leave", [0xc8, rand() % 16, 0x00, 0x00, 0x89, 0xe0, 0xc9]);
    add("enter 1 leave", [0xc8, 0x04, 0x00, 0x01, 0x89, 0xe0, 0x8b, 0x4e, 0xfe, 0xc9]);
    add("les", [0xc4, 0x40 | (pick([0, 1, 2]) << 3), rand() % 8, 0x8c, 0xc5, 0x0e, 0x07]);
    add("es: mov", [0x26, 0x8b, 0x40 | (pick([0, 1, 2, 5]) << 3), rand() % 8]);
    add("cs: add", [0x2e, 0x03, 0x40 | (pick([0, 1, 2, 5]) << 3), rand() % 8]);
    add("xchg [m]", [0x87, 0x40 | (pick([0, 1, 2, 5]) << 3), rand() % 8]);
    add("loope", [0xb2, 0x00, 0xe1, 0x02, 0xb2, 0x01], 0, { regs: [-1, pick([1, 2, 5]), -1, DATA, 0, -1, 2, 4] });
    add("loopne", [0xb2, 0x00, 0xe0, 0x02, 0xb2, 0x01], 0, { regs: [-1, pick([1, 2, 5]), -1, DATA, 0, -1, 2, 4] });
    add("jmp near", [0xe9, 0x01, 0x00, 0x40, 0x41]);
    add("jmp [r]", [0xbb, 0, 0, 0xe8, 0x00, 0x00, 0x5b, 0x83, 0xc3, 0x07, 0xff, 0xe3, 0x40, 0x41], 0);
    for (const [name, op] of STRINGS)
      add(`std rep ${name}`, [0xfd, 0xf3, op, 0xfc], 0, {
        regs: [-1, pick([1, 2, 3]), -1, DATA, 0, -1, DATA + 6, DATA + 14],
      });
  }
  // Each case's code: set the memory window, the registers and the flags, run the bytes, save the results.
  const PER_FILE = 220;
  const programs: { name: string; bytes: Uint8Array; cases: number[] }[] = [];
  for (let first = 0; first < cases.length; first += PER_FILE) {
    const code: number[] = [];
    const chunk = cases.slice(first, first + PER_FILE);
    const results = 0xc000; // result buffer, below the data window
    const w = (v: number) => [v & 0xff, (v >> 8) & 0xff];
    chunk.forEach((c, k) => {
      for (let b = 0; b < 16; b += 2) code.push(0xc7, 0x06, ...w(DATA + b), c.mem[b]!, c.mem[b + 1]!);
      const order = [0, 1, 2, 3, 5, 6, 7];
      for (const r of order) code.push(0xb8 | r, ...w(c.regs[r]!));
      code.push(0x68, ...w(c.flags), 0x9d);
      code.push(...c.bytes);
      const save = results + k * RESULT;
      code.push(0x9c); // pushf
      code.push(0xa3, ...w(save)); // mov [save], ax
      for (const r of [1, 2, 3, 4, 5, 6, 7]) code.push(0x89, 0x06 | (r << 3), ...w(save + r * 2));
      code.push(0x8f, 0x06, ...w(save + 16)); // pop [save+16] (flags)
      for (let b = 0; b < 16; b += 2) code.push(0xa1, ...w(DATA + b), 0xa3, ...w(save + 18 + b));
    });
    // Write the results to OUT.BIN: create, write, close, exit.
    code.push(0xb4, 0x3c, 0x31, 0xc9, 0xba, ...w(0)); // dx patched below
    const nameAt = code.length - 2;
    code.push(0xcd, 0x21, 0x89, 0xc3, 0xb4, 0x40, 0xb9, ...w(chunk.length * RESULT), 0xba, ...w(results), 0xcd, 0x21);
    code.push(0xb4, 0x3e, 0xcd, 0x21, 0xcd, 0x20);
    const fileName = `R${programs.length}.BIN`;
    const at = 0x100 + code.length;
    code[nameAt] = at & 0xff;
    code[nameAt + 1] = at >> 8;
    for (const ch of fileName) code.push(ch.charCodeAt(0));
    code.push(0);
    if (0x100 + code.length >= results) throw new Error(`program ${programs.length} too long: ${code.length}`);
    programs.push({
      name: `T${programs.length}.COM`,
      bytes: Uint8Array.from(code),
      cases: chunk.map((_, k) => first + k),
    });
  }
  return { cases, programs };
}
