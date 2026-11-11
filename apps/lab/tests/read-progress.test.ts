import { expect, it } from "vitest";
import { detailOf, timeLeft } from "../src/read-progress.ts";

it("says what each step of the read is at", () => {
  expect(detailOf(0, 23, 66)).toBe("type 23 of 66");
  // Before the first type, while the program is unpacked.
  expect(detailOf(0, 0, 1)).toBe("starting");
  expect(detailOf(1, 1, 1)).toBe("");
  // The walks count one start, a pass over the 63 sources of hits, then the 63 parts.
  expect(detailOf(2, 1, 127)).toBe("starting");
  expect(detailOf(2, 24, 127)).toBe("first pass, part 23 of 63");
  expect(detailOf(4, 64, 127)).toBe("first pass, part 63 of 63");
  expect(detailOf(4, 65, 127)).toBe("part 1 of 63");
  expect(detailOf(3, 5, 40)).toBe("loop 5 of 40");
  expect(detailOf(3, 0, 1)).toBe("");
});

it("rounds the time left so it doesn't jump about", () => {
  expect(timeLeft(undefined)).toBe("Working out the time left…");
  expect(timeLeft(4)).toBe("About 10 s left");
  expect(timeLeft(34)).toBe("About 30 s left");
  expect(timeLeft(130)).toBe("About 2 min left");
});
