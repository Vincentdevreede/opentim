import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, expect, it } from "vitest";
import { PROFILES, type Edition } from "../../../src/edition.ts";
import { phase, staging, type GameFile, type Staging } from "../../../src/library.ts";
import ImportStart from "../../../src/components/import/ImportStart.vue";
import { visibleText } from "../../visible-text.ts";

const file = (name: string): GameFile => ({
  name,
  size: 2,
  data: Uint8Array.of(0x4d, 0x5a),
  sha256: "0",
  resources: [],
});

/** Staged files of a version, with or without its program. */
function staged(edition: Edition, program?: GameFile): Staging {
  const files = [file("RESOURCE.001"), ...(program ? [program] : [])];
  return {
    selected: files,
    languages: [],
    files,
    resources: [],
    replaced: [],
    edition,
    program,
    seconds: 0,
    readLog: [],
    log: [],
  };
}

/** True when the Continue button is disabled. */
const continueDisabled = (html: string) => {
  const end = html.indexOf("Continue<");
  const tag = html.slice(html.lastIndexOf("<button", end), html.indexOf(">", html.lastIndexOf("<button", end)) + 1);
  return /\sdisabled[\s>=]/.test(tag);
};

const render = async () => {
  const html = await renderToString(createSSRApp({ render: () => h(ImportStart) }));
  return { html, text: visibleText(html) };
};

afterEach(() => {
  staging.value = undefined;
  phase.value = "empty";
});

it("names the missing program and doesn't continue without it", async () => {
  const profile = PROFILES.find((p) => p.id === "tim2-en-demo")!;
  staging.value = staged({ status: "recognized", profile });
  phase.value = "staged";
  const { html, text } = await render();
  expect(text).toContain("TIM2.EXE is missing.");
  expect(text).toContain("Add TIM2.EXE…");
  expect(continueDisabled(html)).toBe(true);
});

it("asks for any game's program when the version isn't known", async () => {
  staging.value = staged({ status: "unknown" });
  phase.value = "staged";
  const { text } = await render();
  expect(text).toContain("The game’s program is missing. Add the one the game has: TIM.EXE, TIM2.EXE or TOONS.EXE");
  expect(text).toContain("Add the program…");
});

it("continues once the program is there", async () => {
  const profile = PROFILES.find((p) => p.id === "toons-en-floppy")!;
  staging.value = staged({ status: "recognized", profile }, file("TOONS.EXE"));
  phase.value = "staged";
  const { html, text } = await render();
  expect(text).not.toContain("is missing");
  expect(continueDisabled(html)).toBe(false);
});
