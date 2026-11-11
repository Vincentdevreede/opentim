import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import ReadProgress from "../../src/components/ReadProgress.vue";

const html = (compact: boolean) => renderToString(createSSRApp({ render: () => h(ReadProgress, { compact }) }));

it("shows only the words and the bar in the status bar, with the rest in the tip", async () => {
  const page = await html(true);
  expect(visibleText(page).trim()).toBe("Reading behaviour");
  expect(page).toContain('role="progressbar"');
  expect(page).toContain('title="Reading the behaviour from the program: starting"');
});

it("shows the step and the share in the tabs", async () => {
  const text = visibleText(await html(false));
  expect(text).toContain("Reading the behaviour from the program");
  expect(text).toContain("0 %");
});
