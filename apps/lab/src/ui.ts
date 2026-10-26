import { ref } from "vue";

/** Breadcrumb shown on the right of the status bar, set by the active page. */
export const crumb = ref<string[]>([]);

export const formatBytes = (n: number) => n.toLocaleString("en-US");
export const hex = (n: number, width = 8) => "0x" + n.toString(16).toUpperCase().padStart(width, "0");

/** An offset for the Files page to show when it opens, set by pages that link to a byte. */
export const openAt = ref<number>();

/** True while files are dragged over the window. */
export const dragging = ref(false);
