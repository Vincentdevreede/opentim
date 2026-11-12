import { beforeEach, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { isOpenPage, isPageLoadError, pageLoadFailed, trackPageLoads } from "../src/page-load.ts";

const Page = { render: () => null };
const gone = () => new TypeError("Failed to fetch dynamically imported module: /assets/PartsPage-x.js");

/** A router like the Lab's, whose Parts page fails to load once `fail` is called, and Sprites opens once `open` is. */
async function lab() {
  let fail!: () => void;
  let open!: () => void;
  let started!: () => void;
  const partsStarted = new Promise<void>((resolve) => (started = resolve));
  const parts = new Promise<never>((_, reject) => (fail = () => reject(gone())));
  const sprites = new Promise<typeof Page>((resolve) => (open = () => resolve(Page)));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Page },
      { path: "/sprites", component: () => sprites },
      {
        path: "/parts",
        component: () => {
          started();
          return parts;
        },
      },
    ],
  });
  trackPageLoads(router);
  await router.push("/");
  return { router, fail, open, partsStarted };
}

beforeEach(() => {
  pageLoadFailed.value = undefined;
});

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

it("says which page didn't load, and clears it once a page opens", async () => {
  const { router, fail, open } = await lab();
  const opening = router.push("/parts#details").catch(() => undefined);
  fail();
  await opening;
  expect(pageLoadFailed.value).toBe("/parts#details");
  open();
  await router.push("/sprites");
  expect(pageLoadFailed.value).toBeUndefined();
});

it("keeps the message when the page that is open is clicked again", async () => {
  const { router, fail } = await lab();
  const opening = router.push("/parts").catch(() => undefined);
  fail();
  await opening;
  await router.push("/");
  expect(pageLoadFailed.value).toBe("/parts");
});

it("ignores a slow page that fails after another page has opened", async () => {
  const { router, fail, open, partsStarted } = await lab();
  const slow = router.push("/parts").catch(() => undefined);
  await partsStarted;
  open();
  await router.push("/sprites");
  fail();
  await slow;
  expect(router.currentRoute.value.path).toBe("/sprites");
  expect(pageLoadFailed.value).toBeUndefined();
});

it("ignores a slow page that fails while another page is still opening", async () => {
  const { router, fail, open, partsStarted } = await lab();
  const slow = router.push("/parts").catch(() => undefined);
  await partsStarted;
  const next = router.push("/sprites");
  fail();
  await slow;
  expect(pageLoadFailed.value).toBeUndefined();
  open();
  await next;
  expect(router.currentRoute.value.path).toBe("/sprites");
});

it("reloads instead of going to the address when it is the open page's own", () => {
  const here = { pathname: "/parts", search: "" };
  expect(isOpenPage("/parts", here)).toBe(true);
  expect(isOpenPage("/parts#details", here)).toBe(true);
  expect(isOpenPage("/sprites", here)).toBe(false);
  expect(isOpenPage("/parts?file=2", here)).toBe(false);
});
