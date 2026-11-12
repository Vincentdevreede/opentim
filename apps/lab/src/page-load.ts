import { ref } from "vue";
import type { Router } from "vue-router";

/**
 * The page whose code didn't load, by its address. Pages load the first time they open; after a new version of the
 * Lab is put online, a tab that was already open asks for files that are gone, and the page can't open until the tab
 * is reloaded. `App.vue` says so and offers a reload.
 */
export const pageLoadFailed = ref<string>();

/** Whether an error is a page's code that didn't load, as browsers and Vite word it. */
export const isPageLoadError = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk/i.test(
    error.message,
  );

/**
 * Keeps `pageLoadFailed` up to date: a page whose code didn't load stays where it was and the app says why. Opening a
 * page clears it; clicking the page that is already open, or a click that another click cut short, doesn't. A slow page
 * that fails after another page has opened never gets here, because the router drops it as soon as the other opens.
 */
export function trackPageLoads(router: Router) {
  router.onError((error, to) => {
    if (isPageLoadError(error)) pageLoadFailed.value = to.fullPath;
  });
  router.afterEach((_to, _from, failure) => {
    if (!failure) pageLoadFailed.value = undefined;
  });
}

/**
 * Whether going to an address means loading the page that is already open. Only a reload fetches the new code then:
 * going to the same address with a `#` part just scrolls.
 */
export const isOpenPage = (path: string, here: { pathname: string; search: string }) => {
  const to = new URL(path, "http://lab");
  return to.pathname === here.pathname && to.search === here.search;
};
