import type { Confidence as FindingConfidence } from "@opentim/content";
import type { ResourceKind } from "@opentim/resources";

export type Confidence = "decoded" | "partial" | "hypothesis" | "unsupported" | "error";

/** What each status means, for the tip of a status dot or badge that has no words of its own. */
export const CONFIDENCE_TIPS: Record<Confidence, string> = {
  decoded: "Decoded: the lab reads it completely.",
  partial: "Partly decoded: the lab reads some of it.",
  hypothesis: "A guess: it fits what is known, but isn’t confirmed.",
  unsupported: "Not supported yet.",
  error: "Can’t be read.",
};

/** How sure a finding of the behaviour analysis is, for the tip of its mark. */
export const FINDING_TIPS: Record<FindingConfidence, string> = {
  checked: "Checked: follows directly from the instructions",
  inferred: "Inferred: follows from the analysis, with the assumptions it lists",
  unresolved: "Unresolved: the analysis can’t tell",
};

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
    note: "Read to the last byte. View it in Levels.",
  },
  scene: {
    status: "decoded",
    note: "Read to the last byte, as a level without a title. View it in Levels.",
  },
  sound: {
    status: "partial",
    note: "Read. Samples play in Audio, and MIDI through the game’s AdLib driver on an emulated chip.",
  },
  other: { status: "unsupported", note: "Unknown format. Raw bytes only." },
};

export const CONFIDENCE_HELP: { status: Confidence; text: string }[] = [
  { status: "decoded", text: "Format understood; output matches the game." },
  { status: "partial", text: "Decodes, but some fields or parts are missing." },
  { status: "hypothesis", text: "Research guess. Useful, not yet verified." },
  { status: "unsupported", text: "Not decoded yet. Raw bytes only." },
];
