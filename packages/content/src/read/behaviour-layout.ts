/** Verifies the callback table dispatch and the object fields that the drawing code consumes. */
import { decodeInstruction, type CodeAddress, type Instruction } from "./x86.ts";
import { TIM_PROFILE, type BehaviourProfile } from "./behaviour-program.ts";
import { discoverObjectFieldRoles } from "./behaviour-fields.ts";
import { findDataSegment } from "./type-table.ts";
import { instructionEvidence, matchesInstructions, type TimingEvidence } from "./behaviour-timing.ts";
import { wordAt } from "./behaviour-terms.ts";

export interface LayoutFact {
  confidence: "checked" | "inferred" | "unresolved";
  evidence: TimingEvidence[];
  assumptions: string[];
}

export interface FieldContext extends LayoutFact {
  partType?: number;
  routine: number;
  name: string;
  description: string;
}

export interface LayoutField extends LayoutFact {
  offset: number;
  name: string;
  description?: string;
  masks?: { value: number; name: string }[];
  contexts?: FieldContext[];
}

export interface CallbackObjectSource extends LayoutFact {
  argumentOffset: number;
  path: number[];
  argumentRole: "owner" | "collider";
}

export interface CallbackLayout extends LayoutFact {
  field: number;
  role: string;
  sites: number[];
  objectSource?: CallbackObjectSource;
}

export interface BehaviourLayout {
  callbacks: CallbackLayout[];
  objectArgument: LayoutFact & { offset?: number };
  fields: LayoutField[];
  diagnostics: string[];
}

/** What the layout discovery is told about the program besides its image, the table and the number of types. */
export interface LayoutOptions {
  /** The game's profile; TIM.EXE's when not given. */
  profile?: BehaviourProfile;
  /** Where each type's record starts, by type; the table's start plus the type times the record size when not given. */
  records?: number[];
  /** Where a far pointer to a routine leads; the pointer itself when not given. */
  routine?: (segment: number, offset: number) => CodeAddress;
}

/** The six callbacks of TIM.EXE's record, in the order they follow each other. */
const CALLBACK_ROLES = ["bounce", "run", "reset", "flip", "resize", "rope"];

/**
 * The record size and the table address come from the already discovered type table. Callback labels describe
 * candidate roles; the indirect calls prove which record fields are code pointers, not their full event semantics.
 */
