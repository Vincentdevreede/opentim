/** Verifies the callback table dispatch and the object fields that the drawing code consumes. */
import { decodeInstruction, type Instruction } from "./x86.ts";
import { discoverObjectFieldRoles } from "./behaviour-fields.ts";
import { findDataSegment } from "./type-table.ts";
import { instructionEvidence, matchesInstructions, type TimingEvidence } from "./behaviour-timing.ts";

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

const word = (image: Uint8Array, at: number) => image[at]! | (image[at + 1]! << 8);

/**
 * The 58-byte stride and the table address come from the already discovered type table. Callback labels describe
 * candidate roles; the indirect calls prove which record fields are code pointers, not their full event semantics.
 */
export function discoverBehaviourLayout(image: Uint8Array, table: number, typeCount?: number): BehaviourLayout {
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
  const tableOffset = table - findDataSegment(image) * 16;
  for (let at = 12; at + 5 <= image.length; at++) {
    let field: number;
    let start: number;
    let end: number;
    if (
      matchesInstructions(image, at, [0x26, 0xff, 0x9f, null, null]) &&
      matchesInstructions(image, at - 12, [0xba, 58, 0, 0xf7, 0xea, 0xba, null, null, 0x8b, 0xd8, 0x8e, 0xc2]) &&
      word(image, at - 6) * 16 === table
    ) {
      field = word(image, at + 3);
      start = at - 12;
      end = at + 5;
    } else if (
      matchesInstructions(image, at, [0xff, 0x9f, null, null]) &&
      matchesInstructions(image, at - 7, [0xba, 58, 0, 0xf7, 0xea, 0x8b, 0xd8])
    ) {
      field = word(image, at + 2) - tableOffset;
      start = at - 7;
      end = at + 4;
    } else continue;
    if (field < 0 || field + 4 > 58) continue;
    windows.set(at, { start, end, push: start - 4 });
    dispatches.set(field, [...(dispatches.get(field) ?? []), at]);
  }
  const fields = [...dispatches.keys()].sort((a, b) => a - b);
  if (fields.length !== 6 || fields.some((f, i) => i > 0 && f !== fields[i - 1]! + 4)) {
    result.diagnostics.push(
      `Expected six contiguous far callback fields dispatched through the discovered table; found ${fields.map((f) => `0x${f.toString(16)}`).join(", ") || "none"}.`,
    );
  }
  const roles = ["bounce", "run", "reset", "flip", "resize", "rope"];
  fields.forEach((field, index) => {
    const sites = dispatches.get(field)!;
    result.callbacks.push({
      field,
      role: fields.length === 6 ? roles[index]! : `callback at record +0x${field.toString(16)}`,
      sites,
      confidence: "inferred",
      evidence: sites.flatMap((at) => instructionEvidence(image, windows.get(at)!.start, windows.get(at)!.end)),
      assumptions: [
        "The 58-byte table indexed by the caller is the discovered part type table.",
        "The traditional callback role is a candidate name based on dispatcher context; its complete event semantics are not established by the indirect call alone.",
      ],
    });
  });
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
        word(image, p + 3) * 16 === table
      ) {
        tableReference = p;
        tableReferenceSize = 5;
      }
      if (
        !farTable &&
        matchesInstructions(image, p, [0xba, 58, 0, 0xf7, 0xea, 0x05, null, null]) &&
        word(image, p + 6) === tableOffset
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
      flags.masks!.push({ value: word(image, at + 3), name: "drawFromPieces" });
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
      if (
        sources.length === callback.sites.length &&
        sources.every((source) => source.path.join() === sources[0]!.path.join())
      ) {
        const path = sources[0]!.path;
        callback.objectSource = {
          argumentOffset: 6,
          path,
          argumentRole: path.length ? "collider" : "owner",
          confidence: "inferred",
          evidence: sources.flatMap((source) => source.evidence),
          assumptions: [
            "A pushed near object pointer is the first argument of a far callback, at [bp+6] after the standard frame prologue.",
            path.length
              ? "The callback owner is selected by the type of the related object, while the interacting collider is passed to the callback."
              : "The callback owner is the same object whose pointer is pushed and whose type indexes the record table.",
          ],
        };
      } else if (sources.length)
        result.diagnostics.push(`Callback ${callback.role} has incomplete or inconsistent owner-argument evidence.`);
    }
  if (typeCount !== undefined && result.callbacks.length === 6 && result.fields.some((field) => field.name === "state"))
    result.fields.push(...discoverObjectFieldRoles(image, table, typeCount, result.callbacks, result.fields));
  return result;
}
