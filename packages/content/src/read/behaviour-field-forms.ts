/**
 * Names part fields of TIM2.EXE and TOONS.EXE from routines of their own whose code shows what each field is: the
 * frame position and frame size helpers, the motion helper, the history update, the level reset and the contact
 * producer. TIM.EXE's names come from its helpers and its frame drawing (`behaviour-layout.ts`, `behaviour-fields.ts`),
 * which are recognised in its near-pointer forms only; these forms are the same routines as TIM2.EXE and TOONS.EXE
 * write them, so the fields get TIM.EXE's names where the routine is TIM.EXE's.
 *
 * A form is the routine's instruction bytes, with `??` for a byte that may differ (a call's target, a jump, a local)
 * and `{name}` for a field's offset (one byte, or `{name:16}` for a word). A name that starts with `_` is a value the
 * form only needs to be the same wherever it appears, like a local. The offsets are read from the matched bytes, never
 * given: a build where the form isn't found names nothing. The addresses in the comments are image addresses of the
 * multilingual TIM 2 CD build and the English Toons build; the forms match the TIM 2 floppy and demo builds as well.
 * See docs/research/behaviour/tim2-and-toons.md, "The part fields".
 */
import type { LayoutField } from "./behaviour-layout.ts";
import { instructionEvidence } from "./behaviour-timing.ts";

export interface FieldForm {
  /** The routine the form is part of, in words. */
  routine: string;
  /** The instruction bytes, as above. */
  bytes: string;
  /** Why the routine shows what the fields are, as the finding's assumption. */
  assumption: string;
  /** Named bits of a field the form tests, by the field's name. */
  masks?: Record<string, { value: number; name: string }[]>;
}

/** What each field a form names is, by its name. */
export const FORM_FIELD_DESCRIPTIONS: Record<string, string> = {
  positionX: "The horizontal position, which the frame position helper copies into the drawing origin.",
  positionY: "The vertical position, which the frame position helper copies into the drawing origin.",
  drawX: "The horizontal drawing origin: the position plus the frame's offset, reflected by the extent when mirrored.",
  drawY: "The vertical drawing origin: the position plus the frame's offset, reflected by the extent when mirrored.",
  drawingFlags: "Bits the frame position helper tests to mirror the frame: 0x10 left to right, 0x20 upside down.",
  horizontalExtent: "The horizontal extent a mirrored frame's offset is reflected by.",
  verticalExtent: "The vertical extent a mirrored frame's offset is reflected by.",
  frameWidth: "The current frame's width, subtracted when a mirrored frame's offset is reflected.",
  frameHeight: "The current frame's height, subtracted when a mirrored frame's offset is reflected.",
  frameOffsetX: "The frame's horizontal offset from the position, reflected when mirrored, which the drawing adds.",
  frameOffsetY: "The frame's vertical offset from the position, reflected when mirrored, which the drawing adds.",
  baseWidth: "The stored width, which the frame size helper copies into the frame width for the types it names.",
  baseHeight: "The stored height, which the frame size helper copies into the frame height for the types it names.",
  previousX: "The previous horizontal position: the history update copies the position here.",
  previousY: "The previous vertical position: the history update copies the position here.",
  velocityX: "The horizontal motion: the motion helper sets it to the position less the previous one, scaled up.",
  velocityY: "The vertical motion: the motion helper sets it to the position less the previous one, scaled up.",
  previousState: "The previous state: the history update copies the state here.",
  olderState: "The state before the previous one: the history update copies the previous state here first.",
  stateDelta: "A value added to the state in the matched routine, with meanings that can differ between parts.",
  savedPositionX: "The horizontal position the level reset puts back.",
  savedPositionY: "The vertical position the level reset puts back.",
  savedState: "The state the level reset puts back.",
  savedDrawingFlags: "The drawing flags the level reset puts back.",
  contactPart: "The part the contact producer found this part touching.",
  contactAngle: "The angle of the touched outline's edge, turned by half a turn, as the contact producer stores it.",
  contactEdge: "The zero-based index of the outline edge the contact producer found.",
  outlinePointCount: "The number of outline points, which bounds the contact producer's walk along the outline.",
};

type Token = { kind: "byte"; value: number } | { kind: "any" } | { kind: "capture"; name: string; width: 8 | 16 };

