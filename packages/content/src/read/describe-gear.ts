/** Explains the certified connection relation without selecting a level graph or running its callbacks. */
import type { GearConnections } from "./behaviour-gear-connections.ts";
import type { GearScheduling } from "./behaviour-gear-scheduling.ts";
import type { BehaviourReport, FieldWrite, Finding, PartBehaviour } from "./behaviour.ts";

export interface GearDriverDescription extends Finding {
  sourcePart: string;
  sourceType: number;
  target: "gearIsSelectedLinkedEndpoint";
  write: FieldWrite;
  description: string;
}

export interface GearDescription extends Finding {
  construction?: GearConnections;
  drivers: GearDriverDescription[];
  activation: string;
  connections: string;
  conflict: string;
  withoutConflict: string;
  withConflict: string;
  cycles: string;
  limits: string[];
  scheduling: (Finding & { description: string })[];
}

export function describeGear(
  part: PartBehaviour,
  scheduling: GearScheduling[] = [],
  related: BehaviourReport["relatedObjectEffects"] = [],
): GearDescription | undefined {
  const run = part.gearRun;
  if (!run) return;
  const construction = part.gearConnections;
  const selected = scheduling.filter((finding) => finding.gearRun === run.address);
  const peer = run.propagationRelation.expansion.peer;
  const paths = peer.endpointFields.map(
    (offset) => `referenced-by(referenced-by(part+0x${peer.connectionField.toString(16)})+0x${offset.toString(16)})`,
  );
  const drivers = related
    .filter(
      (effect) =>
        effect.write.offset === run.deltaField &&
        paths.includes(effect.write.object) &&
        (effect.targetType === undefined || effect.targetType === part.type),
    )
    .map((effect): GearDriverDescription => {
      const value = effect.write.value;
      const action =
        value.kind === "constant"
          ? value.value === 0
            ? "clears the pending step"
            : `sets the pending step to ${value.value === 65535 ? -1 : value.value}`
          : value.kind === "field" && value.object === "part" && value.offset === run.deltaField
            ? "copies its own pending movement"
            : "writes a pending movement whose full value remains unresolved";
      return {
        sourcePart: effect.sourcePart,
        sourceType: effect.sourceType,
        target: "gearIsSelectedLinkedEndpoint",
        write: effect.write,
        description: `If this gear is the linked endpoint selected by ${effect.sourcePart} and its recorded write condition holds, that part ${action}.`,
        confidence: effect.write.confidence,
        evidence: [...effect.write.evidence, ...run.propagationRelation.evidence],
        assumptions: [
          ...effect.write.assumptions,
          "The selected endpoint of the source part's checked connection record is this gear. This is a conditional identity, not an assumed level connection or a promise that the source will run again.",
        ],
      };
    });
  return {
    ...(construction ? { construction } : {}),
    drivers,
    scheduling: selected.map(({ confidence, evidence, assumptions, description }) => ({
      confidence,
      evidence,
      assumptions,
      description,
    })),
    confidence: "inferred",
    evidence: [
      ...new Map(
        [...run.evidence, ...(construction?.evidence ?? []), ...selected.flatMap((finding) => finding.evidence)].map(
          (item) => [item.address, item],
        ),
      ).values(),
    ],
    assumptions: [
      ...new Set([
        ...run.assumptions,
        ...(construction?.assumptions ?? []),
        ...selected.flatMap((finding) => finding.assumptions),
      ]),
      "The words describe conditional consequences of the checked connection relation. They do not assert any level connections, initial movement signs, repeated driver writes or initial visited flags.",
    ],
    activation:
      "A nonzero pending rotation step starts the run. With no pending step, this callback leaves the state unchanged.",
    connections:
      (construction
        ? `After the common reset helper returns, reset clears the four direct slots and selects other gears whose saved positions differ by exactly ${construction.distance} units on one axis and zero on the other. The last matching candidate wins each slot. `
        : "") +
      "The gear first checks its four direct connections in slot order. A contact with no pending movement receives the opposite movement. Recursive gears also check a fifth linked peer, which receives the same movement. Existing nonzero movement is retained.",
    conflict:
      "A direct connection with existing movement reports a conflict when its movement equals the source movement. A linked peer reports a conflict when its existing movement differs. The local check still happens on an already visited gear; only further expansion is skipped. The first conflict makes the accumulated result one, and later checks cannot clear it.",
    withoutConflict:
      "The root adds its pending step to its state, changes a sum of -1 to 3 or a sum of 4 to 0, then clears its step. Connected moving gears reached through eligible connections or linked peers do the same once. Other sums are retained; the code does not apply a general modulo-four operation.",
    withConflict:
      "The root clears its step before advancing. Each eligible neighbour with movement is also cleared before a recursive gear call, so reached gears in states 0 through 3 keep their state. Raw state -1 still becomes 3 and raw state 4 still becomes 0. Reached non-gears have their movement cleared too.",
    cycles: construction
      ? "Reset excludes the gear itself and links gears one grid step apart horizontally or vertically. This separates the direct mesh into two alternating groups, so a closed chain of those links has an even number of steps if the links retain the same saved positions. With one initially moving gear, all other checked gears idle, and a step of +1 or -1, a mesh-only scan has no conflict even when it contains a cycle. Additional same-direction linked peers or incompatible initial drive movements can still make the checked constraints inconsistent. The complete marked traversal terminates even for more general cyclic input graphs; arbitrary movement words use the full first-encounter relation."
      : "Self-links and cycles terminate because a gear is marked before its connections are expanded. A direct self-link conflicts with any nonzero root movement. When every nonzero seed is the same magnitude with two distinct signs, a conflict means that the checked same-direction and opposite-direction constraints cannot all be satisfied. An odd cycle of direct connections is one such conflict; arbitrary movement words require the full first-encounter relation.",
    limits: [
      ...(construction
        ? [
            "The reset construction is a normal-return fact using positions after its common helper. Graph-wide parity requires the stored links to retain a common saved-position map. Reciprocal links, unique occupants and unchanged later coordinates are not assumed.",
          ]
        : []),
      "The root's four initial connections skip null pointers but do not test the blocked flag. Recursively discovered connections and linked peers do test it. The root's linked peer is checked during advancement, but is not an initial propagation edge.",
      "Already visited gears still take the incoming movement check or assignment, but do not expand again. Non-gears can receive movement but do not expand during propagation.",
      "Blocked targets and zero-movement intermediate gears can leave other connected movement untouched during advancement. This is not a command to stop every part in a connected component.",
      "For arbitrary words, different movement on a direct connection is accepted even when it is not the exact negative. Movement 0x8000 is its own modular negative, and an assignment into a zero target is not itself a conflict check.",
      "The connection result is determined by the actual ordered graph and its input movement and flags. A symbolic result in the report is a defined call result, not an independently settable trigger. Continued rotation needs movement supplied again on later runs.",
    ],
  };
}
