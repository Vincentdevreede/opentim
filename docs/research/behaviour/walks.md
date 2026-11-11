# Descriptions and walks

## Descriptions and conditional frame walks

`describeBehaviour(report)` returns plain data for every part. `rest.description` explains a known reset frame or
why it cannot be determined. `animations` contains a trigger description, its structured condition and evidence,
then the frame walk and its stopping reason. An unresolved trigger guard is separate from an untracked trigger
memory effect: the former can describe a conditional local consequence, while the latter cannot establish a start.
Related triggers use all final assignments to their target together, rather than combining isolated intermediate
writes. `effects` describes recovered drawing changes, related-object writes
and reachable shared helper purposes. Addresses remain in the evidence instead of the prose.

The engine's level reset restores the state from a saved field of the object. Its numeric value belongs to the level,
so a callback that does not overwrite it does not establish frame zero. `lifecycle` records the dominating restoration
and counter clears separately from each type's reset callback. It also records state-history copies without inventing
when every part receives them.

`creation` records literal defaults proved on every return from a separately discovered constructor. The factory's
bounded type table supplies the constructor reference; neither its address nor its entries are built into the reader.
The analysis intersects assignments at joins, invalidates fields after unbounded writes and uses only established
callee footprints. A successfully constructed conveyor, for example, starts with state 28 and a cleared state-control
value in all eleven builds. These facts describe creation before level overrides, independently of a loaded level's
rest frame. A constructor with no established literal state retains an explicit uncertainty.

A documented stable ending can establish a separate conditional starting point. For example, the trampoline's own
run code writes state zero and clears its activation value. Its next run preserves that state. If its recorded contact
checks later reach the activation write, the recovered run rules establish frames 0 → 1 → 2 → 3 → 4 → 0. This does
not claim that a collision happens or that every loaded trampoline resets to zero. The trigger's reachability confidence
and the subsequent local walk's confidence remain separate.

`walkBehaviourRules` applies only extracted return expressions and simultaneous final-field assignments. The values
of unestablished fields remain unknown. A potentially applicable unresolved guard or destination stops the walk;
it is not skipped in favour of a convenient branch. Per-frame `runCalls` counts these applications, including holds
caused by a counter. `gameSteps` remains absent where one callback invocation per game step has not been proved.
The engine has gated dispatcher passes, so its global timer alone does not establish that relationship.

The following helper roles are found in every supplied build by decoded structure and call references:

| Role                                | Meaning                                                                       | Remaining qualification                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Type-specific geometry notification | Chooses a rectangle-update routine for the part type.                         | Some geometry and resource storage relationships are inferred.                                                     |
| Scalar resource request             | Checks an effect identifier and asks a shared resource service to perform it. | Driver/resource effects and any unspecified return value remain unresolved; no sound backend contract is invented. |
| Status-byte propagation             | Copies a status byte to a part and connected objects.                         | Some related-object traversal and mode-dependent writes remain conditional.                                        |
| Outline edge data                   | Updates edge data from neighbouring outline coordinates.                      | The full numeric helper contract remains unresolved.                                                               |
| Connected geometry notification     | Calls the appropriate geometry routines for connected objects.                | Type and global-mode gates remain explicit.                                                                        |
| Bounds-overlap queries              | Builds a linked list of other parts overlapping the supplied bounds.          | List well-formedness and separate object storage are assumptions.                                                  |

Object fields now have evidence-backed names. Position and velocity axes are linked through fixed-point integration;
`baseWidth` and `baseHeight` are stored dimensions rather than an assumed rest size. The contact tuple is named
`contactPart`, `contactAngle` and `contactEdge`. Reused counter slots retain a generic storage role with per-part
contexts such as increasing counters, countdowns and control gates. These names do not assign a universal physical
meaning such as heat or fuse time to every use of the same offset.

## Comparing descriptions before and after

```sh
pnpm --filter @opentim/content compare-behaviour \
  --baseline /path/to/baseline-reports --reports /path/to/new-reports \
  --oracle /path/to/v25/animations.json --out /tmp/behaviour-comparison
```

`--baseline` can be left out to measure reports on their own. `--no-descriptions` leaves out the description files
(about 300 MB a build), so all eleven builds fit in one run; the summary lines, `comparison.json` and `report.md` stay.

Extraction writes an analysis-time sidecar for each build; comparison measures description time separately. The
before/after metrics count graph transitions and unique callback call sites, pointer losses and loop diagnostics.
They do not count every transitive engine diagnostic as a separate part failure.

The comparison also keeps a scoreboard of what is still open in the descriptions: effect lines that say their meaning
or value isn't established (counted once per part and wording), parts whose reset can't be read, parts without a listed
resting frame and parts that have no recording. Each count appears in the summary line, the table and the before and
after changes, so a step shows its effect in one run.

Walk validation uses exact executable hashes and never copies oracle fields into a description. Compatible extracted
initial fields are required before comparing a walk. It distinguishes a complete equal walk, a correct prefix that
stops, and a different continuation. A recording with no compatible extracted starting point is listed separately as
unavailable; it is not a successful empty prefix or a claimed game-behaviour difference. Repeated external inputs,
hiding, reflection and physics remain outside a single-trigger frame-number comparison. One-frame recordings do
not by themselves establish an animation.

The stored JSON-text cache used by `same()` is retained. Structural summaries avoid repeating symbolic analysis of
engine bodies whose part effects are already bounded; their decoded code and remaining backend gaps stay visible.
This keeps browser import work at a few seconds per build rather than expanding helper loops on every caller path.

## Further static proofs

The analyser preserves pointer identity across same-register `or` and `and` tests and recognises same-register `xor`
and `sub` as zeroing operations. Byte results are assembled at their actual word positions. Reads after unknown
stores retain a distinct symbolic storage version, so a later dereference can retain its conditional pointer class
without reusing a value from before the store. Register-return alternatives are substituted before they can merge
into an unknown value. These are algebraic instruction relations, not an instruction interpreter.