function tokens(bytes: string): Token[] {
  return bytes
    .trim()
    .split(/\s+/)
    .map((word): Token => {
      if (word === "??") return { kind: "any" };
      const capture = /^\{(\w+)(?::(16))?\}$/.exec(word);
      if (capture) return { kind: "capture", name: capture[1]!, width: capture[2] ? 16 : 8 };
      if (!/^[0-9a-f]{2}$/i.test(word)) throw new Error(`Not a byte of a field form: ${word}`);
      return { kind: "byte", value: parseInt(word, 16) };
    });
}

/** The bytes a form's tokens take: two for a word's capture. */
const size = (list: Token[]) => list.reduce((n, t) => n + (t.kind === "capture" && t.width === 16 ? 2 : 1), 0);

/** Where the form matches, with what each name holds there; a name that appears twice must hold the same both times. */
export function matchFieldForm(
  image: Uint8Array,
  bytes: string,
): { at: number; end: number; values: Map<string, number> }[] {
  const list = tokens(bytes);
  const length = size(list);
  const matches: { at: number; end: number; values: Map<string, number> }[] = [];
  for (let at = 0; at + length <= image.length; at++) {
    const values = new Map<string, number>();
    let p = at;
    let ok = true;
    for (const t of list) {
      if (t.kind === "byte") ok = image[p] === t.value;
      else if (t.kind === "capture") {
        const value = t.width === 16 ? image[p]! | (image[p + 1]! << 8) : image[p]!;
        ok = !values.has(t.name) || values.get(t.name) === value;
        values.set(t.name, value);
      }
      if (!ok) break;
      p += t.kind === "capture" && t.width === 16 ? 2 : 1;
    }
    if (ok) matches.push({ at, end: at + length, values });
  }
  return matches;
}

/**
 * The fields the forms name, besides `known`. A form whose matches disagree about a field, or that gives a field
 * already known at another offset (or an offset known by another name), names nothing and says so in `diagnostics`.
 * Two forms that name the same field must agree on its offset. Masks are added to a known field of the same name and
 * offset too.
 */
export function discoverFormFields(
  image: Uint8Array,
  forms: readonly FieldForm[],
  known: LayoutField[],
  diagnostics: string[],
): LayoutField[] {
  const found = new Map<string, LayoutField>();
  const conflicts = new Set<string>();
  for (const form of forms) {
    const matches = matchFieldForm(image, form.bytes);
    if (!matches.length) {
      diagnostics.push(`The ${form.routine} wasn't found, so the fields it shows aren't named.`);
      continue;
    }
    const offsets = new Map<string, number>();
    let agree = true;
    for (const match of matches)
      for (const [name, value] of match.values) {
        if (name.startsWith("_")) continue;
        if (offsets.has(name) && offsets.get(name) !== value) agree = false;
        offsets.set(name, value);
      }
    const clash = [...offsets].find(([name, offset]) => {
      const byName = known.find((field) => field.name === name) ?? found.get(name);
      const byOffset =
        known.find((field) => field.offset === offset) ?? [...found.values()].find((f) => f.offset === offset);
      return (byName && byName.offset !== offset) || (byOffset && byOffset.name !== name);
    });
    if (!agree || clash) {
      diagnostics.push(
        clash
          ? `The ${form.routine} gives ${clash[0]} at 0x${clash[1].toString(16)}, which another finding names otherwise, so it names nothing.`
          : `The ${form.routine} matches in more than one form, so it names nothing.`,
      );
      for (const name of offsets.keys()) conflicts.add(name);
      continue;
    }
    const evidence = matches.flatMap((match) => instructionEvidence(image, match.at, match.end));
    for (const [name, offset] of offsets) {
      const masks = form.masks?.[name] ?? [];
      const old = known.find((field) => field.name === name);
      if (old) {
        for (const mask of masks) if (!old.masks?.some((m) => m.value === mask.value)) (old.masks ??= []).push(mask);
        continue;
      }
      const field = found.get(name);
      if (field) {
        for (const item of evidence)
          if (!field.evidence.some((previous) => previous.address === item.address)) field.evidence.push(item);
        if (!field.assumptions.includes(form.assumption)) field.assumptions.push(form.assumption);
        for (const mask of masks)
          if (!field.masks?.some((m) => m.value === mask.value)) (field.masks ??= []).push(mask);
        continue;
      }
      found.set(name, {
        offset,
        name,
        description: FORM_FIELD_DESCRIPTIONS[name],
        confidence: "inferred",
        evidence: [...evidence],
        assumptions: [form.assumption],
        ...(masks.length ? { masks: [...masks] } : {}),
      });
    }
  }
  for (const name of conflicts) found.delete(name);
  return [...found.values()].sort((a, b) => a.offset - b.offset);
}

