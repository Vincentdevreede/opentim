import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DECIDED_ASSUMPTIONS } from "../src/read/behaviour-assumptions.ts";

const page = readFileSync(
  new URL("../../../docs/assumptions/behaviour-assumptions.md", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

describe("the decided assumptions", () => {
  it.each(DECIDED_ASSUMPTIONS.flatMap((group) => group.assumptions))(
    "are written on the assumptions page word for word: %s",
    (assumption) => expect(page).toContain(assumption.replace(/0x[0-9a-f]+/g, (n) => `\`${n}\``)),
  );
});
