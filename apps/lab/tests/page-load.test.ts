import { expect, it } from "vitest";
import { isPageLoadError } from "../src/page-load.ts";

it("knows a page's code that didn't load, as each browser and Vite word it", () => {
  // Chrome, Firefox, Safari, and Vite's preload of a page's styles.
  expect(isPageLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/LevelsPage-x.js"))).toBe(
    true,
  );
  expect(isPageLoadError(new TypeError("error loading dynamically imported module: /assets/AudioPage-x.js"))).toBe(
    true,
  );
  expect(isPageLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  expect(isPageLoadError(new Error("Unable to preload CSS for /assets/PartsPage-x.css"))).toBe(true);
});

it("leaves other errors to the page", () => {
  expect(isPageLoadError(new Error("Not a level file: the magic is 0x1234"))).toBe(false);
  expect(isPageLoadError("Failed to fetch dynamically imported module")).toBe(false);
  expect(isPageLoadError(undefined)).toBe(false);
});