Callback ownership is derived from the actual dispatcher arguments. The first argument of a bounce callback is the
colliding part; the selected callback belongs to its contact partner. Other dispatchers can pass the owner in a later
argument. Near and far return conventions and immediate stack cleanup are derived separately from the owner argument.
An unresolved owner or argument mapping remains a gap.

Signed and unsigned division retain quotient and remainder expressions when their nonzero divisor and quotient
range are established. A sign-extended word divided by a checked constant is one such domain. Definite division
exceptions stop that path with instruction evidence; an unproved division domain produces an explicit unresolved
boundary. The visible seven-frame conveyor cycle is recovered from these arithmetic instructions, including its
opposite directions.

Outline-copy loops use a separate storage class for the buffer identified by the edge-data helper. Bounded affine
indices can describe a union of owner-field addresses without evaluating loop iterations. Overlap-list scans use
another invariant: a structurally proved query excludes the owner, each body path advances the next link or exits,
and the body cannot change that link. Alternative queries must together dominate the head load. Finite, acyclic
lists and disjoint complete objects remain stated assumptions. The invariant preserves the owner's state only when
all body and callee effects permit that conclusion; collider-root callbacks do not inherit this owner proof.
A global-list scan needs independently discovered head and next-link selectors. Its list may contain the owner,
so the narrower invariant rejects all member-pointer stores and owner stores overlapping state or next-link storage.
It can preserve state while rebuilding owner connection slots, without assuming that a scanned member is disjoint.

`iterationOutcomes` retains simultaneous final assignments for one overlap-list member. Its scope is separate from
callback returns. Descriptions can use that relation for an incoming trigger only conditionally on membership and
its recorded checks. A state assignment and a counter assignment from different paths are never combined.

Helper footprints distinguish complete part-memory effects from unbounded driver or heap globals. Preserving the
state word alone does not preserve every cached counter. A discovered factory can have a stronger contract for a
constant type whose constructor entry is null; the table, entry, allocation closure and cleanup path supply its
proof. Other constructors remain unresolved. Initial zero fields belong to the nullable fresh allocation, never to
the existing caller's part.

Carry arithmetic keeps a separate symbolic CF value. Widened addition and subtraction establish carry and borrow;
`adc` and `sbb` consume that relation with its producer instructions. Increment, decrement and `not` preserve CF.
Calls and unsupported flag operations invalidate it. Carry-only instructions preserve the other flags, and a branch
which needs an unrepresented combination of old and changed flags remains unresolved. Backward liveness avoids
building carry expressions which no later instruction consumes.

Reverse postorder scheduling lets sibling paths meet before their shared continuation. Two paths join only when
one predicate is the exact complement of the other and the remaining conditions, live abstract register values,
memory effects, flags, stack arguments and side-effect versions agree. Byte aliases remain live with their word
register, and memory differences are retained. `controlFlowJoins` records the conditions, live register names and
instruction evidence. This reduces repeated work without raising the path limits or selecting a convenient branch.
Earlier field equalities can also simplify a later read of the same symbolic input or storage version; assignments
and unknown writes do not retroactively change copied earlier values. Once three quarters of the unchanged visit
budget have been spent, queued straight-line return tails receive priority. A large sibling branch therefore cannot
starve already established short paths at the shared epilogue; unfinished paths still produce unknown exits.

Fixed output-buffer footprints retain their actual argument positions. A caller can prove that the whole output
span stays inside its reserved private stack frame. This establishes memory preservation for geometry-query
wrappers without inventing their numeric return values or loop termination. Complete symbolic helper relations can
also retain separate owner and outline destinations. An outline pointer must be discovered and unchanged by the
helper; stores through arbitrary related pointers do not receive that contract.

A complete return relation with only owner-field stores also supplies a footprint without requiring an outline
store. The overlap-list invariant can then apply a member's state-changing helper while preserving the scanning
owner. It still requires complete return coverage and rejects unrelated destinations or incomplete nested effects.

Output arguments can follow read-only object inputs. Their setup must uniquely reach the call, and every possible
store must fit the reserved private stack frame. The same proof is used by ordinary calls and list-scan invariants;
unknown numeric outputs invalidate the private locals without becoming unknown writes to a part.

A private word initialized to zero can retain a nullable list-member pointer after a complete scan only when every
overlapping body store is a complete member pointer or zero. Scalar stores, byte overlaps and unknown initial values
prevent that conclusion. Invalidating private locals also invalidates overlapping cached words and bytes.

A forwarding wrapper can compose only a selected-state preservation contract when every helper receives the same
complete part base. The proof checks the dominating argument load, unambiguous push sequence, near/far convention
and balanced stack on every CFG path. Other fields, backend effects and numeric returns remain unresolved.

A linked-node pool can be tied to its initialization: two cleared global head slots, separately allocated fixed-size
nodes and insertion through the checked next field. Scoped updates preserve the owner state under the stated pool
ownership and capacity assumptions. Outstanding node aliases and selected return values remain unresolved, so the
caller still invalidates other unbounded memory facts. Constructor-body scope proofs similarly remain separate from
a factory's failure cleanup; they cannot by themselves make the full factory call harmless.

A counted loop can copy an owner word into connected objects without changing that word on the owner. This needs
every possibly overlapping store to copy that exact owner word, even if a connection points back to it. Other
related-object fields still become unknown. Nested compiler switch-key searches are contracted only after their
positive count reload, read-only body, unique entry and bounded `loop` instruction have been proved.

## Conditional inputs and stop explanations

A description can state a conditional input case from run predicates and literal assignments found in the code.
For example, it can describe a supplied positive or negative state-control value without claiming that a collision
occurs or that a level starts with that value. Finite cases retain the producer instructions and their assumptions.
Reused counter slots do not inherit constants from unrelated part types. An untyped producer of the shared control
field can supply a labelled input case, but does not establish an incoming event for a particular type.

