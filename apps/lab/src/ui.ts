import type { FmCard } from "@opentim/sound";
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

/** The id of the part selected on the Parts page. */
export const selectedPart = ref<string>();

/** How the behaviour tab lays out a part: by its routines, or by the states a change starts from. */
export const behaviourLayout = ref<"routine" | "state">("routine");

/** The sound selected on the Audio page: a bank's file name and the sound's id, or a sample's file name. */
export const selectedSound = ref<string>();

/**
 * The card whose FM driver plays MIDI on the Audio page: the Sound Blaster Pro in stereo, since the songs are mixed
 * with pan, or the AdLib in mono.
 */
export const fmCard = ref<FmCard>("sbpro");

/** The level file selected on the Levels page, like `L7.LEV`. */
export const selectedLevel = ref<string>();
