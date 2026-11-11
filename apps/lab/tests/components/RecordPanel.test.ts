import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import RecordPanel from "../../src/components/sprites/RecordPanel.vue";

it("says a pointer to a list as words, keeping where it is for the tip", async () => {
  const bytes = new Uint8Array(58);
  // The frames at 0x1234 in the data segment, no frame positions.
  bytes[0x16] = 0x34;
  bytes[0x17] = 0x12;
  const html = await renderToString(
    createSSRApp({ render: () => h(RecordPanel, { record: { type: 1, at: 0x1000, bytes } }) }),
  );
  const text = visibleText(html);
  expect(text).toContain("frames a list");
  expect(text).toContain("frame positions none");
  expect(text).not.toContain("0x1234");
  expect(html).toContain("0x1234");
});