Conditions on related objects can remain symbolic while their pointer sources and referenced fields are unchanged.
Changing a traversed pointer, a possibly aliasing field or untracked part memory invalidates the condition. This can
establish a conditional cycle without choosing a convenient value for the related object.

Complete guarded paths that agree on their final fields can be joined without selecting a branch. The analysis must
establish exit coverage and forget untracked fields. A disagreement, unestablished guard, unknown destination or
analysis limit stops the walk with a specific reason and relevant instruction evidence. A proved identity can hold
an unspecified input frame; this does not invent frame zero. Durations remain run invocations unless a game-step
relationship has independent evidence.

When an unknown input field decides between rules that lead to different fields, the walk still stops there, but
`stop.branches` follows each rule as its own walk under that rule's condition. Only plain comparisons of input fields
may decide, and a branch keeps its condition only as far as its own writes leave the tested fields unchanged.
Branches nest up to two decisions deep; deeper ones only repeat a rewritten test. The walk's status stays `unresolved`: no input value is chosen, so a
branch describes what happens if the level supplies that case, not what a loaded level does. In Even More 92 walks
branch this way, 16 of them end in every branch.

A rule whose only unresolved parts are the values it writes still fixes the state path when the run routine has no
open uncertainty and every outcome has complete effects. The walk then forgets those fields and continues, with the
rule counted as inferred for the path. A guard may also test a value the same run computed, like the mouse motor's
step after its contact scan. Such a test can split a walk into branches, but it is not carried into later runs,
because each run scans again. An opaque unknown in a guard, an unknown destination or a routine whose paths are not
all analysed still stops the walk.

Some starts fix only part of the state. The electric switch's reset restores the frame saved in the level, so the
program bounds the state but does not choose it. When at most three bits of the starting state are unknown, the
walk follows each value those bits allow that has a frame, under the condition that the state has that value, and
records them as `stop.branches` of kind `state`. No value is preferred; a level picks one. In Even More this lets 41
electric switch walks end in every case.

When a seed does not fix the state at all, and the part shows its state as one of at most 32 frames, the walk
follows each frame as a starting state in the same way: a state with no frame cannot be drawn, so the frames are
exactly the states a part can be in. Parts drawn without frames, like the conveyor belt and the gear, are not
bounded this way and keep stopping. In Even More this lets 149 walks end in every case, up from 62.

The limit was 16 frames at first, which left out the jack-in-the-box (19 frames), the fish bowl (23) and Mel
Schlemming (31). At 32 it covers every part that has frames. Walks that stop went from 152 to 130 in Even More and
from 135 to 127 in TIM 1; every walk of the fish bowl and of Mel now ends in each of its branches.

When the next state depends on a value no rule fixes, like the state-control value at `0x12`, the stop lists the
writes to that field the analysis found as `stop.producers`: the part's own routines, its creation default and other
parts that write it through a link, each with its value, condition and proof. The jack-in-the-box, for example, gets
its control value from a driving electric motor or windmill (−1, 0 or 1) or from a monkey bike or mouse motor that
copies its own step. These are sources, not a proof that no other writer exists, so no value is chosen from them.

The comparison report separates complete matches from actual code triggers, reset or documented stable endings,
and conditional input cases. One-frame recordings are counted separately from animations. A missing compatible
start is unavailable, not a successful empty prefix. Unknown starting conditions and repeated external writes cannot
establish complete measured coverage.

Periodic masks and remainder tests can establish a frame-block cycle while leaving its base and initial phase
supplied by the level. `parameterised.kind: "cycle"` retains the period, direction and checked base bounds. The
proof checks every phase of the extracted relation, requires translation-invariant state guards and affine state
updates, and rejects absolute-state exceptions or untracked effects. The phase coordinate zero used in this
algebra is never emitted as an assumed starting frame. A recording chooses its own base and phase only during
validation; its fields never seed a description. Every selected state must still have valid frame data.

Creation analysis starts from the factory's cleared allocation. The allocator fills the whole new part with zeros, and
`zeroWords` lists every word of it that no success path of the factory writes: not its own stores, nor those of the
helpers it calls. Both games allocate 162 bytes and leave 68 words zero, among them the belt link at `0x54` and the
step at `0x12`. A factory with an owned constructor proves no zero words. The constructor relation starts from these
zeros, follows masked assignments and complete owner calls, and drops any word a call may replace; unnamed words are
reported by offset, like `+0x96`. The result still describes a fresh construction before level overrides rather than a
loaded level's rest. A fresh part is not what the v25 recordings show for every part: a running motor, for example,
has power and a belt that a new one lacks, so such a recording stays an input case. Input cases still split only on the
state-related fields a constructor sets (previous and saved state, step, control and trigger), so the zero words
do not crowd out the bounded list of cases.

## The control value's known numbers

Many parts move their frame by a control value, as in "frame + control value", that other parts and their own
routines set. When a walk reaches such a step without knowing the value, it lists the writes it found. Proving those
are all the writers isn't possible yet: hundreds of routines still have unfinished effects, and any of them could
write the field. So the walk branches on what it does know: when the unknown is one field of the part and the writers
found give between one and six plain numbers, each number is followed as its own conditional walk from that frame,
and a last branch for any other value keeps the stop. Nothing is claimed about which values occur.

For the teeter-totter the writers give 0 (its own run), 1 and -1 (its rope, a bounce, the windmill and the motors).
In each recorded build 27 walks that stopped now reach the end in some of their branches.

## Ways that lead to the same frame

When several rules apply at a step and the walk can't tell which, it used to branch or stop. When they all lead to
the same next frame, it now goes on with that frame and keeps only the field bits all of them agree on; a field they
set differently is forgotten. That only drops knowledge, so it claims nothing false, and the frames the walk shows are
the same for every way. In each recorded build 13 more walks end, and 2 more recorded animations match completely.

