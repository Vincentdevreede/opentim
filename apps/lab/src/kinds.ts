import type { ResourceKind } from "@opentim/resources";

export type Confidence = "decoded" | "partial" | "hypothesis" | "unsupported" | "error";

/** The groups the lab shows resources in. Rare kinds are folded into "other". */
export type KindGroup = "sprites" | "screen" | "palette" | "level" | "scene" | "sound" | "other";

export const GROUPS: { id: KindGroup; label: string }[] = [
  { id: "sprites", label: "Sprites" },
  { id: "screen", label: "Screens" },
  { id: "palette", label: "Palettes" },
  { id: "level", label: "Levels" },
  { id: "scene", label: "Scenes" },
  { id: "sound", label: "Sounds" },
  { id: "other", label: "Other" },
];

export function groupOf(kind: ResourceKind): KindGroup {
  switch (kind) {
    case "sprites":
    case "screen":
    case "palette":
    case "level":
    case "scene":
      return kind;
    case "audio":
      return "sound";
    default:
      return "other";
  }
}

/** What the lab can decode per group. Update this as decoders are ported, so every badge in the lab follows. */
export const SUPPORT: Record<KindGroup, { status: Confidence; note: string }> = {
  sprites: { status: "decoded", note: "Decoded. View the frames in Sprites." },
  screen: { status: "decoded", note: "Decoded. View it in Sprites." },
  palette: { status: "decoded", note: "Decoded. Sprites uses it to colour the images." },
  level: {
    status: "decoded",
    note: "Read to the last byte, except TIM 2 levels. View it in Levels.",
  },
  scene: {
    status: "decoded",
    note: "Read to the last byte, as a level without a title. View it in Levels.",
  },
  sound: { status: "unsupported", note: "Not decoded in the lab yet. Raw bytes only." },
  other: { status: "unsupported", note: "Unknown format. Raw bytes only." },
};

export const CONFIDENCE_HELP: { status: Confidence; text: string }[] = [
  { status: "decoded", text: "Format understood; output matches the game." },
  { status: "partial", text: "Decodes, but some fields or parts are missing." },
  { status: "hypothesis", text: "Research guess. Useful, not yet verified." },
  { status: "unsupported", text: "Not decoded yet. Raw bytes only." },
];
