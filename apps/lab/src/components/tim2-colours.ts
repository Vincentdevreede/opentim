/**
 * Whether TIM 2 is shown in 16 colours, as TIM2.EXE draws it with its `HEG:` driver, or in the palette's own 256
 * colours. The choice is shared by Sprites, Parts and Levels, and only shows for TIM 2.
 */

import { computed, ref } from "vue";
import { readTim2Driver, type Tim2Driver } from "@opentim/content";
import { program, resources } from "../library.ts";

export type Tim2Colours = 16 | 256;

export const TIM2_COLOURS: { value: Tim2Colours; label: string; title: string }[] = [
  {
    value: 16,
    label: "16 colours",
    title:
      "As the game shows them, through TIM2.EXE’s 16 colour driver in VM.OVL: a colour c is the palette’s colour c & 15, and a box filled in a colour of 16 or more gets a pattern of its two halves",
  },
  { value: 256, label: "256 colours", title: "Every colour as the palette has it" },
];

export const tim2Colours = ref<Tim2Colours>(16);

/** True when the loaded game is TIM 2, whose program is TIM2.EXE. */
export const isTim2 = computed(() => program.value?.name.toUpperCase() === "TIM2.EXE");

/** The loaded TIM 2's 16 colour driver, or why it can't be read. Undefined for the other games. */
export const tim2Driver = computed((): { driver: Tim2Driver } | { problem: string } | undefined => {
  if (!isTim2.value) return undefined;
  const file = resources.value.find((r) => r.name.toUpperCase() === "VM.OVL");
  if (!file) return { problem: "VM.OVL, which holds TIM2.EXE’s video drivers, isn’t in the loaded files." };
  try {
    return { driver: readTim2Driver(file.data) };
  } catch (error) {
    return { problem: `${(error as Error).message}.` };
  }
});

/** True when TIM 2 is drawn in 16 colours: the setting asks for it and the driver was read. */
export const sixteenColours = computed(
  () => isTim2.value && tim2Colours.value === 16 && !!tim2Driver.value && "driver" in tim2Driver.value,
);

/** Why the 16 colours the setting asks for can't be shown, or undefined. */
export const tim2ColourProblem = computed(() =>
  isTim2.value && tim2Colours.value === 16 && tim2Driver.value && "problem" in tim2Driver.value
    ? `${tim2Driver.value.problem} Without TIM2.EXE’s 16 colour driver the pictures are shown in the palette’s own colours.`
    : undefined,
);