export function discoverBehaviourLayout(
  image: Uint8Array,
  table: number,
  typeCount?: number,
  options: LayoutOptions = {},
): BehaviourLayout {
  const profile = options.profile ?? TIM_PROFILE;
  const size = profile.recordSize;
  const result: BehaviourLayout = {
    callbacks: [],
    fields: [],
    diagnostics: [],
    objectArgument: {
      confidence: "unresolved",
      evidence: [],
      assumptions: ["No object argument convention has been established."],
    },
  };
  const dispatches = new Map<number, number[]>();
  const windows = new Map<number, { start: number; end: number; push: number }>();
  /** The type field each pointer-table dispatch reads the part's type from, by site. */
  const typeReads = new Map<number, number>();
  const tableOffset = table - findDataSegment(image) * 16;
  const tableSegments = segmentsOfTable(image, table, size);
  for (let at = 12; at + 5 <= image.length; at++) {
    let field: number;
    let start: number;
    let end: number;
    if (profile.recordLookup === "pointer-table") {
      // les bx, part; mov bx, es:[bx+type]; add bx, bx; mov bx, [bx+table]; call far [bx+field]
      const lookup = at - 6;
      if (
        !matchesInstructions(image, lookup, [0x03, 0xdb, 0x8b, 0x9f, tableOffset & 0xff, tableOffset >> 8, 0xff]) ||
        ![0x1f, 0x5f, 0x9f].includes(image[at + 1]!)
      )
        continue;
      const mode = image[at + 1]!;
      field = mode === 0x1f ? 0 : mode === 0x5f ? image[at + 2]! : wordAt(image, at + 2);
      const typeRead = matchesInstructions(image, lookup - 4, [0x26, 0x8b, 0x5f, null]);
      start = typeRead ? lookup - 4 : lookup;
      end = at + (mode === 0x1f ? 2 : mode === 0x5f ? 3 : 4);
      if (typeRead) typeReads.set(at, image[lookup - 1]!);
    } else if (
      matchesInstructions(image, at, [0x26, 0xff, 0x9f, null, null]) &&
      matchesInstructions(image, at - 12, [0xba, size, 0, 0xf7, 0xea, 0xba, null, null, 0x8b, 0xd8, 0x8e, 0xc2]) &&
      (wordAt(image, at - 6) * 16 === table || tableSegments.has(wordAt(image, at - 6)))
    ) {
      // The table can start at an offset of its own segment; the displacement is that offset plus the field.
      field = wordAt(image, at + 3) - (table - wordAt(image, at - 6) * 16);
      start = at - 12;
      end = at + 5;
    } else if (
      matchesInstructions(image, at, [0xff, 0x9f, null, null]) &&
      matchesInstructions(image, at - 7, [0xba, size, 0, 0xf7, 0xea, 0x8b, 0xd8])
    ) {
      field = wordAt(image, at + 2) - tableOffset;
      start = at - 7;
      end = at + 4;
    } else continue;
    if (field < 0 || field + 4 > size) continue;
    windows.set(at, { start, end, push: start - 4 });
    dispatches.set(field, [...(dispatches.get(field) ?? []), at]);
  }
  const found = [...dispatches.keys()].sort((a, b) => a - b);
  const roles = [...CALLBACK_ROLES, ...profile.otherRoutines];
  // The roles are named by their order only when the slots are next to each other.
  const contiguous = found.length === roles.length && found.every((f, i) => i === 0 || f === found[i - 1]! + 4);
  if (!contiguous) {
    result.diagnostics.push(
      `Expected ${roles.length} contiguous far callback fields dispatched through the discovered table; found ${found.map((f) => `0x${f.toString(16)}`).join(", ") || "none"}.`,
    );
  }
  const fields = contiguous ? found.slice(0, CALLBACK_ROLES.length) : found;
  if (contiguous && profile.otherRoutines.length)
    result.diagnostics.push(
      `The record's routines after the six callbacks are not read: ${profile.otherRoutines.map((role, i) => `${role} at +0x${found[CALLBACK_ROLES.length + i]!.toString(16)}`).join(", ")}.`,
    );
  fields.forEach((field, index) => {
    const sites = dispatches.get(field)!;
    result.callbacks.push({
      field,
      role: contiguous ? roles[index]! : `callback at record +0x${field.toString(16)}`,
      sites,
      confidence: "inferred",
      evidence: sites.flatMap((at) => instructionEvidence(image, windows.get(at)!.start, windows.get(at)!.end)),
      assumptions: [
        `The ${size}-byte table indexed by the caller is the discovered part type table.`,
        "The traditional callback role is a candidate name based on dispatcher context; its complete event semantics are not established by the indirect call alone.",
      ],
    });
  });
  if (profile.partPointer === "far") {
    discoverFarPartLayout(image, result, windows, typeReads, options);
    return result;
  }
  const run = result.callbacks.find((c) => c.role === "run");
  if (run) {
    const passed = run.sites.filter((at) =>
      matchesInstructions(image, windows.get(at)!.push, [0x56, 0x8b, 0x44, null]),
    );
    const typeOffsets = new Set(
      passed.map((at) => {
        const displacement = image[windows.get(at)!.push + 3]!;
        return displacement > 127 ? displacement - 256 : displacement;
      }),
    );
    if (typeOffsets.size === 1)
      result.fields.push({
        offset: [...typeOffsets][0]!,
        name: "type",
        confidence: "checked",
        evidence: passed.flatMap((at) => instructionEvidence(image, windows.get(at)!.push, windows.get(at)!.end)),
        assumptions: [],
      });
    else if (typeOffsets.size > 1)
      result.diagnostics.push("The run dispatchers disagree about the object's type field.");
    if (passed.length)
      result.objectArgument = {
        offset: 6,
        confidence: "inferred",
        evidence: passed.flatMap((at) => instructionEvidence(image, windows.get(at)!.push, windows.get(at)!.end)),
        assumptions: [
          "A far call pushes a four-byte return address; after push bp; mov bp,sp, the caller's pushed object word is [bp+6].",
          "This establishes the run dispatcher convention. Other callbacks and helper routines must track their own arguments.",
          "The pushed SI and the SI used to obtain the type number identify the same part object in DS.",
        ],
      };
  }
  // The position array is a checked record field. The renderer uses a cached object word to index its byte pairs.
  for (let at = 0; at + 18 < image.length; at++) {
    const farTable = image[at] === 0x26;
    const offset = farTable ? 1 : 0;
    if (
      !matchesInstructions(image, at + offset, [
        0x8b,
        0x47,
        0x18,
        0x8b,
        0xf8,
        0x0b,
        0xc0,
        0x74,
        null,
        0x8b,
        0x46,
        null,
        0xd1,
        0xe0,
        0x03,
        0xf8,
      ])
    )
      continue;
    if (!farTable && image[at - 1] === 0x26) continue;
    const cache = image[at + offset + 11]!;
    let stateLoad = -1;
    let tableReference = -1;
    let tableReferenceSize = 0;
    for (let p = Math.max(0, at - 100); p < at; p++) {
      if (
        farTable &&
        matchesInstructions(image, p, [0xc7, 0x46, null, null, null]) &&
        wordAt(image, p + 3) * 16 === table
      ) {
        tableReference = p;
        tableReferenceSize = 5;
      }
      if (
        !farTable &&
        matchesInstructions(image, p, [0xba, size, 0, 0xf7, 0xea, 0x05, null, null]) &&
        wordAt(image, p + 6) === tableOffset
      ) {
        tableReference = p;
        tableReferenceSize = 8;
      }
      if (matchesInstructions(image, p, [0x8b, 0x44, null, 0x89, 0x46, cache])) stateLoad = p;
    }
    if (stateLoad < 0 || tableReference < 0) continue;
    const stateOffset = image[stateLoad + 2]!;
    const evidence = [
      ...instructionEvidence(image, tableReference, tableReference + tableReferenceSize),
      ...instructionEvidence(image, stateLoad, stateLoad + 6),
      ...instructionEvidence(image, at, at + offset + 16),
    ];
    if (!result.fields.some((f) => f.name === "state"))
      result.fields.push({
        offset: stateOffset,
        name: "state",
        confidence: "checked",
        evidence,
        assumptions: [],
      });
    // Both tests branch between adding a frame offset and subtracting it from the object's corresponding extent.
    for (let p = at + offset + 16; p < Math.min(image.length - 21, at + 90); p++) {
      if (
        !matchesInstructions(image, p, [
          0xf7,
          0x46,
          null,
          0x10,
          0x00,
          0x74,
          null,
          0x8a,
          0x05,
          0x98,
          0x8b,
          0x54,
          null,
          0x2b,
          0xd0,
          0x2b,
          0x54,
          null,
          0x01,
          0x54,
          null,
        ])
      )
        continue;
      const flagCache = image[p + 2]!;
      for (let q = stateLoad + 6; q < at; q++) {
        if (!matchesInstructions(image, q, [0x8b, 0x44, null, 0x89, 0x46, flagCache])) continue;
        const flagOffset = image[q + 2]!;
        const flagEvidence = [
          ...evidence,
          ...instructionEvidence(image, q, q + 6),
          ...instructionEvidence(image, p, p + 21),
        ];
        if (!result.fields.some((f) => f.name === "drawingFlags"))
          result.fields.push({
            offset: flagOffset,
            name: "drawingFlags",
            confidence: "inferred",
            evidence: flagEvidence,
            masks: [{ value: 0x10, name: "horizontalFlip" }],
            assumptions: [
              "The two coordinate branches implement reflection relative to the object's horizontal extent.",
            ],
          });
        for (const [index, name] of [
          [12, "horizontalExtent"],
          [17, "frameWidth"],
          [20, "drawX"],
        ] as const) {
          if (!result.fields.some((f) => f.name === name))
            result.fields.push({
              offset: image[p + index]!,
              name,
              confidence: "inferred",
              evidence: flagEvidence,
              assumptions: [
                "The field participates in horizontal reflection of the checked frame position: extent minus offset minus frame width, added to the drawing origin.",
              ],
            });
        }
        for (let v = p + 21; v < Math.min(image.length - 22, p + 60); v++) {
          if (
            !matchesInstructions(image, v, [
              0xf7,
              0x46,
              flagCache,
              0x20,
              0x00,
              0x74,
              null,
              0x8a,
              0x45,
              0x01,
              0x98,
              0x8b,
              0x54,
              null,
              0x2b,
              0xd0,
              0x2b,
              0x54,
              null,
              0x01,
              0x54,
              null,
            ])
          )
            continue;
          const flags = result.fields.find((f) => f.name === "drawingFlags")!;
          flags.masks!.push({ value: 0x20, name: "verticalFlip" });
          flags.evidence.push(...instructionEvidence(image, v, v + 22));
          for (const [index, name] of [
            [13, "verticalExtent"],
            [18, "frameHeight"],
            [21, "drawY"],
          ] as const) {
            if (!result.fields.some((f) => f.name === name))
              result.fields.push({
                offset: image[v + index]!,
                name,
                confidence: "inferred",
                evidence: [...flagEvidence, ...instructionEvidence(image, v, v + 22)],
                assumptions: [
                  "The field participates in vertical reflection of the checked frame position: extent minus offset minus frame height, added to the drawing origin.",
                ],
              });
          }
        }
      }
    }
  }
  if (!result.fields.some((f) => f.name === "state")) discoverFarRecordState(image, table, size, result);
  const flags = result.fields.find((f) => f.name === "drawingFlags");
  if (flags) {
    for (let at = 0; at + 21 < image.length; at++) {
      const farPieces = matchesInstructions(image, at, [
        0xf7,
        0x44,
        flags.offset,
        null,
        null,
        0x74,
        null,
        0xc4,
        0x5e,
        null,
        0x26,
        0x8b,
        0x5f,
        0x16,
        0x8b,
        0x46,
        null,
        0xd1,
        0xe0,
        0x03,
        0xd8,
      ]);
      const nearPieces = matchesInstructions(image, at, [
        0xf7,
        0x44,
        flags.offset,
        null,
        null,
        0x74,
        null,
        0x8b,
        0x46,
        null,
        0xd1,
        0xe0,
        0x8b,
        0x5e,
        null,
        0x8b,
        0x5f,
        0x16,
        0x03,
        0xd8,
      ]);
      if (!farPieces && !nearPieces) continue;
      flags.masks!.push({ value: wordAt(image, at + 3), name: "drawFromPieces" });
      flags.evidence.push(...instructionEvidence(image, at, at + (farPieces ? 21 : 20)));
      flags.assumptions.push(
        "The tested drawing flag selects the checked record field +0x16 containing linked frame pieces.",
      );
    }
  }
  const state = result.fields.find((f) => f.name === "state");
  if (state) {
    const snapshots = new Map<number, TimingEvidence[]>();
    const deltas = new Map<number, TimingEvidence[]>();
    for (let at = 0; at + 6 <= image.length; at++) {
      if (matchesInstructions(image, at, [0x8b, 0x44, state.offset, 0x89, 0x44, null])) {
        const destination = image[at + 5]!;
        snapshots.set(destination, [...(snapshots.get(destination) ?? []), ...instructionEvidence(image, at, at + 6)]);
      }
      if (matchesInstructions(image, at, [0x8b, 0x44, null, 0x01, 0x44, state.offset])) {
        const source = image[at + 2]!;
        deltas.set(source, [...(deltas.get(source) ?? []), ...instructionEvidence(image, at, at + 6)]);
      }
    }
    const repeatedSnapshots = [...snapshots].filter(([, evidence]) => evidence.length >= 4);
    if (repeatedSnapshots.length === 1)
      result.fields.push({
        offset: repeatedSnapshots[0]![0],
        name: "previousState",
        confidence: "inferred",
        evidence: repeatedSnapshots[0]![1],
        assumptions: [
          "The repeated copies of the current state retain a state snapshot. The complete refresh lifecycle has not been established.",
        ],
      });
    if (deltas.size === 1)
      result.fields.push({
        offset: [...deltas.keys()][0]!,
        name: "stateDelta",
        confidence: "inferred",
        evidence: [...deltas.values()][0]!,
        assumptions: [
          "The field is added to the state in the matched routines; its producers and its meanings in other part types require separate analysis.",
        ],
      });
  }
  if (!result.fields.some((f) => f.name === "state"))
    result.diagnostics.push("Could not link an object field to the checked frame position array in drawing code.");
  if (!flags) result.diagnostics.push("Could not identify drawing flag tests and reflected coordinates.");
  const previousState = result.fields.find((field) => field.name === "previousState");
  if (state && previousState)
    for (let at = 0; at + 12 <= image.length; at++) {
      if (
        !matchesInstructions(image, at, [
          0x8b,
          0x44,
          previousState.offset,
          0x89,
          0x44,
          null,
          0x8b,
          0x44,
          state.offset,
          0x89,
          0x44,
          previousState.offset,
        ])
      )
        continue;
      const offset = image[at + 5]!;
      if (offset === state.offset || offset === previousState.offset) continue;
      if (!result.fields.some((field) => field.name === "olderState"))
        result.fields.push({
          offset,
          name: "olderState",
          confidence: "inferred",
          evidence: instructionEvidence(image, at, at + 12),
          description:
            "Receives the previous state snapshot immediately before the current state replaces that snapshot.",
          assumptions: [
            "The paired assignments prove a two-stage state history update; when the engine calls the history updater is a separate scheduling question.",
          ],
        });
    }
  const descriptions: Record<string, string> = {
    type: "The number used to select this object's record in the checked type table.",
    state: "The object's state selects the visual frame through the checked frame placement array.",
    previousState:
      "A snapshot of the current state retained by repeated copies; its refresh schedule requires separate engine evidence.",
    stateDelta:
      "A value added to the state in matched routines, with producers and meanings that can differ between parts.",
    drawingFlags:
      "Bits consumed by reflection and piece drawing branches; each named mask has separate instruction evidence.",
    horizontalExtent: "The horizontal extent used to reflect a frame offset before adding the drawing origin.",
    verticalExtent: "The vertical extent used to reflect a frame offset before adding the drawing origin.",
    frameWidth: "The current frame width subtracted by horizontal reflection arithmetic.",
    frameHeight: "The current frame height subtracted by vertical reflection arithmetic.",
    drawX: "The horizontal drawing origin adjusted by the frame's placement offset.",
    drawY: "The vertical drawing origin adjusted by the frame's placement offset.",
  };
  for (const field of result.fields) field.description ??= descriptions[field.name];
  const typeField = result.fields.find((field) => field.name === "type");
  if (typeField)
    for (const callback of result.callbacks) {
      const sources: { path: number[]; evidence: TimingEvidence[] }[] = [];
      for (const site of callback.sites) {
        const window = windows.get(site)!;
        for (let start = Math.max(0, window.start - 16); start < window.start; start++) {
          const sequence: Instruction[] = [];
          let position = start;
          try {
            while (position < window.start && sequence.length < 4) {
              const instruction = decodeInstruction(image, position, Math.floor(position / 0x10000) * 0x1000);
              sequence.push(instruction);
              position += instruction.size;
            }
          } catch {
            continue;
          }
          if (
            position !== window.start ||
            sequence[0]?.mnemonic !== "push" ||
            sequence[0].operands[0]?.kind !== "register"
          )
            continue;
          const argument = sequence[0].operands[0].name;
          const typeLoad = sequence.at(-1)!;
          const typeOperand = typeLoad.operands[1];
          if (
            typeLoad.mnemonic !== "mov" ||
            typeLoad.operands[0]?.kind !== "register" ||
            typeLoad.operands[0].name !== "ax" ||
            typeOperand?.kind !== "memory" ||
            typeOperand.segment !== "ds" ||
            typeOperand.base.length !== 1 ||
            typeOperand.displacement !== typeField.offset
          )
            continue;
          let path: number[];
          if (sequence.length === 2 && typeOperand.base[0] === argument) path = [];
          else if (sequence.length === 3) {
            const related = sequence[1]!;
            const relatedOperand = related.operands[1];
            if (
              related.mnemonic !== "mov" ||
              related.operands[0]?.kind !== "register" ||
              related.operands[0].name !== typeOperand.base[0] ||
              relatedOperand?.kind !== "memory" ||
              relatedOperand.segment !== "ds" ||
              relatedOperand.base.join() !== argument
            )
              continue;
            path = [relatedOperand.displacement];
          } else continue;
          sources.push({
            path,
            evidence: [
              ...sequence.map(({ address, bytes, text }) => ({ address, bytes, text })),
              ...instructionEvidence(image, window.start, window.end),
            ],
          });
          break;
        }
      }
      setObjectSource(callback, sources, result.diagnostics, "near");
    }
  if (typeCount !== undefined && result.callbacks.length === 6 && result.fields.some((field) => field.name === "state"))
    result.fields.push(
      ...discoverObjectFieldRoles(image, table, typeCount, result.callbacks, result.fields, {
        records: options.records,
        recordSize: size,
        routine: options.routine,
      }),
    );
  return result;
}

