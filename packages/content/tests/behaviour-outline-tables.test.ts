import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { readOutlineTables } from "../src/read/behaviour-outline-tables.ts";
import { outlineTableWords } from "../src/read/describe-outline.ts";

// The electric switch's reset in Even More (English floppy, at 0x1a64a): it picks a table by whether the frame is
// below 4, copies 4 corners into the outline records and sets the frame from the sockets.
const RESET =
  "558bec83ec0456578b7606837c0c047d05bf5a2eeb03bf622ec746fe00008b8482008946fceb178a058b5efc88078a4501884701ff46fe8346fc0483c702837efe047ce3c78480000400569ae869000059c7848000010083640c04837c62007404834c0c01837c64007404834c0c025f5e8be55dcb";
const ENTRY = 0x1a64a;

function program() {
  const image = new Uint8Array(0x1a700);
  image.set(Buffer.from(RESET, "hex"), ENTRY);
  image.set([8, 8, 15, 8, 15, 9, 8, 9], 0x2e5a);
  image.set([15, 24, 8, 24, 8, 23, 15, 23], 0x2e62);
  return image;
}
const read = (image: Uint8Array, others: ReturnType<typeof readRoutineCode>[] = []) => {
  const code = readRoutineCode(image, { segment: 0x1000, offset: ENTRY - 0x10000, address: ENTRY }, 0);
  return readOutlineTables(code, image, 0, { outline: 0x82, state: 0x0c }, [code, ...others]);
};

describe("outline tables", () => {
  it("reads the switch's two lever outlines with the frame tests that pick them", () => {
    const copy = read(program())!;
    expect(copy.tables).toEqual([
      {
        when: [["frame >= 4"]],
        address: 0x2e62,
        corners: [
          [15, 24],
          [8, 24],
          [8, 23],
          [15, 23],
        ],
      },
      {
        when: [["frame < 4"]],
        address: 0x2e5a,
        corners: [
          [8, 8],
          [15, 8],
          [15, 9],
          [8, 9],
        ],
      },
    ]);
    expect(outlineTableWords(copy)).toBe(
      "Copies its outline from a table chosen by its frame: on a frame below 4, 4 corners (8, 8), (15, 8), (15, 9), (8, 9); on a frame at least 4, 4 corners (15, 24), (8, 24), (8, 23), (15, 23).",
    );
  });

  it("gives no tables when an instruction writes into one by its address", () => {
    const image = program();
    // mov byte [0x2e5c], 0 followed by retf, somewhere else in the program.
    image.set([0xc6, 0x06, 0x5c, 0x2e, 0x00, 0xcb], 0x100);
    const writer = readRoutineCode(image, { segment: 0, offset: 0x100, address: 0x100 }, 0);
    expect(read(image, [writer])).toBeUndefined();
  });
});
