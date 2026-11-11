import { ref } from "vue";

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