/**
 * The state field when the frame drawing reaches the type's record through a far pointer it builds from the table, as
 * TOONS.EXE does: it keeps the state in a local, builds the record's far pointer (`imul` by the record size, `add ax,
 * offset`, the table's segment), takes the far pointer of the frame positions from the record, and when there is one
 * adds twice the state to it. Then a test of the drawing flags picks the record's frame pieces at four times the state.
 */
function discoverFarRecordState(image: Uint8Array, table: number, size: number, result: BehaviourLayout) {
  for (let at = 0; at + 27 <= image.length; at++) {
    // les bx, [bp+record]; mov ax, es:[bx+positions+2]; mov dx, es:[bx+positions]; mov [bp+high], ax;
    // mov [bp+low], dx; or dx, ax; je; mov ax, [bp+state]; shl ax, 1; add [bp+low], ax
    if (
      !matchesInstructions(image, at, [
        0xc4,
        0x5e,
        null,
        0x26,
        0x8b,
        0x47,
        null,
        0x26,
        0x8b,
        0x57,
        null,
        0x89,
        0x46,
        null,
        0x89,
        0x56,
        null,
        0x0b,
        0xd0,
        0x74,
        null,
        0x8b,
        0x46,
        null,
        0xd1,
        0xe0,
        0x01,
        0x46,
      ])
    )
      continue;
    const record = image[at + 2]!;
    const positions = image[at + 10]!;
    const low = image[at + 16]!;
    const cache = image[at + 23]!;
    if (image[at + 6] !== positions + 2 || image[at + 13] !== ((low + 2) & 0xff) || image[at + 28] !== low) continue;
    let built = -1;
    let stateLoad = -1;
    for (let p = Math.max(0, at - 60); p < at; p++) {
      // mov dx, size; imul dx; add ax, offset; mov word [bp+record+2], segment; mov [bp+record], ax
      if (
        matchesInstructions(image, p, [0xba, size, 0, 0xf7, 0xea, 0x05, null, null, 0xc7, 0x46, (record + 2) & 0xff]) &&
        matchesInstructions(image, p + 13, [0x89, 0x46, record]) &&
        wordAt(image, p + 11) * 16 + wordAt(image, p + 6) === table
      )
        built = p;
      if (matchesInstructions(image, p, [0x8b, 0x44, null, 0x89, 0x46, cache])) stateLoad = p;
    }
    if (built < 0 || stateLoad < 0 || stateLoad > built) continue;
    const evidence = [
      ...instructionEvidence(image, stateLoad, stateLoad + 6),
      ...instructionEvidence(image, built, built + 16),
      ...instructionEvidence(image, at, at + 29),
    ];
    result.fields.push({
      offset: image[stateLoad + 2]!,
      name: "state",
      confidence: "checked",
      evidence,
      assumptions: [],
    });
    // test word [si+flags], mask; je; les bx, [bp+record]; les bx, es:[bx+pieces]; mov ax, [bp+state]; shl ax, 1;
    // shl ax, 1; add bx, ax
    for (let p = at + 29; p < Math.min(image.length - 22, at + 60); p++) {
      if (
        !matchesInstructions(image, p, [
          0xf7,
          0x44,
          null,
          null,
          null,
          0x74,
          null,
          0xc4,
          0x5e,
          record,
          0x26,
          0xc4,
          0x5f,
          null,
          0x8b,
          0x46,
          cache,
          0xd1,
          0xe0,
          0xd1,
          0xe0,
          0x03,
          0xd8,
        ])
      )
        continue;
      result.fields.push({
        offset: image[p + 2]!,
        name: "drawingFlags",
        confidence: "inferred",
        evidence: instructionEvidence(image, p, p + 23),
        masks: [{ value: wordAt(image, p + 3), name: "drawFromPieces" }],
        assumptions: [
          `The tested drawing flag selects the checked record field +0x${image[p + 13]!.toString(16)} containing linked frame pieces.`,
        ],
      });
      break;
    }
    return;
  }
}

