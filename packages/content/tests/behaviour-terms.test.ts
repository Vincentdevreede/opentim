import { describe, expect, it } from "vitest";
import { writesRegister } from "../src/read/behaviour-terms.ts";
import { decodeInstruction } from "../src/read/x86.ts";

const decode = (bytes: number[]) => decodeInstruction(new Uint8Array(bytes), 0);

describe("the registers an instruction writes", () => {
  it("counts ax and dx for a one operand imul, and only the destination for the three operand form", () => {
    // imul cx
    const one = decode([0xf7, 0xe9]);
    expect(writesRegister(one, "ax")).toBe(true);
    expect(writesRegister(one, "dx")).toBe(true);
    // imul bx, cx, 2
    const three = decode([0x6b, 0xd9, 0x02]);
    expect(three.operands).toHaveLength(3);
    expect(writesRegister(three, "bx")).toBe(true);
    expect(writesRegister(three, "ax")).toBe(false);
    expect(writesRegister(three, "dx")).toBe(false);
  });
});
