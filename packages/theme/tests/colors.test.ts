import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { colors } from "../src/colors.ts";

it("matches the colours in theme.css", () => {
  const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
  const fromCss = Object.fromEntries(
    [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name = "", value]) => [
      name.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()),
      value,
    ]),
  );
  expect(fromCss).toEqual(colors);
});