type OwnerSource = { path: number[]; evidence: TimingEvidence[] };

/**
 * Sets which object owns a callback from what each of its calls pushes and whose type picks the record, when every
 * call says the same. TOONS.EXE and TIM2.EXE also call the bounce callback of the part itself, besides that of the part
 * it touches; the reader then reads the calls for the touched part and says which calls it leaves out.
 */
function setObjectSource(
  callback: CallbackLayout,
  sources: OwnerSource[],
  diagnostics: string[],
  pointer: "near" | "far",
): void {
  const linked = sources.filter((source) => source.path.length);
  const own = sources.filter((source) => !source.path.length);
  const touchedOnly =
    callback.role === "bounce" &&
    sources.length === callback.sites.length &&
    linked.length &&
    own.length &&
    linked.every((source) => source.path.join() === linked[0]!.path.join());
  if (
    sources.length === callback.sites.length &&
    (touchedOnly || sources.every((source) => source.path.join() === sources[0]!.path.join()))
  ) {
    const read = touchedOnly ? linked : sources;
    const path = read[0]!.path;
    callback.objectSource = {
      argumentOffset: 6,
      path,
      argumentRole: path.length ? "collider" : "owner",
      confidence: "inferred",
      evidence: read.flatMap((source) => source.evidence),
      assumptions: [
        pointer === "near"
          ? "A pushed near object pointer is the first argument of a far callback, at [bp+6] after the standard frame prologue."
          : "A pushed far object pointer, segment then offset, is the first argument of a far callback, its offset at [bp+6] and its segment at [bp+8] after the standard frame prologue.",
        path.length
          ? "The callback owner is selected by the type of the related object, while the interacting collider is passed to the callback."
          : "The callback owner is the same object whose pointer is pushed and whose type indexes the record table.",
        ...(touchedOnly
          ? [
              `The callback is also called with the part itself as its owner (${own.map((source) => `0x${source.evidence.at(-1)!.address.toString(16)}`).join(", ")}); those calls are not read.`,
            ]
          : []),
      ],
    };
  } else if (sources.length)
    diagnostics.push(`Callback ${callback.role} has incomplete or inconsistent owner-argument evidence.`);
}