const FLIP_MASKS = {
  drawingFlags: [
    { value: 0x10, name: "horizontalFlip" },
    { value: 0x20, name: "verticalFlip" },
  ],
};

const FRAME_POSITION =
  "The routine is TIM.EXE's frame position helper: it copies the position into the drawing origin and, when a mirror bit of the flags is set, adds the extent less the frame's offset and size instead of the offset.";
const FRAME_SIZE =
  "The routine is TIM.EXE's frame size helper: for the types it names it copies the stored size into the frame size and the frame size into the extents.";
const MOTION =
  "The routine is TIM.EXE's motion helper: it sets each motion word to the position less the previous position, shifted left by 9 less its argument.";
const HISTORY =
  "The routine is TIM.EXE's history update: it copies each previous value one step back, then the current one into the previous one, for the position, the drawing origin, the frame size and the state.";
const LEVEL_RESET =
  "The routine walks every part at a level reset and calls each part's reset callback after it puts these words back into the live ones.";
const CONTACT =
  "The routine is TIM.EXE's contact producer: it stores the part it found, the edge's angle turned by half a turn and the edge's index from its walk along the other part's outline, bounded by that part's point count.";
const STATE_DELTA =
  "The field is added to the state in the matched routine; its producers and its meanings in other part types require separate analysis.";

/**
 * TIM2.EXE's forms. A part is a far pointer, so its fields are read through `es` after `les bx, [bp+6]` (or a far
 * pointer kept in the data segment).
 */
