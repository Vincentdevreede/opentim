import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import ReadProgress from "../../src/components/ReadProgress.vue";

const html = (compact: boolean) => renderToString(createSSRApp({ render: () => h(ReadProgress, { compact }) }));

it("shows only the words and the bar in the status bar, with the rest in the Lab's own tip", async () => {
  const page = await html(true);
  expect(visibleText(page).trim()).toBe("Reading behaviour");
  expect(page).toContain('role="progressbar"');
  // The tip opens from the keyboard too, and screen readers read its text; the browser's own tooltip is gone.
  expect(page).toContain('tabindex="0"');
  expect(page).toContain('aria-label="Reading the behaviour from the program: starting"');
  expect(page).not.toContain("title=");
});

it("shows the step and the share in the tabs", async () => {
  const text = visibleText(await html(false));
  expect(text).toContain("Reading the behaviour from the program");
  expect(text).toContain("0 %");
});
