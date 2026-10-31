/**
 * Decodes the 16-bit x86 instructions used by the original programs. This reads bytes only: it does not execute
 * instructions or supply a processor or game object. Addresses are relative to the unpacked load image.
 */

export interface CodeAddress {
  segment: number;
  offset: number;
  address: number;
}

export type Operand =
  | { kind: "register"; name: string; width: 8 | 16 }
  | { kind: "immediate"; value: number; width: 8 | 16 }
  | { kind: "memory"; width: 8 | 16 | 32; segment: string; base: string[]; displacement: number; direct: boolean }
  | ({ kind: "address" } & CodeAddress);

export interface Instruction extends CodeAddress {
  size: number;
  bytes: number[];
  mnemonic: string;
  operands: Operand[];
  text: string;
  prefixes: string[];
  segmentOverride?: string;
  flow: "next" | "call" | "jump" | "branch" | "return" | "stop";
  target?: CodeAddress;
  far?: boolean;
}

const WORD_REGISTERS = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
const BYTE_REGISTERS = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];
const SEGMENT_REGISTERS = ["es", "cs", "ss", "ds"];
const BASES = [["bx", "si"], ["bx", "di"], ["bp", "si"], ["bp", "di"], ["si"], ["di"], ["bp"], ["bx"]];
const ARITHMETIC = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
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
const SHIFTS = ["rol", "ror", "rcl", "rcr", "shl", "shr", "sal", "sar"];
const hex = (value: number, width = 4) => `0x${value.toString(16).padStart(width, "0")}`;
const signed8 = (value: number) => (value & 0x80 ? value - 0x100 : value);
const signed16 = (value: number) => (value & 0x8000 ? value - 0x10000 : value);

function register(index: number, width: 8 | 16): Operand {
  return { kind: "register", name: (width === 8 ? BYTE_REGISTERS : WORD_REGISTERS)[index]!, width };
}

function segmentRegister(index: number): Operand {
  return { kind: "register", name: SEGMENT_REGISTERS[index]!, width: 16 };
}

/** Formats an operand without discarding its width or effective segment. */
export function operandText(operand: Operand): string {
  switch (operand.kind) {
    case "register":
      return operand.name;
    case "immediate":
      return operand.value < 0 ? `-${hex(-operand.value, operand.width / 4)}` : hex(operand.value, operand.width / 4);
    case "address":
      return `${hex(operand.segment)}:${hex(operand.offset)}`;
    case "memory": {
      let inside = operand.base.join("+");
      if (operand.direct || operand.displacement !== 0) {
        if (inside && operand.displacement >= 0) inside += "+";
        inside += operand.displacement < 0 ? `-${hex(-operand.displacement, 2)}` : hex(operand.displacement, 2);
      }
      const defaultSegment = operand.base.includes("bp") ? "ss" : "ds";
      const segment = operand.segment === defaultSegment ? "" : `${operand.segment}:`;
      return `${operand.width === 8 ? "byte" : operand.width === 16 ? "word" : "dword"} ${segment}[${inside}]`;
    }
  }
}

/**
 * Decodes one instruction at an image address in the given code segment. Relative destinations wrap within that
 * segment. Unsupported or invalid encodings stop the caller with the address and bytes of the failing instruction.
 */