export const TIM2_FIELD_FORMS: readonly FieldForm[] = [
  {
    // 0x1d637: positionX and positionY into drawX and drawY, the flags into si, then the reflection.
    routine: "frame position helper",
    bytes:
      "26 8b 47 {positionX} 26 89 47 {drawX} 26 8b 47 {positionY} 26 89 47 {drawY} 26 8b 77 {drawingFlags} " +
      "ff 76 08 53 90 0e e8 ?? ?? 83 c4 04 0b ff 74 ?? 16 8d 46 {_offset} 50 c4 5e 06 26 ff 77 {state} 57 " +
      "9a ?? ?? ?? ?? 83 c4 08 f7 c6 10 00 74 ?? c4 5e 06 26 8b 47 {horizontalExtent} 2b 46 {_offset} " +
      "26 2b 47 {frameWidth} eb ?? c4 5e 06 8b 46 {_offset} 26 01 47 {drawX} f7 c6 20 00 74 ?? c4 5e 06 " +
      "26 8b 47 {verticalExtent} 2b 46 ?? 26 2b 47 {frameHeight} 26 01 47 {drawY}",
    assumption: FRAME_POSITION,
    masks: FLIP_MASKS,
  },
  {
    // 0x1d803 in the frame size helper (0x1d6d6).
    routine: "frame size helper",
    bytes:
      "c4 5e 06 26 8b 47 {baseWidth} 26 89 47 {frameWidth} 26 8b 47 {baseHeight} 26 89 47 {frameHeight} " +
      "c4 5e 06 26 8b 57 {frameHeight} 26 8b 47 {frameWidth} 26 89 57 {verticalExtent} 26 89 47 {horizontalExtent}",
    assumption: FRAME_SIZE,
  },
  {
    // 0x1df97 in the motion helper (0x1df8a).
    routine: "motion helper",
    bytes:
      "c4 5e 06 26 8b 47 {positionX} 26 2b 47 {previousX} 26 89 47 {velocityX} b1 09 2a 4e ?? 26 d3 67 {velocityX} " +
      "f7 c6 02 00 74 ?? c4 5e 06 26 8b 47 {positionY} 26 2b 47 {previousY} 26 89 47 {velocityY} b1 09 2a 4e ?? " +
      "26 d3 67 {velocityY}",
    assumption: MOTION,
  },
  {
    // 0x1ebaa in the history update (0x1eba5).
    routine: "history update",
    bytes:
      "c4 5e 06 26 8b 57 {previousY} 26 8b 47 {previousX} 26 89 57 ?? 26 89 47 ?? " +
      "26 8b 57 {positionY} 26 8b 47 {positionX} 26 89 57 {previousY} 26 89 47 {previousX} " +
      "26 8b 57 ?? 26 8b 47 ?? 26 89 57 ?? 26 89 47 ?? 26 8b 57 {drawY} 26 8b 47 {drawX} 26 89 57 ?? 26 89 47 ?? " +
      "26 8b 57 ?? 26 8b 47 ?? 26 89 57 ?? 26 89 47 ?? 26 8b 57 {frameHeight} 26 8b 47 {frameWidth} " +
      "26 89 57 ?? 26 89 47 ?? 26 8b 47 {previousState} 26 89 47 {olderState} 26 8b 47 {state} 26 89 47 {previousState}",
    assumption: HISTORY,
  },
  {
    // 0x1ed68 in the level reset (0x1ed1a), which calls the reset callback at 0x1ef18.
    routine: "level reset",
    bytes:
      "c4 5e {_part} 26 83 67 ?? ?? 26 8b 87 {savedDrawingFlags:16} 26 89 47 {drawingFlags} 26 81 67 ?? ?? ?? " +
      "26 8b 87 {savedPositionX:16} 26 89 47 ?? 26 89 47 {previousX} 26 89 47 {positionX} " +
      "26 8b 87 {savedPositionY:16} 26 89 47 ?? 26 89 47 {previousY} 26 89 47 {positionY} " +
      "26 8b 47 {positionX} 99 26 89 57 ?? 26 89 47 ?? 26 8b 47 {positionY} 99 26 89 57 ?? 26 89 47 ?? " +
      "26 8b 57 ?? 26 8b 47 ?? b1 09 9a ?? ?? ?? ?? c4 5e {_part} 26 89 57 ?? 26 89 47 ?? " +
      "26 8b 57 ?? 26 8b 47 ?? b1 09 9a ?? ?? ?? ?? c4 5e {_part} 26 89 57 ?? 26 89 47 ?? " +
      "26 8b 87 {savedState:16} 26 89 47 {state} 26 8b 47 {state} 26 89 47 {previousState} 26 89 47 {olderState}",
    assumption: LEVEL_RESET,
  },
  {
    // 0x5099e in the contact producer (0x506ec): the part it moves is the far pointer at {_part}, the other at {_other}.
    routine: "contact producer",
    bytes:
      "c4 1e {_part:16} 8b 16 ?? ?? a1 {_other:16} 26 89 97 ?? ?? 26 89 87 {contactPart:16} 8b 46 ?? 05 00 80 " +
      "26 89 87 {contactAngle:16} 8b 46 ?? 3b 46 ?? 7e ?? 8b 46 ?? 3b 46 ?? 7e ?? eb ?? 8b 46 ?? 3b 46 ?? 7e ?? " +
      "c4 1e {_part:16} 26 c6 87 ?? ?? 01 eb ?? c4 1e {_part:16} 26 c6 87 ?? ?? 01 c4 1e {_part:16} 8b 46 {_index} 48 " +
      "26 89 87 {contactEdge:16} c7 46 ?? 01 00 ff 46 {_index} c4 1e {_other:16} 26 8b 87 {outlinePointCount:16} " +
      "3b 46 {_index}",
    assumption: CONTACT,
  },
  {
    // 0x237bd, where a part's state takes a step (0x2374c).
    routine: "state step",
    bytes: "c4 5e 06 26 8b 47 {stateDelta} 26 01 47 {state}",
    assumption: STATE_DELTA,
  },
];

