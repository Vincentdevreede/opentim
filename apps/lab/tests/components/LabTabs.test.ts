import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import LabTabs from "../../src/components/LabTabs.vue";
import { tabAfterKey, tabPanel } from "../../src/components/tabs.ts";

const options = [
  { value: "frames", label: "Frames" },
  { value: "sprites", label: "Sprites" },
  { value: "data", label: "Data", disabled: true },
];

describe("LabTabs", () => {
  it("renders a tab list whose selected tab controls the panel and is the only one in the tab order", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(LabTabs, { id: "t", label: "Frames or sprites", options, modelValue: "sprites" }),
      }),
    );
    expect(html).toContain('role="tablist" aria-label="Frames or sprites"');
    expect(html).toMatch(
      /id="t-tab-frames"[^>]*role="tab" aria-selected="false" aria-controls="t-panel" tabindex="-1"/,
    );
    expect(html).toMatch(/id="t-tab-sprites"[^>]*role="tab" aria-selected="true" aria-controls="t-panel" tabindex="0"/);
    expect(html).not.toContain("aria-pressed");
  });

  it("gives the panel the id the tabs point at and names it after the selected tab", () => {
    expect(tabPanel("t", "sprites")).toEqual({ role: "tabpanel", id: "t-panel", "aria-labelledby": "t-tab-sprites" });
  });
});

describe("tabAfterKey", () => {
  const enabled = ["frames", "sprites", "behaviour"];

  it("moves with the arrows, wrapping around, and jumps with Home and End", () => {
    expect(tabAfterKey("ArrowRight", enabled, "frames")).toBe("sprites");
    expect(tabAfterKey("ArrowRight", enabled, "behaviour")).toBe("frames");
    expect(tabAfterKey("ArrowLeft", enabled, "frames")).toBe("behaviour");
    expect(tabAfterKey("Home", enabled, "behaviour")).toBe("frames");
    expect(tabAfterKey("End", enabled, "frames")).toBe("behaviour");
  });

  it("leaves other keys to the page", () => {
    expect(tabAfterKey("f", enabled, "frames")).toBeUndefined();
    expect(tabAfterKey("ArrowRight", [], "frames")).toBeUndefined();
  });
});