/** The instruction that ends exactly at `end`, the longest of those of the given mnemonics, if any. */
function instructionEndingAt(image: Uint8Array, end: number, mnemonics: string[]): Instruction | undefined {
  for (let size = 6; size >= 1; size--) {
    const at = end - size;
    if (at < 0) continue;
    try {
      const instruction = decodeInstruction(image, at, Math.floor(at / 0x10000) * 0x1000);
      if (instruction.size === size && mnemonics.includes(instruction.mnemonic)) return instruction;
    } catch {
      // Not an instruction from here.
    }
  }
  return undefined;
}

/**
 * The layout of a program whose routines get their part as a far pointer, as TIM2.EXE's do. Each call of a callback
 * pushes the part (segment, then offset), may load a related part with `les bx`, and reads the type through `es`
 * (`mov bx, es:[bx+type]`) before it looks the record up. The state is the field the draw routine hands on to the
 * animation routine, which checks it against the animation's count and indexes the animation's steps with it.
 */
function discoverFarPartLayout(
  image: Uint8Array,
  result: BehaviourLayout,
  windows: Map<number, { start: number; end: number; push: number }>,
  typeReads: Map<number, number>,
  options: LayoutOptions,
): void {
  // Some calls have the type in a register already; those that read it must agree.
  const sites = result.callbacks.flatMap((callback) => callback.sites).filter((site) => typeReads.has(site));
  const types = new Set(sites.map((site) => typeReads.get(site)));
  if (types.size !== 1) {
    result.diagnostics.push("The callback calls disagree about the part's type field, or none reads it.");
    return;
  }
  const typeOffset = [...types][0]!;
  result.fields.push({
    offset: typeOffset,
    name: "type",
    description: "The number used to select this object's record in the checked type table.",
    confidence: "checked",
    evidence: sites.flatMap((site) => instructionEvidence(image, windows.get(site)!.start, windows.get(site)!.end)),
    assumptions: [],
  });
  /** What a call pushes before it reads the type: two words and maybe a `les bx` that loads a related part. */
  const pushed = (site: number): OwnerSource | undefined => {
    const window = windows.get(site)!;
    if (!typeReads.has(site)) return undefined;
    const load = instructionEndingAt(image, window.start, ["les"]);
    const second = instructionEndingAt(image, load ? load.address : window.start, ["push"]);
    const first = second && instructionEndingAt(image, second.address, ["push"]);
    if (!first || !second) return undefined;
    const source = load?.operands[1];
    let path: number[] = [];
    if (source?.kind === "memory" && source.segment === "es" && source.base.join() === "bx")
      path = [source.displacement];
    else if (load && (source?.kind !== "memory" || source.segment !== "ss")) return undefined;
    const sequence = [first, second, ...(load ? [load] : [])];
    return {
      path,
      evidence: [
        ...sequence.map(({ address, bytes, text }) => ({ address, bytes, text })),
        ...instructionEvidence(image, window.start, window.end),
      ],
    };
  };
  const run = result.callbacks.find((callback) => callback.role === "run");
  const runSources = run?.sites.map(pushed) ?? [];
  if (runSources.length && runSources.every((source) => source && !source.path.length))
    result.objectArgument = {
      offset: 6,
      confidence: "inferred",
      evidence: runSources.flatMap((source) => source!.evidence),
      assumptions: [
        "A far call pushes a four-byte return address; after push bp; mov bp,sp, the caller's pushed far object pointer has its offset at [bp+6] and its segment at [bp+8].",
        "This establishes the run dispatcher convention. Other callbacks and helper routines must track their own arguments.",
        "The pushed pointer and the pointer used to obtain the type number identify the same part object.",
      ],
    };
  for (const callback of result.callbacks) {
    const sources = callback.sites.map(pushed).filter((source): source is OwnerSource => !!source);
    setObjectSource(callback, sources, result.diagnostics, "far");
  }
  const state = farPartState(image, typeOffset, options);
  if (state) result.fields.push(state);
  else result.diagnostics.push("Could not link an object field to the animation step the draw routine shows.");
}

