/** The backgrounds sprites and levels can be shown on. The choice is shared by Sprites and Levels. */

import { ref } from "vue";

export type Background = "checker" | "black" | "white" | "game";

/** The colour behind the parts in the game. */
export const GAME_BACKGROUND = "#0092a4";

export const BACKGROUNDS: { value: Background; label: string; title?: string }[] = [
  { value: "checker", label: "Checks", title: "Shows which pixels are transparent" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
  { value: "game", label: "Game", title: `The game’s own background: ${GAME_BACKGROUND}, or a TIM 2 level’s colour` },
];

export const BACKGROUND_CLASSES: Record<Background, string> = {
  checker: "checker",
  black: "bg-black",
  white: "bg-white",
  game: "bg-[#0092a4]",
};

export const background = ref<Background>("checker");
