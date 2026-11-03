/** Plain-data relations for the decoded gear connection traversals. No runtime graph is evaluated here. */
import type { Expression, Finding, Predicate } from "./behaviour.ts";

export interface GearPeerRelation {
  routine: number;
  connectionField: number;
  endpointFields: number[];
  nullConnection: 0;
  selection: "secondEndpointWhenFirstEqualsOwnerOtherwiseFirst";
}

export interface GearPropagationRelation extends Finding {
  wordWidth: 16;
  fields: { movement: number; type: number; flags: number };
  gearType: number;
  visitedMask: number;
  blockedMask: number;
  arguments: { source: 6; target: 8; mode: 10; accumulator: 12 };
  local: {
    zeroTarget: { modeOne: "copySource"; otherModes: "negateSource"; conflict: false };
    nonzeroTarget: {
      retainMovement: true;
      modeOneConflict: "differentMovement";
      modeTwoConflict: "equalMovement";
      otherModesConflict: false;
    };
  };
  localConflicts: Predicate[];
  zeroTargetAssignments: { condition: Predicate; value: Expression }[];
  expansion: {
    gearOnly: true;
    markBeforeChildren: true;
    initiallyVisited: "checkIncomingEdgeWithoutExpansion";
    order: "slotsThenPeer";
    slots: { fields: number[]; mode: 2 };
    peer: GearPeerRelation & { mode: 1 };
    skipNull: true;
    skipBlocked: true;
  };
  result: {
    quantifier: "anyCheckedInvocation";
    conflict: 1;
    otherwise: "incomingAccumulator";
    conflictPersists: true;
    nonzeroIncomingStaysNonzero: true;
  };
  /** With a nonzero source, first encounters label zero targets; every resulting nonzero label is stable. */
  nonzeroSource: {
    labelOrder: "depthFirstFirstEncounter";
    initiallyNonzero: "retainInputMovement";
    assignedEdges: "doNotReportLocalConflict";
    checkedEdges: "testTargetMovementBeforeAssignment";
    modeTwoIsNotAnExactNegationTest: true;
    signedDomain: {
      requiresModesOneOrTwo: true;
      requiresCommonMagnitude: true;
      requiresDistinctNegation: true;
      conflict: "inconsistentEqualityAndOppositionConstraints";
    };
  };
}

export interface GearAdvanceRelation extends Finding {
  wordWidth: 16;
  fields: { state: number; movement: number; type: number; flags: number };
  gearType: number;
  blockedMask: number;
  arguments: { owner: 6; suppressMovement: 8 };
  postcondition: {
    closure: "unblockedNonzeroInputMovementGears";
    rootAlwaysProcessed: true;
    clearReachedGears: true;
    clearReachedNonGears: "onlyWhenSuppressed";
    rootStateUsesInputMovement: true;
    otherGearStateUses: "inputMovementUnlessSuppressed";
    terminalTargets: "unblockedNonzeroInputMovementNonGearsAdjacentToClosure";
    outsideReachedPartsUnchanged: true;
    snapshot: "beforeAdvancement";
  };
  owner: {
    addMovement: true;
    normalise: { from: number; to: number }[];
    clearMovementBeforeChildren: true;
  };
  expansion: {
    order: "slotsThenPeer";
    slots: number[];
    peer: GearPeerRelation;
    skipNull: true;
    skipZeroMovement: true;
    skipBlocked: true;
    suppressBeforeTypeCheck: true;
    recurseGearOnly: true;
  };
}

/** An immutable symbolic call result defined by a proved ordered graph relation, rather than a new game input. */
export interface GearConflictValue extends Finding {
  value: Extract<Expression, { kind: "field" }>;
  routine: number;
  instruction: number;
  snapshot: "beforeRootConnectionScan";
  owner: "part";
  ownerMovement: Expression;
  ownerMarkedBeforeScan: true;
  rootSlots: number[];
  rootMode: 2;
  rootSkipsBlocked: false;
  initialAccumulator: 0;
  values: [0, 1];
  relation: GearPropagationRelation;
}