/** TOONS.EXE's forms. A part is a near pointer, as in TIM.EXE, with other offsets. */
export const TOONS_FIELD_FORMS: readonly FieldForm[] = [
  {
    // 0x61f7 in the frame position helper (0x61e9), after it calls the frame size helper (0x6212).
    routine: "frame position helper",
    bytes:
      "8b 44 {positionY} 8b 54 {positionX} 89 44 {drawY} 89 54 {drawX} 8b 44 {frameOffsetX} 01 44 {drawX} " +
      "8b 44 {frameOffsetY} 01 44 {drawY}",
    assumption: FRAME_POSITION,
  },
  {
    // 0x6340 in the frame size helper (0x6212): the frame's offset by the state, reflected by the flags.
    routine: "frame offset in the frame size helper",
    bytes:
      "f7 45 {drawingFlags} 10 00 74 ?? 8b 45 {horizontalExtent} 2b c1 2b 45 {frameWidth} 89 45 {frameOffsetX} " +
      "83 7d {type} ?? 74 ?? 83 7d {type} ?? 74 ?? 8b 45 {frameOffsetX} 2b c1 89 45 ?? eb ?? 89 4d {frameOffsetX} " +
      "c4 5e ?? 26 c4 5f ?? 8b 45 {state} d1 e0 03 d8 26 8a 47 01 98 8b c8 f7 45 {drawingFlags} 20 00 74 ?? " +
      "8b 45 {verticalExtent} 2b c1 2b 45 {frameHeight} 89 45 {frameOffsetY}",
    assumption: FRAME_POSITION,
    masks: FLIP_MASKS,
  },
  {
    // 0x624d in the frame size helper (0x6212): a part drawn as tiles (bit 0x40 of the word at 0x06), and types 0
    // and 40, take their stored size as the frame size.
    routine: "stored size in the frame size helper",
    bytes:
      "f7 45 ?? 40 00 75 ?? 83 7e ?? 00 74 ?? 83 7e ?? 28 75 ?? 8b 45 {baseWidth} 89 45 {frameWidth} " +
      "8b 45 {baseHeight} 89 45 {frameHeight}",
    assumption: FRAME_SIZE,
  },
  {
    // 0x7b50 in the motion helper (0x7b3f).
    routine: "motion helper",
    bytes:
      "8b 44 {positionX} 2b 44 {previousX} 89 44 {velocityX} b1 09 2a 4e ?? d3 64 {velocityX} f7 c7 02 00 74 ?? " +
      "8b 44 {positionY} 2b 44 {previousY} 89 44 {velocityY} b1 09 2a 4e ?? d3 64 {velocityY}",
    assumption: MOTION,
  },
  {
    // 0x88c4 in the history update (0x88bc).
    routine: "history update",
    bytes:
      "8b 44 {previousY} 8b 54 {previousX} 89 44 ?? 89 54 ?? 8b 44 {positionY} 8b 54 {positionX} " +
      "89 44 {previousY} 89 54 {previousX} 8b 44 ?? 8b 54 ?? 89 44 ?? 89 54 ?? 8b 44 {drawY} 8b 54 {drawX} " +
      "89 44 ?? 89 54 ?? 8b 44 ?? 8b 54 ?? 89 44 ?? 89 54 ?? 8b 44 {frameHeight} 8b 54 {frameWidth} " +
      "89 44 ?? 89 54 ?? 8b 44 {previousState} 89 44 {olderState} 8b 44 {state} 89 44 {previousState}",
    assumption: HISTORY,
  },
  {
    // 0x1fa7 in the contact producer (0x1c51): the part it moves is the word at {_part}, the other at {_other}.
    routine: "contact producer",
    bytes:
      "8b 1e {_part:16} a1 {_other:16} 89 87 {contactPart:16} 8b c7 05 00 80 8b 1e {_part:16} " +
      "89 87 {contactAngle:16} 8b 46 ?? 3b 46 ?? 7e ?? 8b 46 ?? 3b 46 ?? 7e ?? 8b 1e {_part:16} c6 87 ?? ?? 01 eb ?? " +
      "8b 1e {_part:16} c6 87 ?? ?? 01 eb ?? 8b 46 ?? 3b 46 ?? 7e ?? 8b 1e {_part:16} c6 87 ?? ?? 01 eb ?? " +
      "8b 1e {_part:16} c6 87 ?? ?? 01 8b 46 {_index} 48 8b 1e {_part:16} 89 87 {contactEdge:16} c7 46 ?? 01 00 " +
      "ff 46 {_index} 8b 1e {_other:16} 8b 87 {outlinePointCount:16} 3b 46 {_index}",
    assumption: CONTACT,
  },
];