/**
 * The state of a far part, from the routine most records point to for drawing (the record's routine after the six
 * callbacks and the set-up one before it): `les bx, [bp+6]; mov di, es:[bx+type]; mov ax, es:[bx+state]; mov [bp+n],
 * ax`, then `push word [bp+n]`, one more push and a far call to a routine that takes its second argument
 * (`mov di, [bp+8]`), checks it against a count (`cmp es:[bx+m], di; ja`) and indexes a table of words with it (`mov
 * ax, di; add ax, ax; add bx, ax`).
 */
function farPartState(image: Uint8Array, typeOffset: number, options: LayoutOptions): LayoutField | undefined {
  const { records, routine, profile } = options;
  const draw = profile?.otherRoutines.indexOf("draw") ?? -1;
  if (!records || !routine || draw < 0) return undefined;
  const field = 4 * (CALLBACK_ROLES.length + draw);
  const uses = new Map<number, { count: number; address: number }>();
  for (const record of records) {
    const target = routine(wordAt(image, record + field + 2), wordAt(image, record + field));
    const use = uses.get(target.address) ?? { count: 0, address: target.address };
    use.count++;
    uses.set(target.address, use);
  }
  const shared = [...uses.values()].sort((a, b) => b.count - a.count)[0];
  if (!shared) return undefined;
  const start = shared.address;
  for (let at = start; at < start + 0x40 && at + 14 <= image.length; at++) {
    if (
      !matchesInstructions(image, at, [
        0xc4,
        0x5e,
        0x06,
        0x26,
        0x8b,
        0x7f,
        typeOffset,
        0x26,
        0x8b,
        0x47,
        null,
        0x89,
        0x46,
      ])
    )
      continue;
    const offset = image[at + 10]!;
    const local = image[at + 13]!;
    for (let p = at + 14; p < start + 0x200 && p + 12 <= image.length; p++) {
      if (!matchesInstructions(image, p, [0xff, 0x76, local, 0xff, 0x76, null, 0x9a])) continue;
      const callee = wordAt(image, p + 9) * 16 + wordAt(image, p + 7);
      const index = findBoundedIndex(image, callee);
      if (!index) continue;
      return {
        offset,
        name: "state",
        description: "The object's state selects the animation step the draw routine shows.",
        confidence: "checked",
        evidence: [...instructionEvidence(image, at, at + 14), ...instructionEvidence(image, p, p + 11), ...index],
        assumptions: [],
      };
    }
  }
  return undefined;
}

