export type ResourceKind =
  "sprites" | "screen" | "palette" | "font" | "audio" | "level" | "scene" | "overlay" | "text" | "binary";

const KINDS: Record<string, ResourceKind> = {
  BMP: "sprites",
  SCR: "screen",
  PAL: "palette",
  FNT: "font",
  SX: "audio",
  LEV: "level",
  TIM: "level",
  GKC: "scene",
  OVL: "overlay",
  TXT: "text",
};

/** Guesses a resource's kind from its file extension. */
export const kindOf = (name: string): ResourceKind => KINDS[name.toUpperCase().split(".").pop() ?? ""] ?? "binary";
