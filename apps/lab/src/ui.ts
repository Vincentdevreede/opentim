import { ref } from "vue";

/** Breadcrumb shown on the right of the status bar, set by the active page. */
export const crumb = ref<string[]>([]);

export const formatBytes = (n: number) => n.toLocaleString("en-US");
export const hex = (n: number, width = 8) => "0x" + n.toString(16).toUpperCase().padStart(width, "0");

/** An offset for the Files page to show when it opens, set by pages that link to a byte. */
export const openAt = ref<number>();

/** A sprite for the Sprites page to show when it opens, set by pages that link to a sprite of an image file. */
export const openSprite = ref<number>();

/** True while files are dragged over the window. */
export const dragging = ref(false);

/** Which detail the Sprites page shows: the selected part, or the selected image file. */
export const spritesView = ref<"parts" | "images">("parts");

/** The id of the part selected on the Sprites page. */
export const selectedPart = ref<string>();