/**
 * The evidence that a routine takes its second argument as an index that it checks against a count and then uses to
 * pick a word of a table: `mov di, [bp+8]`, `cmp es:[bx+m], di; ja`, and `mov ax, di; add ax, ax; add bx, ax`.
 */
function findBoundedIndex(image: Uint8Array, start: number): TimingEvidence[] | undefined {
  if (!matchesInstructions(image, start, [0x55, 0x8b, 0xec])) return undefined;
  let load = -1;
  let check = -1;
  for (let at = start; at < start + 0x80 && at + 6 <= image.length; at++) {
    if (load < 0 && matchesInstructions(image, at, [0x8b, 0x7e, 0x08])) load = at;
    if (load >= 0 && check < 0 && matchesInstructions(image, at, [0x26, 0x39, 0x7f, null, 0x77])) check = at;
    if (check >= 0 && matchesInstructions(image, at, [0x8b, 0xc7, 0x03, 0xc0, 0x03, 0xd8]))
      return [
        ...instructionEvidence(image, load, load + 3),
        ...instructionEvidence(image, check, check + 6),
        ...instructionEvidence(image, at, at + 6),
      ];
  }
  return undefined;
}

/**
 * The segments the code reaches the table in when the table doesn't start a segment, as in TOONS.EXE: code that
 * builds a far pointer to a record, `mov dx, size; imul dx; add ax, offset; mov word [bp+n], segment`, where the
 * segment and the offset lead to the table.
 */
function segmentsOfTable(image: Uint8Array, table: number, size: number): Set<number> {
  const segments = new Set<number>();
  for (let at = 0; at + 13 <= image.length; at++)
    if (
      matchesInstructions(image, at, [0xba, size, 0, 0xf7, 0xea, 0x05, null, null, 0xc7, 0x46]) &&
      wordAt(image, at + 11) * 16 + wordAt(image, at + 6) === table
    )
      segments.add(wordAt(image, at + 11));
  return segments;
}