Within a branch, the condition of its rule holds. A part field that condition tests for one number therefore has
that number before the step, and the step and its next frame are worked out again with it, like a counter that
counts down from a tested value. That removes 48 of the stops at the branch depth limit in Even More.

The branches of one walk also share what they have followed. A branch that reaches a state, with the same known
fields and kept conditions, that another branch of the same walk already follows from there on ends as `joins`: it
continues exactly like that branch, so it isn't followed twice. The lab shows it as "continues like another way". In
each recorded build 3 more walks end in every branch.

## Walks that split at every step

Some parts decide again at every step on something the walk can't know. The cat looks for a mouse each time it sits,
and when it moves it asks whether the new spot is blocked. The monkey bike counts down a counter it was given while it
pedals, so every frame of its cycle can be the last. Branching only twice could never follow such a part round its
cycle. Four changes let these walks close:

- A test on a field of a part the run found itself, like the type or position of the part the cat looks at, is a
  value of that run, like a query's answer. A walk may branch on it; like other run values, it doesn't carry over to
  the next step.
- Rules that lead to the same next fields are one way. Its condition is what they all test, and one of their own
  remaining tests holds (`alternatives`). The lab writes it as the shared terms and "one of N cases". The cat's sitting
  step has 18 rules but only two or three next states.
- A branch ends as `joins` also when the branch it continues like knows fewer tests: one that follows a state knowing
  nothing about a field covers the case where that field is known. Before, the kept tests had to match exactly, so a
  branch that had tested the cat's position on the ground never met one that hadn't.
- Instead of two levels, branches may nest 24 levels deep, and one tree of branches may follow 400 states. Since
  branches that reach a state already followed end there, most trees close long before that. The monkey bike's
  cycle needs about 13 levels. A step still splits into at most 8 ways.

All four only follow cases the code allows. They choose no value and add no assumption.