export function decodeInstruction(image: Uint8Array, address: number, segment = 0): Instruction {
  const offset = address - segment * 16;
  const bytes: number[] = [];
  const prefixes: string[] = [];
  let segmentOverride: string | undefined;
  let mnemonic = "";
  let operands: Operand[] = [];
  let flow: Instruction["flow"] = "next";
  let target: CodeAddress | undefined;
  let far: boolean | undefined;
  const fail = (reason: string): never => {
    throw new Error(
      `x86 at ${hex(address)} (${hex(segment)}:${hex(offset)}): ${reason}; bytes ${bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
  };
  if (!Number.isInteger(address) || offset < 0 || offset > 0xffff || segment < 0 || segment > 0xffff)
    fail("address is outside the selected 16-bit code segment");
  const u8 = (): number => {
    if (bytes.length >= 15) fail("instruction exceeds 15 bytes");
    const at = segment * 16 + ((offset + bytes.length) & 0xffff);
    const value = image[at];
    if (value === undefined) return fail(`truncated instruction at ${hex(at)}`);
    bytes.push(value);
    return value;
  };
  const u16 = () => u8() | (u8() << 8);
  const immediate = (width: 8 | 16): Operand => ({ kind: "immediate", value: width === 8 ? u8() : u16(), width });
  const memory = (width: 8 | 16 | 32, base: string[], displacement: number, direct = false): Operand => ({
    kind: "memory",
    width,
    segment: segmentOverride ?? (base.includes("bp") ? "ss" : "ds"),
    base,
    displacement,
    direct,
  });
  const modrm = (width: 8 | 16) => {
    const byte = u8();
    const mode = byte >> 6;
    const reg = (byte >> 3) & 7;
    const rm = byte & 7;
    let operand: Operand;
    if (mode === 3) operand = register(rm, width);
    else if (mode === 0 && rm === 6) operand = memory(width, [], u16(), true);
    else {
      const displacement = mode === 1 ? signed8(u8()) : mode === 2 ? signed16(u16()) : 0;
      operand = memory(width, [...BASES[rm]!], displacement);
    }
    return { reg, operand };
  };
  const relative = (width: 8 | 16) => {
    const displacement = width === 8 ? signed8(u8()) : signed16(u16());
    const destination = (offset + bytes.length + displacement) & 0xffff;
    target = { segment, offset: destination, address: segment * 16 + destination };
    operands = [{ kind: "address", ...target }];
  };
  const farAddress = () => {
    const destination = u16();
    const destinationSegment = u16();
    target = { segment: destinationSegment, offset: destination, address: destinationSegment * 16 + destination };
    operands = [{ kind: "address", ...target }];
    far = true;
  };
  let opcode = u8();
  while ([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3].includes(opcode)) {
    if (opcode === 0xf0) prefixes.push("lock");
    else if (opcode === 0xf2) prefixes.push("repne");
    else if (opcode === 0xf3) prefixes.push("rep");
    else segmentOverride = SEGMENT_REGISTERS[(opcode >> 3) & 3];
    opcode = u8();
  }
  if (opcode < 0x40 && (opcode & 7) <= 5) {
    mnemonic = ARITHMETIC[opcode >> 3]!;
    const width = opcode & 1 ? 16 : 8;
    if ((opcode & 7) <= 3) {
      const { reg, operand } = modrm(width);
      operands = opcode & 2 ? [register(reg, width), operand] : [operand, register(reg, width)];
    } else operands = [register(0, width), immediate(width)];
  } else if (opcode >= 0x40 && opcode <= 0x5f) {
    mnemonic = opcode < 0x48 ? "inc" : opcode < 0x50 ? "dec" : opcode < 0x58 ? "push" : "pop";
    operands = [register(opcode & 7, 16)];
  } else if (opcode >= 0x70 && opcode <= 0x7f) {
    mnemonic = CONDITIONS[opcode & 15]!;
    flow = "branch";
    relative(8);
  } else if (opcode >= 0x90 && opcode <= 0x97) {
    mnemonic = opcode === 0x90 ? "nop" : "xchg";
    if (opcode !== 0x90) operands = [register(0, 16), register(opcode & 7, 16)];
  } else if (opcode >= 0xb0 && opcode <= 0xbf) {
    mnemonic = "mov";
    const width = opcode < 0xb8 ? 8 : 16;
    operands = [register(opcode & 7, width), immediate(width)];
  } else {
    switch (opcode) {
      case 0x06:
      case 0x0e:
      case 0x16:
      case 0x1e:
        mnemonic = "push";
        operands = [segmentRegister(opcode >> 3)];
        break;
      case 0x07:
      case 0x17:
      case 0x1f:
        mnemonic = "pop";
        operands = [segmentRegister(opcode >> 3)];
        break;
      case 0x27:
        mnemonic = "daa";
        break;
      case 0x2f:
        mnemonic = "das";
        break;
      case 0x37:
        mnemonic = "aaa";
        break;
      case 0x3f:
        mnemonic = "aas";
        break;
      case 0x60:
        mnemonic = "pusha";
        break;
      case 0x61:
        mnemonic = "popa";
        break;
      case 0x62: {
        mnemonic = "bound";
        const { reg, operand } = modrm(16);
        if (operand.kind !== "memory") return fail("BOUND requires a memory operand");
        operands = [register(reg, 16), { ...operand, width: 32 }];
        break;
      }
      case 0x68:
        mnemonic = "push";
        operands = [immediate(16)];
        break;
      case 0x6a:
        mnemonic = "push";
        operands = [{ kind: "immediate", value: signed8(u8()), width: 16 }];
        break;
      case 0x69:
      case 0x6b: {
        mnemonic = "imul";
        const { reg, operand } = modrm(16);
        operands = [
          register(reg, 16),
          operand,
          opcode === 0x69 ? immediate(16) : { kind: "immediate", value: signed8(u8()), width: 16 },
        ];
        break;
      }
      case 0x6c:
        mnemonic = "insb";
        break;
      case 0x6d:
        mnemonic = "insw";
        break;
      case 0x6e:
        mnemonic = "outsb";
        break;
      case 0x6f:
        mnemonic = "outsw";
        break;
      case 0x80:
      case 0x81:
      case 0x82:
      case 0x83: {
        const width = opcode === 0x80 || opcode === 0x82 ? 8 : 16;
        const { reg, operand } = modrm(width);
        mnemonic = ARITHMETIC[reg]!;
        operands = [
          operand,
          opcode === 0x83 ? { kind: "immediate", value: signed8(u8()), width: 16 } : immediate(width),
        ];
        break;
      }
      case 0x84:
      case 0x85:
      case 0x86:
      case 0x87:
      case 0x88:
      case 0x89:
      case 0x8a:
      case 0x8b: {
        const width = opcode & 1 ? 16 : 8;
        const { reg, operand } = modrm(width);
        mnemonic = opcode < 0x86 ? "test" : opcode < 0x88 ? "xchg" : "mov";
        operands = opcode >= 0x8a ? [register(reg, width), operand] : [operand, register(reg, width)];
        break;
      }
      case 0x8c:
      case 0x8e: {
        const { reg, operand } = modrm(16);
        if (reg > 3 || (opcode === 0x8e && reg === 1)) fail("invalid segment register encoding");
        mnemonic = "mov";
        operands = opcode === 0x8c ? [operand, segmentRegister(reg)] : [segmentRegister(reg), operand];
        break;
      }
      case 0x8d: {
        mnemonic = "lea";
        const { reg, operand } = modrm(16);
        if (operand.kind !== "memory") return fail("LEA requires a memory operand");
        operands = [register(reg, 16), operand];
        break;
      }
      case 0x8f: {
        mnemonic = "pop";
        const { reg, operand } = modrm(16);
        if (reg !== 0) fail("invalid POP group encoding");
        operands = [operand];
        break;
      }
      case 0x98:
        mnemonic = "cbw";
        break;
      case 0x99:
        mnemonic = "cwd";
        break;
      case 0x9a:
        mnemonic = "call";
        flow = "call";
        farAddress();
        break;
      case 0x9b:
        mnemonic = "wait";
        break;
      case 0x9c:
        mnemonic = "pushf";
        break;
      case 0x9d:
        mnemonic = "popf";
        break;
      case 0x9e:
        mnemonic = "sahf";
        break;
      case 0x9f:
        mnemonic = "lahf";
        break;
      case 0xa0:
      case 0xa1:
      case 0xa2:
      case 0xa3: {
        mnemonic = "mov";
        const width = opcode & 1 ? 16 : 8;
        const operand = memory(width, [], u16(), true);
        operands = opcode & 2 ? [operand, register(0, width)] : [register(0, width), operand];
        break;
      }
      case 0xa4:
        mnemonic = "movsb";
        break;
      case 0xa5:
        mnemonic = "movsw";
        break;
      case 0xa6:
        mnemonic = "cmpsb";
        break;
      case 0xa7:
        mnemonic = "cmpsw";
        break;
      case 0xa8:
      case 0xa9: {
        mnemonic = "test";
        const width = opcode & 1 ? 16 : 8;
        operands = [register(0, width), immediate(width)];
        break;
      }
      case 0xaa:
        mnemonic = "stosb";
        break;
      case 0xab:
        mnemonic = "stosw";
        break;
      case 0xac:
        mnemonic = "lodsb";
        break;
      case 0xad:
        mnemonic = "lodsw";
        break;
      case 0xae:
        mnemonic = "scasb";
        break;
      case 0xaf:
        mnemonic = "scasw";
        break;
      case 0xc0:
      case 0xc1:
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3: {
        const width = opcode & 1 ? 16 : 8;
        const { reg, operand } = modrm(width);
        mnemonic = SHIFTS[reg]!;
        const count: Operand =
          opcode < 0xd0 ? immediate(8) : opcode < 0xd2 ? { kind: "immediate", value: 1, width: 8 } : register(1, 8);
        operands = [operand, count];
        break;
      }
      case 0xc2:
      case 0xc3:
      case 0xca:
      case 0xcb:
        mnemonic = opcode >= 0xca ? "retf" : "ret";
        flow = "return";
        far = opcode >= 0xca;
        if (!(opcode & 1)) operands = [immediate(16)];
        break;
      case 0xc4:
      case 0xc5: {
        mnemonic = opcode === 0xc4 ? "les" : "lds";
        const { reg, operand } = modrm(16);
        if (operand.kind !== "memory") return fail("far pointer load requires a memory operand");
        operands = [register(reg, 16), { ...operand, width: 32 }];
        break;
      }
      case 0xc6:
      case 0xc7: {
        mnemonic = "mov";
        const width = opcode & 1 ? 16 : 8;
        const { reg, operand } = modrm(width);
        if (reg !== 0) fail("invalid MOV immediate group encoding");
        operands = [operand, immediate(width)];
        break;
      }
      case 0xc8:
        mnemonic = "enter";
        operands = [immediate(16), immediate(8)];
        break;
      case 0xc9:
        mnemonic = "leave";
        break;
      case 0xcc:
        mnemonic = "int";
        operands = [{ kind: "immediate", value: 3, width: 8 }];
        break;
      case 0xcd:
        mnemonic = "int";
        operands = [immediate(8)];
        break;
      case 0xce:
        mnemonic = "into";
        break;
      case 0xcf:
        mnemonic = "iret";
        flow = "return";
        far = true;
        break;
      case 0xd4:
        mnemonic = "aam";
        operands = [immediate(8)];
        break;
      case 0xd5:
        mnemonic = "aad";
        operands = [immediate(8)];
        break;
      case 0xd7:
        mnemonic = "xlat";
        break;
      case 0xe0:
      case 0xe1:
      case 0xe2:
      case 0xe3:
        mnemonic = ["loopne", "loope", "loop", "jcxz"][opcode - 0xe0]!;
        flow = "branch";
        relative(8);
        break;
      case 0xe4:
      case 0xe5:
      case 0xe6:
      case 0xe7: {
        mnemonic = opcode & 2 ? "out" : "in";
        const accumulator = register(0, opcode & 1 ? 16 : 8);
        const port = immediate(8);
        operands = opcode & 2 ? [port, accumulator] : [accumulator, port];
        break;
      }
      case 0xe8:
        mnemonic = "call";
        flow = "call";
        relative(16);
        break;
      case 0xe9:
        mnemonic = "jmp";
        flow = "jump";
        relative(16);
        break;
      case 0xea:
        mnemonic = "jmp";
        flow = "jump";
        farAddress();
        break;
      case 0xeb:
        mnemonic = "jmp";
        flow = "jump";
        relative(8);
        break;
      case 0xec:
      case 0xed:
      case 0xee:
      case 0xef: {
        mnemonic = opcode & 2 ? "out" : "in";
        const accumulator = register(0, opcode & 1 ? 16 : 8);
        const port = register(2, 16);
        operands = opcode & 2 ? [port, accumulator] : [accumulator, port];
        break;
      }
      case 0xf4:
        mnemonic = "hlt";
        flow = "stop";
        break;
      case 0xf5:
        mnemonic = "cmc";
        break;
      case 0xf6:
      case 0xf7: {
        const width = opcode & 1 ? 16 : 8;
        const { reg, operand } = modrm(width);
        mnemonic = ["test", "", "not", "neg", "mul", "imul", "div", "idiv"][reg]!;
        if (!mnemonic) fail("invalid arithmetic group encoding");
        operands = reg === 0 ? [operand, immediate(width)] : [operand];
        break;
      }
      case 0xf8:
        mnemonic = "clc";
        break;
      case 0xf9:
        mnemonic = "stc";
        break;
      case 0xfa:
        mnemonic = "cli";
        break;
      case 0xfb:
        mnemonic = "sti";
        break;
      case 0xfc:
        mnemonic = "cld";
        break;
      case 0xfd:
        mnemonic = "std";
        break;
      case 0xfe:
      case 0xff: {
        const { reg, operand } = modrm(opcode === 0xfe ? 8 : 16);
        if (reg === 7 || (opcode === 0xfe && reg > 1)) fail("invalid increment/call/jump group encoding");
        mnemonic = ["inc", "dec", "call", "call", "jmp", "jmp", "push"][reg]!;
        if (reg === 2 || reg === 3) flow = "call";
        if (reg === 4 || reg === 5) flow = "jump";
        far = reg === 3 || reg === 5;
        if (far) {
          if (operand.kind !== "memory") return fail("indirect far transfer requires a memory operand");
          operands = [{ ...operand, width: 32 }];
        } else operands = [operand];
        break;
      }
      default:
        fail(`unsupported opcode ${hex(opcode, 2)}`);
    }
  }
  return {
    address,
    segment,
    offset,
    size: bytes.length,
    bytes,
    mnemonic,
    operands,
    prefixes,
    flow,
    text: `${prefixes.length ? `${prefixes.join(" ")} ` : ""}${segmentOverride && !operands.some((operand) => operand.kind === "memory") ? `${segmentOverride} ` : ""}${mnemonic}${operands.length ? ` ${operands.map(operandText).join(", ")}` : ""}`,
    ...(segmentOverride ? { segmentOverride } : {}),
    ...(target ? { target } : {}),
    ...(far !== undefined ? { far } : {}),
  };
}