Every walk of the cat now ends in each of its branches, in both recorded builds. The monkey bike's walks then still
stopped where a walk started it on frames 5 to 12 with its counter at 0 and a direction set: its own code counts on
past frame 12 to a frame 13 that has no picture. The code shows a level never starts it like that, so this is now a
decided assumption ([the monkey bike's starting frame](../../assumptions/behaviour-assumptions.md#4-the-monkey-bikes-starting-frame)):
such starting frames, input cases and branches are left out, and every walk of the monkey bike ends in each of its
branches too.

Over all parts, walks that end in every branch went from 180 to 302 in Even More and from 153 to 255 in TIM 1. Walks
that stop went from 175 to 158 and from 158 to 141. No recorded animation changes. Describing a build takes about 5
seconds instead of 4; the text of each condition and the evidence of each set of rules are now worked out once.
With the monkey bike's starting frame decided, walks that end in every branch go to 330 and 283, and walks that stop
to 152 and 135; 10 of the bike's input cases are left out in each build.

The lab still shows two levels of branches. A split deeper than that shows how many ways it has, and a split whose ways
all end, also deeper than shown, reads "N ways, all end". In conditions, the part a find-first loop found reads as
`found` (its fields as `found.state` and so on), and a query's answer as `answer at` the call's address.

## Parts drawn by their own code

The conveyor belt and the gear have no list of frames in their type record: their own code draws them. So the walks
had no number of frames to start them on, and every walk that began from a level's saved frame stopped at once.

The code shows which frames they have. The belt's frame is a block of 7 frames per width: the editor keeps its width
between 32 and 96 in steps of 16, its resize sets the shown and the saved frame to the first frame of that width's
block, and its run only moves within the block. The gear's run adds its control value to its frame and wraps it within
0 to 3. Two decided assumptions now give these starting frames
([the conveyor belt's](../../assumptions/behaviour-assumptions.md#5-the-conveyor-belts-starting-frame) and
[the gear's](../../assumptions/behaviour-assumptions.md#6-the-gears-starting-frame)): the belt starts on frame 0, 7, 14, 21 or 28, the
gear on any of its four frames. Every shipped level of all eleven builds fits them.

The belt then stops when the part at the other end of its belt link is a gear whose train is blocked, and a gear stops
when its own train is blocked. Whether a train is blocked is the "gear connection conflict" the analysis already
works out from the connected gears (see [the full gear conflict relation](gears.md#the-full-gear-conflict-relation)). It is a
value of that run, like a query's answer, so walks may now branch on it.

All 73 walks of the belt and all walks of the gear now end in every branch they can follow, in both recorded builds.
The gear's walks that stay open are only the branches for a control value other than 0, 1 and -1, the numbers the
analysis found its writers set. Over all parts, walks that end in every branch went from 330 to 380 in Even More and from
283 to 333 in TIM 1, and walks that stop from 152 to 98 and from 135 to 81. No recorded animation changes.

The mouse motor and the electric motor are drawn by their own code as well. The mouse motor's run only flips between
frames 0 and 1, and the electric motor's counts down within 0 to 2. Two more decided assumptions start them there
([the mouse motor's](../../assumptions/behaviour-assumptions.md#7-the-mouse-motors-starting-frame) and
[the electric motor's](../../assumptions/behaviour-assumptions.md#8-the-electric-motors-starting-frame)). Together with the generator
change below, walks that end in every branch reach 409 in Even More and 362 in TIM 1, and walks that stop 69 and 52.

## Frames a partly known state allows

The generator shows its state as one of 16 frames. Its run turns the two low bits round, and its reset at `0x1aeb3`
(Even More, English floppy) keeps those two bits and sets bit 2 and bit 3 when the words at `0x62` and `0x64` are not
zero. Shipped levels save it on frame 0 or 4. Walks that knew only some of these bits, like the reset or a trigger
that kept the low bits, used to stop: more than three bits were unknown, and the frame bound only applied when no bit
was known.

A part with at most 32 frames can only be on one of them, so the walk now follows each frame whose number has the
known bits, the same way it does when no bit is known. A part drawn without frames still stops. All 45 walks of the
generator now end, in both recorded builds. After the belt and the gear, walks that end in every branch went from 380
to 395 in Even More and from 333 to 348 in TIM 1, and walks that stop from 98 to 83 and from 81 to 66.

## Unnamed values that keep the frame

When the balloon's control value is set, it goes on to its next frame. On the way it tries to free its rope: it asks
the part factory for a new part and searches the rope's other part for the link that points back. Whether the factory
gives a part, and what that search finds, are values the walk can't name, so a walk from the level's starting frame
used to stop there without a branch.

Those values only choose between rules that lead to the same frame. A walk now branches by frame in that case: the
rules that lead to one frame are one way, with the fields they all agree on, like [ways that lead to the same
frame](#ways-that-lead-to-the-same-frame). Two checks keep it sound. What the rules of one frame all test must be
plain tests of the part's fields, and it must rule out every other frame's rules; for the balloon that is "the control
value is 0" against "the control value is not 0". Since every return path of the run is one of the rules, one of that
frame's rules then applies. The unnamed value never becomes a condition of the walk.

The balloon's walk from its starting frame now ends in every branch, in both recorded builds. Nothing else changes.

## Rules that give the next frame from any frame

The pinball bumper is drawn by its own code too, so walks have no frames to start it on. But they don't need one: its
run at `0x1dfb1` (Even More, English floppy) goes to frame 1 and clears its control value when hit, goes to frame 0
when not hit and on another frame, and stays on frame 0 otherwise. Every rule gives a known next frame under its own
condition.

So when the starting frame isn't known, a walk now looks at the rules that can apply. If they cover every path of the
run, apply from any frame, and each gives a known next frame, each way is followed as a branch, like
[ways a run decides by itself](#walks-that-split-at-every-step). When only one rule can apply, like for a bumper that
was hit, the walk goes on from the frame it gives. This adds no assumption: it follows only what the rules say for
every frame.

All 11 walks of the pinball bumper now end. Over all parts, walks that end in every branch went from 429 to 435 in
Even More, and walks that stop from 46 to 40. TIM 1 has no bumper and doesn't change.

## Helpers that keep the state

Some helpers are proved to keep the part's state, but not which of its other fields they change. The magnifying glass
looks for a light source every run, and when it finds a part to heat it calls one (`0x793f`, Even More, English
floppy) that updates the drawing of the part it is given. Its run then never writes its state, but the path through
that helper has incomplete effects, so its walks stopped at once.

Such a path is now marked `keepsState` in the routine's outcomes. When it is the only reason a routine's effects are
incomplete (no other uncertainty, and every return path analysed), its rules still fix the state path: the destination
is exact, and the walk forgets every other field after that step, since any of them may have changed. A path with any
other gap still stops the walk. The magnifying glass's walks from its creation and from frame 0 now rest on frame 0.

## Holding a frame the walk doesn't know

When a walk starts without knowing the state and every rule that may apply keeps it, the part holds whatever frame it
has, and the walk ends as a `hold`. This used to need every rule to leave the walk knowing exactly what it knew
before. A rule that also sets a field, like the magnifying glass clearing the part it heats, broke that, though it
cannot make the walk choose a different rule later: knowing more only rules out more of them. Now each rule only has
to keep at least what the walk knows.

A rule past a helper that keeps the state forgets every other field, so the walk knows less after it. The walk then
checks once more from what every rule leaves known: if the state is held from there, one run later, it is held from
the start too.

In both recorded builds the magnifying glass's remaining walks end this way. The electric switch's 41 walks that
followed each frame its saved bits allow now end as one hold, and a walk each of the bellows, the solar panel, the
windmill and (in TIM 1) the rocket does too. 8 more recorded animations match completely in Even More and 11 in TIM 1.

## The teeter-totter's rope answer

When its control value is set, the teeter-totter first asks the parts at the other end of its ropes whether it may
tip (the rope connection query, called at `0x1d2af` in Even More, English floppy). When one of them says no, it keeps
its frame; otherwise it asks again and adds the control value to its frame. The query's answer depends on those other
parts, so the analysis can't know it, and every walk stopped at the step that tested it. That answer is one value,
just like the answer of a query that changes nothing: what the parts at the other end change doesn't matter for that.
The reader now names it `answer of the query at` the call's address too, and the walks branch on it.

The rope callback tests the same answer twice, so naming it also drops the paths where those two tests disagree: in
Even More the callback has 77 outcomes instead of 107, and the teeter-totter has 20 fewer walks. In both recorded
builds its walks that stop go down by 20 (from 30 to 10 in Even More, 34 to 14 in TIM 1) and 6 more end in every
branch. No other part changes.

## The teeter-totter's bounce and the bounce pool

When a part lands on the teeter-totter, its bounce callback first asks a pool update (at `0x867c` in Even More,
English floppy) whether this landing is newer than the last one it noted for this teeter-totter; only then does it set
the control value to tip it. The pool is a free list of 8-byte nodes the game allocates at start. Its update writes
only those nodes, the two head globals and its own stack, so it can't change a part. Before, the reader kept only the
owner's state after the call and forgot every other field, so the bounce's outcomes had unfinished effects and its
walks stopped at once.

Now the summary records the node size, and a caller forgets only the first 8 bytes of objects other than its own part,
since one of those might be a node. When the caller wrote such a field of another object before the call, the update
keeps its old summary, because it could change that write where the caller can't see. The update's answer, whether
it added a node, is named like a query's answer. TIM 1 compiles the pool's setup through a local instead of a
register; the reader now accepts both forms, so TIM 1 has the pool too. One more assumption is stated: the owner is a
live part, never a node, and every pointer to a node points to its start.

The bounce now has complete effects in both recorded builds, so its 4 walks in Even More and 8 in TIM 1 start. They
then stop where a starting frame is followed that the bounce's own condition rules out, or at the frames the
teeter-totter doesn't have.

## Starting frames a callback rules out

A callback's walk starts from the fields its outcome leaves. When those don't fix the frame, the walk follows each
frame the part has, but it used to forget the callback's own condition while doing so. The teeter-totter's bounce, for
example, only tips it to the left when it isn't already at frame 0, yet its walk also started from frame 0 and then
reached a frame -1 that doesn't exist. Now the tests a callback's or a related writer's condition makes on the part's
own fields hold when its walk starts, as far as its writes leave those fields alone, and a starting frame they rule out
isn't followed. When that leaves one frame, the walk follows it as the only way. In both recorded builds 20 more
teeter-totter walks end in every branch, among them all of its bounce walks. No other part changes its counts.

## Cases in the middle of a run

A walk now leaves out starting frames that its own condition rules out ([starting frames a callback rules out](#starting-frames-a-callback-rules-out)). That
showed two things. An input case describes the part in the middle of a run, where the belt can be on any of its 35
frames, not only on the first frame of a block that a level starts it on. Input cases therefore start on every frame
the part can show, and walks from a level's frame keep using the frames a level gives. And an input case that needs a
frame the part doesn't have, like a frame above the fish bowl's last one, describes nothing the game can be in, so it
is left out, like the cases a decided assumption rules out.

## Decided control values and ends

Two more decided assumptions close the last walks of the jack-in-the-box, the gear and the teeter-totter
([control values](../../assumptions/behaviour-assumptions.md#9-control-values) and
[the teeter-totter's ends](../../assumptions/behaviour-assumptions.md#10-the-teeter-totters-ends)). Where a walk needs one of their
control values, it now branches on -1, 0 and 1 and has no branch for any other number. A teeter-totter on frame 0 with
control value -1, or on frame 2 with 1, is ruled out wherever a walk would start, branch or begin an input case there;
the branches on known numbers check it too, and they also leave out a number the walk's own tests rule out.

Every walk of these three parts now ends in each of its branches, in both recorded builds. Over all parts, walks that
end in every branch went from 416 to 495 in Even More and from 347 to 426 in TIM 1. Walks that stay open went from 98
to 7 and from 99 to 8: all of them are walks from the explosion. The teeter-totter has 12 fewer walks in each build,
the input cases the second assumption leaves out. Since ropes may form a ring, the teeter-totter's control value
after it asks for real is one value of that run; the walk branches on it with the same numbers (see
[the rope connection query](ropes-belts-pulleys.md#the-rope-connection-query)).

## Recordings that start on a branch

The recording comparison listed 41 recordings in Even More and 13 in TIM 1 with no compatible start: the teeter-totter's
tilt, the bellows' squeeze, the jack-in-the-box turned or flipped, the vacuum cleaner switched on or off from frames 6
to 8, Mel Schlemming's end from frame 23 and the alligator's bite. None of them starts in a state a decided assumption
rules out, and for each one a walk exists. They all had the same cause. A walk that doesn't know the frame it starts
on, like the walk from a level reset or an input case that doesn't test the frame, follows each frame the part has as
its own branch (see [frames a partly known state allows](#frames-a-partly-known-state-allows)). Such a walk has no
first frame of its own, and the comparison only looked at walks that had one.

The comparison now takes the branch for the recording's first frame. It does that only when every branch of the
walk's first split is "the state is this frame", so it picks a frame the walk follows and decides nothing else; a split
on any other field is left alone. Mel Schlemming's end and the vacuum cleaner's start then match completely, and so
does the balloon's pop, which was a prefix before: the walk of the callback that pops it doesn't know its frame. The
others agree for their first frames and then stop where the walk splits again on a field the recording does know,
like the teeter-totter's and the jack-in-the-box's control value or the alligator's heat, or where a branch continues
like another one, like the vacuum cleaner from frame 6. The tilt and the squeeze also have the recorder write the
control value again after a few runs, which a single trigger can't describe.

The comparison that follows a walk's branches (see
[recordings compared along a walk's branches](#recordings-compared-along-a-walks-branches)) now does this too: a
split on the starting frame is one of the splits it follows, so it keeps no separate rule for it.

The flipped jack-in-the-box has a second gap: its input cases stop at 64 (it would have 184), and the cases of its
flipped run, among them the one that wraps from frame 0 to 7, come after that limit.

No recording now lacks a compatible start. Complete matches went from 444 to 456 in Even More and from 392 to 396 in
TIM 1, the other recordings that had none are prefixes now, and none is different. The descriptions don't change.

## Widening at the branch depth limit

In TIM 1 the mouse motor's walk after creation never closed. While it runs, its run at `0x1a6cc` (TIM 1, French)
flips its frame and counts down the counter at `0x96` every step (`dec [si+0x96]` at `0x1a734`); it stops when the
counter reaches 0. The counter starts at 0 at creation, so it counts down through all 65,536 numbers, and every step
reaches a state the walk never followed before. At each step the walk also can't tell whether the motor keeps running,
so the walk branches each time, and after 24 levels it stopped. In Even More the run calls the start routine, which
loads the counter with 100, so those walks end.

Now, when a step could branch but the branch depth is used up, the walk looks for a state its tree already followed
at the same frame. It forgets every field in which the two differ, like the counter, and every test that earlier
state didn't know, and takes the step again from what both agree on, with a fresh branch depth. Of several such
states it takes the one that keeps the most fields, then the most tests. This is widening: it only drops knowledge,
so it claims nothing false, and the walk's fields show what it still knows. It adds a stated assumption (not a
decided one) to the walk's findings.

It always ends. A walk widens at most once, since it then has depth left, and only while its tree has budget left
(`BRANCH_BUDGET`). The widened state is either one the tree already follows, so the walk joins it, or a new state that
counts against the budget. Branches are still only opened while the budget lasts. Each widening also knows strictly
less than the state it came from, and a branch that reaches a state some branch already follows with no more tests
ends there, so a tree closes soon after it widens. The mouse motor widens once on each side of its belt link test.

Widening applies only at the depth limit, so walks that already end don't change. The mouse motor's walk after
creation now ends in every branch in TIM 1; no other walk in either recorded build changes, not even in its text.
Walks that end in every branch went from 422 to 423 in TIM 1, and none stay open. Even More doesn't change (491). The
describing time stays about 6 seconds per build.

## Recordings compared along a walk's branches

Most walks now end only through their branches: the walk stops where an input it doesn't know decides, and each way is
followed as its own branch. The recording comparison used to look at the first walk only, so such a recording could
never be complete. It now follows the branches. The rules:

- Each path through the tree is followed along the recording. The recording's first frame only tells which starts fit:
  a path that starts on another frame is not this recording's.
- A branch whose condition the recording's starting fields rule out is not followed. Those fields only hold at the
  first run, so only the branches that the first run decides are checked against them, together with what the walk
  itself knows there. Later runs may have changed the fields, so later branches are never ruled out by them. Fields a
  trigger writes are left out, since the walk starts after the trigger. A branch that lists alternatives is ruled out
  only when all of them are.
- A branch whose frame differs from the recording's frame at the same run is not the way the recording went. This is
  sound because a split covers every way the walk can go there: a way the analysis can't follow is a stop without
  branches, and that stays open.
- A branch after a split on unknown inputs starts with the next run's frame. A branch on a field's value, or on a value
  after a rope query, starts at the same frame and run. A walk that doesn't know its first frame splits on that frame
  (each branch starts there) or on the rules that give the next frame (each branch starts one run later).
- A walk that joins names where it continues (`joined`: the branch numbers from the first walk and the position in
  that branch's states), and the comparison goes on from there. When the joining walk knew more tests than the place
  it joins, that place may go ways the joining walk can't. Then no frame may choose among those ways: they must all
  repeat the recording, or all disagree with it, or the result stays a prefix. The same holds for a walk that forgot
  fields at the branch depth limit (widening), since it too may go ways the part can't.

The result over all paths the recording allows:

- A prefix when any of them is open: it stops, it ends in a loop of joins that takes no run, or, for a recording that
  ends without a loop, it changes the frame after the recording ends. The prefix length is the fewest frames such a
  path matched.
- Complete when none is open and some path matches forever. A recording that ends without a loop must then keep its
  last frame in every allowed path; a recording with a loop must repeat its cycle. The tree is searched by position
  and by phase of the recorded cycle, so a cycle through joins and branches is checked to the end, with no frame limit.
- Different only when no path matches: every path the starting fields allow shows another frame than the recording at
  some run, or another cycle. The length is the most frames a path matched first.
- Unavailable when the starting fields rule out every way, or no start shows the first frame.

The earlier limits stay: an input case whose starting condition the recording doesn't establish, and a recording that
writes its inputs again while it runs, are prefixes at best. Branches that all agree with the recording count as
complete, so two branches that both rest on the recorded frame prove its ending together.

With this, complete matches went from 456 to 556 in Even More and from 396 to 468 in TIM 1. Prefixes went from 192 to
92 and from 156 to 84, and none is different or unavailable. The electric motor, the vacuum cleaner, the
jack-in-the-box, the alligator, Mel Schlemming, the conveyor belt and the generator now match completely, and 28 of the
monkey bike's 64 recordings do. What stays a prefix has these causes:

- The recorder writes the control value again while it runs (the gear, the bellows, the teeter-totter and the teapot):
  a single trigger can't describe that.
- The recording sets a counter that the walk doesn't carry past the first run, like the windmill's heat of 20, the
  mouse's and mouse motor's 12 or the monkey bike's 20. The walk branches on the counter at every run, so the end of
  the countdown stays open.
- The walk depends on other parts: the cat's search for a mouse and the mouse's list scan.
- A value the analysis doesn't resolve: the mouse motor's and Mel's house's run write the control value with an
  unresolved value.
- A field the recording doesn't save: the bullet's speed.
- The monkey bike on its pedalling frames: the reset walk can't start there (a decided assumption), and the input cases
  for those frames test a value the recording doesn't save.

## Countdowns

Some parts count a field down once a run and stop when it runs out: the windmill's heat at `0x9c`, the mouse's and
the monkey bike's counter at `0x96`, the jack-in-the-box's counter, and the mouse motor's counter at `0x96`, which its
start routine `0x1c074` loads with 100 (the motor runs for about 100 runs after a hit, three to four seconds). A walk
that doesn't know such a counter used to branch on it at every run and forget it right after, so it could never say
when the part stops, and a recording that sets the counter stayed a prefix.

A walk now follows such a countdown. A countdown is a 16-bit part field (not the frame) that some run rule moves by a
fixed number, and that every run rule tests only for being equal to a number after adding numbers to it. While the
walk doesn't know the field, it keeps it as the value the field had where the walk tree started plus how far it moved
since (the fields of `part at the walk's start` and `change since the walk's start`). The rules' tests of the field
become tests of that starting value, which never changes, so a branch's condition says which starting values take it.
When a branch learns the starting value, the field is known again and the walk goes on with plain numbers. Nothing is
chosen: it is exact arithmetic on what the walk knows.

To keep trees small:

- A test of a starting value is forgotten once the countdown moved past it (only tests for the numbers the run tests
  the field for at its value now are kept). Forgetting only drops knowledge.
- A state another branch already followed with the same fields, but with its countdowns at other numbers, joins it
  with a shift (`joined.shift`): this walk goes on like that branch would for a starting value that much larger. That
  branch's tests of starting values, moved by the shift, and all its other tests must be tests this walk knows; tests
  the fields decide count too. When this walk knows more tests, they may only be tests of starting values
  (`joined.startTests`).
- A walk that comes round to the same fields with only a countdown moved forgets how far it moved, so it notices the
  loop.
- A starting value is forgotten once its countdown is known again, so such states join states that never knew it.

A rule stands for the return paths that lead to its frame, joined two at a time where they differ in one test, so a
field those paths set differently is unknown in the rule. The mouse motor's run clears its control value only when the
counter runs out, so its rule left the control value unknown after every run, and the walk branched on it at the next.
When such a rule's paths split on a test of a countdown, and the field it loses is one the run tests, the walk takes the
rule apart into its paths again. Their extra tests must cover every case between them (split on a test and its
opposite until a path has none left), so together they stand for exactly what the rule did. Only the mouse motor's
rule is taken apart in the recorded builds. Its walks after a hit now run 100 runs exactly, flipping between frames 0
and 1, and stop when the counter runs out; after that another hit, or an item lying on it, can start it again (the
list scan at `0x1bff5`), which the walk leaves open.

The recording comparison uses the recording's starting fields as starting values at every run, not only on the first:
a test of a starting value is ruled out whenever the recording gives that value. After a join with a shift it moves
the recorded values by the shift. A join whose walk knew more tests than the place it joins may still have its way
chosen when all those tests are of starting values the recording gives.

Complete matches went from 556 to 560 in Even More and from 468 to 472 in TIM 1, and none is different: the windmill's
turning with heat 20 now matches completely in both builds. The mouse's and the mouse motor's recordings agree to the
end of the countdown and then stay prefixes for the restart the walk leaves open. The monkey bike's agrees to the end
of its countdown on frame 0 too; there the walk tests its control value, which the recording gives only at the start
and the walk doesn't carry past the first run, since it isn't a countdown. Every walk still ends, directly or in all its branches (Even More 1064 walks, TIM 1 902). The mouse has two
input cases less in each build: they were partitions by the counter value 5 that a walk stopping on the unknown counter
asked for, and the walk no longer stops there. Describing takes about 6.4 seconds for Even More and 6.9 for TIM 1,
up from 6.3 and 5.7; most of it is the mouse motor's exact runs after a hit, up to the tree's budget.

## Values a list scan leaves behind

After the mouse motor's countdown ran out, the walk knew its control value at `0x12` was 0, but one run later it
branched on "control value isn't 0" again. The cause is the run at `0x1bfb5`. With the control value at 0 it scans the
parts lying on it (the list scan at `0x1bff5`), and a mouse there calls the start routine `0x1c074`, which sets the
control value to 1 or -1 and the counter at `0x96` to 100. So after the scan the control value is one value of that
run, `part after list scan at 0x1bff5`, and the run stores it back. The rule for "nothing found" tests that value for 0
at `0x1c013` and keeps the frame, but its write stored the unresolved value, so the walk forgot the control value.

A value a list scan, a find-first loop or a query leaves behind is named after that loop's or call's address, so within
one run the same name is the same value. Now, when a rule's condition tests such a value for one number and the rule
stores that same value in a field, the walk knows the field has that number. Nothing is chosen: the rule only applies
when its condition holds. The rule where the scan found something still leaves the control value unknown (1 or -1 by
the flag at `0x08`), and the counter after the scan stays unknown in both rules, since the run doesn't test it there.

In Even More, after a hit the mouse motor now runs its 100 runs, rests on its frame with the control value at 0 and
only splits on whether the list scan finds something, the restart that stays open. Mel's house's walks in Even More
know more fields the same way. Walk endings don't change (Even More 521 end through branches and 577 end directly, TIM 1 450 and 476),
nor do the recording comparisons (564 and 476 complete): the mouse motor's recordings stay prefixes for the restart.

## Fields a path may have changed without a store

Some effects leave a field of the part with one value the run gives it, without storing anything the analysis can
follow: a find-first loop's passes, a list scan, a helper that writes parts reached through ropes. Later reads name
that value ("part after field effect at ..."). A path's rule used to list only the fields it stored, so a field such
an effect may have changed, but that the path never stored again, was missing from the rule. When two rules merged
over one test, a field missing on one side counted as unchanged there, so the merged rule could claim the old value
on that side. A path's rule now lists every such field of the part with the value a read would give, so the merge
keeps it as a possible change.

A list scan marks the fields its body may write on the listed parts. Those marks used to count for the owner too,
though the owner's own memory was already kept: the scan's summary lists every field it may write on the owner as the
owner's (when the query may list the owner, or for a global list), and otherwise the owner is not on the list (the
query's checked comparison of each part with the part that asks, or the external list's contract). So a listed part's
field mark no longer counts for the owner. Most of the merges that left out a marked field came from these marks (the
teapot's `0x36`, the jack-in-the-box's `0x2a` to `0x46`, in Even More and TIM 1), and those rules keep the value they
had, now proved.

In Even More, English floppy, the cat's run (`0x19d80`) changes. Its scan at `0x1a01a` writes the cat's own `0x0a`,
and on 52 of its 120 rules the path forgets that store again later while the field stays marked, so the rule left
`0x0a` out; it now says "part after field effect at 0x1a01a". Its reads of `0x08` after the scan, which only listed parts' `0x08` can change,
are now the cat's own field instead of a value of the run, and the same holds for Mel's house (`0x1e29b`) and the
vacuum cleaner (`0x1e7ee`). The counts don't move (0/925 unresolved, 128 conditional, 0 with unknown writes, 234 with
named run values), the recordings still match 648 of 648, and every walk still ends (722 through branches, 669
directly). TIM 1, French, comes out the same (552 of 552).

A path whose effects are incomplete lists only the fields it stored, too: after a call that keeps the part's state
without a complete footprint of its other fields, or after a store through an untracked pointer, any other field may
have changed. Such a rule is now marked (`effectsIncomplete`), and two rules no longer merge when one of them is
marked and leaves out a field the other lists: the merge would read the missing field as unchanged. They stay apart.
In the measured builds only one routine that no part's callbacks list splits, from 6 rules to 9 (`0xd58f` in Even
More, `0xccde` in TIM 1, already unresolved). 89 rules in each build carry the mark. The part rules, the counts,
the recordings (648 and 552 complete) and the walks (all end) stay the same.
