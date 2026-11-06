# Static behaviour from TIM.EXE

The content reader decodes TIM 1 and Even More code without running the program. The library has no Node APIs or
third-party decoder. It does not use Unicorn, a CPU interpreter, game objects, or v25 callback implementations.

`readBehaviour(program, parts)` accepts the original packed executable and the result of `readProgramParts`. It
checks that the raw records belong to the same image, discovers the callback dispatch and the field used to index
the checked frame-position array, and rejects missing structural evidence. No build-specific code address is used.
The existing part lists are unchanged. The lab runs the analysis in a worker after an import with `TIM.EXE`, which
takes a few seconds, and shows a summary of each part in the Behaviour tab of the Sprites page.

## Reading the report

Every finding contains instruction addresses relative to the unpacked load image, original bytes, decoded text,
confidence and assumptions. A far address also retains its segment and offset. `checked` means a direct instruction
fact; `inferred` includes stated calling-convention or symbolic-analysis assumptions; `unresolved` asserts no
particular interpretation of an unknown value or effect. A transition that tests only values found during its run is
counted as conditional rather than unresolved (see [Conditional rules](#conditional-rules)).

- Each part has six callback references, with its record field, code address, sharing and default-body status.
  The traditional event names remain candidates: dispatch establishes a code pointer more strongly than the
  complete collision, resize or rope semantics of its callers. In record order they are bounce (`+0x22`), run
  (`+0x26`), reset (`+0x2a`), flip (`+0x2e`), resize (`+0x32`) and rope (`+0x36`). Flip and resize were swapped at
  first: the editor's flip action (`0x5314` in Even More, English floppy) checks flag `0x400` and calls `+0x2e`, and
  its width change (`0x11419` to `0x114d8`) calls `+0x32`.
- Each routine has its decoded instructions, control flow edges, disjoint byte extents, direct and indirect calls,
  object-pointer evidence and diagnostics. Calls are separate from jumps in the extent. Indirect initial image
  pointers remain conditional because the program can overwrite them.
- State writes are individual instruction effects, with expressions and the predicates reaching the write.
  Transitions describe the final symbolic state at a return, composing intermediate increments and wrap writes.
  The graph also contains explicit unknown exits at loops and analysis boundaries. Those edges establish gaps,
  not successful explanations of a measured transition.
- Counters retain arithmetic updates and comparisons, including thresholds. Their unit is an invocation of the
  routine containing the update. Conditional gates and resets must be considered before converting a threshold
  into an elapsed duration. No constant frame rate is assigned to a part.
- Reset writes retain all recovered object fields from the reset candidate. Visible effects use only fields
  linked to the drawing and geometry code. Other writes retain their raw object field offsets; an unproved hidden
  flag is not assigned a name.
- Related-object writes have distinct object identities and confidence. `relatedObjectEffects` retains them even
  when the destination part type is unknown. A type comparison can associate an incoming trigger with a part.

## Analysis limits

The x86 decoder stops the routine on an unknown or invalid encoding and names the failing address. It decodes
8086 and the used 80186 instructions, including segment overrides, near and far transfers and operand widths.
Unsupported address-size and operand-size overrides are errors rather than guessed lengths.

The analyser propagates symbolic fields, constants, pointers and expression trees over the control flow graph.
It recognises the object argument through the stack frame and preserves evidence as pointers move through registers
and locals. Losing the pointer produces an unresolved write and invalidates cached fields which the unknown target
could alias. Negative displacements retain 16-bit effective-address arithmetic. Related pointers remain conditional aliases. The
C calling convention assumption preserves SI, DI, BP and DS across calls; volatile results are discarded.

Shared routines have structural summaries describing argument roles, memory footprints and return alternatives.
The analyser applies these relations to the caller's symbolic inputs. Small complete state-changing summaries retain
their conditional return alternatives. Unknown calls invalidate cached object fields. Near helper arguments are
distinguished from far helper arguments by their return instructions. No callback is supplied with a fabricated object.

The summaries distinguish owner-state effects from backend effects. A sound/resource request, for example, retains
unresolved resource and driver effects while conditionally preserving the caller's part state. This conclusion is
inferred under explicit separate-storage and no-hidden-owner-alias assumptions, rather than a claim that the entire
backend has been decoded semantically. Those assumptions propagate into the caller's findings. `helpers` retains the
full evidence, incomplete footprints and return alternatives; an empty return list means no verified return contract.

Bounce dispatch needs a different argument interpretation: it supplies the colliding part, while selecting the callback
from the type of its contact partner. The analyser therefore distinguishes `collider` from the callback owner's `part`.
This prevents a trampoline's activation from being attributed to the part landing on it.

Acyclic paths are analysed separately. Dense switches require an unsigned bounds check and a scaled code-table
index. Sparse switches require a bounded key search, comparison and parallel target table; the proved search is
summarised directly as cases and a default. Bounded counting loops can also be summarised when a unique unit update
occurs on every path, the counter cannot wrap, every path balances the stack, and the body preserves the owner's
state. Other back edges require an invariant and become unknown exits. Summarised loops are not unrolled.
The limits are 12,000 decoded instructions per routine, 1,800 call-graph entries, 12,000 symbolic visits per callback,
800 per helper, and 96 expression-tree nodes. Exhaustion is a diagnostic and an unresolved result. These limits
bound browser work; they are not claims of completeness.

A visit is one instruction on one path, and a part list's loop body is followed again for every path that reaches it.
The run routines of the teapot, the vacuum cleaner and the cat blow or chase the parts their search finds, with about
twenty paths into the list and several branches in its body. They need 5,900 to 8,400 visits, and the cat's run with its find-first loop 10,100, so
the callback limit is 12,000. Each iteration outcome keeps only the writes to the listed member, since the owner's fields are already in
the routine's own outcomes. In Even More this completes 32 more recorded animations; reading a build takes about two
seconds longer.

A list scan can leave a value in a private local, like the mouse's nearest part. That local is named
`local after list scan at <header>` and marked unresolved: its value is unknown, but every later read gives the same
value until the routine writes it again. A walk can therefore branch on a condition that tests it, as it does for
other values the run computes. The local may point to any part, the owner included, so it is never used as the
address of an object of its own; a write through it still loses the pointer. This removes the mouse's 15 stops on
unresolved effects, and 7 stops in each recorded build turn into branches.

## Extracting and validating

Run from the repository root with plain Node or the package scripts:

```sh
pnpm --filter @opentim/content extract-behaviour --out /tmp/tim-behaviour \
  --tim1 '/path/to/TIM 1 build' --evenmore '/path/to/Even More build'
pnpm --filter @opentim/content validate-behaviour --reports /tmp/tim-behaviour \
  --oracle '/path/to/v25/animations.json' --out /tmp/tim-coverage
```

Repeat the game options for every build. Resources can be in the executable folder or its parent, following
`extract-parts`. Extraction writes compact JSON reports, source hashes, per-part Markdown findings, build comparisons
and failures to the output folder. Reports are derived from the games and should not be committed. Large reports
are written incrementally. The library itself returns plain data that the browser can consume.

Validation reads the saved v25 sequences only as an oracle. Its adjacent `models` folder supplies exact source
hashes; `--models` can override that folder. Reports from a different executable are never silently matched to an
oracle. Each changed-state edge and loop closure is checked against the run graph; unchanged steps need an explicit
preserving edge and are counted separately. Reset edges cannot explain run clips. Unknown destinations or predicates
remain unresolved. Unseen static edges are reported separately, and one-frame recordings prove no walk. A nonzero
exit status reports missed edges, missing oracle builds or extraction failures; the JSON and Markdown still explain
those results.

Build comparisons exclude instruction addresses and distinguish differences in resolved findings from differences
in unresolved representations. Relocated global variables and unresolved data-table identities cannot establish a
behaviour difference. Equal partial reports do not prove equality outside their coverage.

## Findings across the supplied builds

All eleven requested builds have complete callback code graphs without unsupported opcodes or unresolved compiler
switches. The five TIM 1 builds and six Even More builds use the same discovered object layout and timing structure:

| Fact                      | Result                                                                             | Qualification                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Callback fields           | Six far pointers at record +0x22 through +0x36                                     | Event names remain inferred                                              |
| Type number               | Object +0x04                                                                       | Loaded to index the 58-byte record table                                 |
| State                     | Object +0x0c                                                                       | Indexes the checked frame-position pairs                                 |
| State snapshot            | Object +0x0e                                                                       | Copies and comparisons are visible; refresh lifecycle remains incomplete |
| State delta               | Object +0x12                                                                       | Added to state in code; its meaning depends on the part                  |
| Drawing flags             | Object +0x08                                                                       | Corrects the unchecked v25 lead naming +0x06                             |
| Reflections               | Masks 0x10 and 0x20                                                                | Derived from reflected coordinate branches                               |
| Piece drawing             | Mask 0x1000 at +0x08                                                               | Selects the checked piece-list field                                     |
| Geometry                  | +0x40/+0x42 extents, +0x44/+0x46 frame dimensions, +0x2a/+0x2c drawing coordinates | Meanings inferred from arithmetic                                        |
| PIT parameter and divisor | 13 and 5041                                                                        | Derived from caller argument and division of 65535                       |
| Cycle wait                | At least eight IRQ counter changes                                                 | About 33.8 ms with the assumed 1,193,182 Hz PIT input                    |

The wait sites are linked through code references to the run dispatcher. This does not prove that every part receives
one run call per wait or that all linked waits are exclusively simulation mode. TIM 1 German has two linked wait
sites; the other ten builds each have one.

The per-part extraction and oracle coverage tables are in the generated output folders. Residual gaps include
contact-list traversal, indirect helper results, conditional inter-part effects and globals. The implementation does
not establish all measured walks; unresolved and missed transitions must be addressed before using these graphs as
complete playback rules.

The fourth-round extraction's exact-hash oracle run covered 644 Even More clips and 548 TIM 1 French clips. It explained
1,834 and 1,318 changed-state steps respectively with inferred assumptions; another 714 and 442 remained unresolved.
None was missing from the graph because boundary edges explicitly retain unknown outcomes. This is partial
coverage, not a proof of all recorded walks.

In that fourth-round comparison, using the same describer on the previous and new reports, complete matching clips increase from 292 to 368
in Even More and from 264 to 344 in TIM 1 French. Of the final complete matches, 60 and 44 contain actual frame
changes; the others are single-frame recordings with independently proved holds. There are 178 and 170 correct
prefixes, zero different comparable walks, and 98 and 34 clips without a compatible established start. Most complete
matches use explicitly conditional inputs rather than proving that an incoming event occurs. The comparison report
retains this distinction for each clip.

That fourth-round Even More English floppy capture had 228 unresolved outcomes out of 964, 12 unresolved call sites, zero pointer losses
and six loop gaps. TIM 1 French has 206 out of 797, 13 calls, zero pointer losses and five loop gaps. All eleven
builds extracted successfully; `readBehaviour` took 2.94–4.23 seconds in the final capture. Description generation
was measured separately at 1.19–1.44 seconds. These times are observations for this machine, not browser guarantees.

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

## Writes through ropes, belts and pulleys

Some helpers write beyond their argument: fields of parts they reach through ropes, belts or pulleys, and fields of
the rope, belt and pulley records on the way. A summary names those in `connected`: the part fields, the record fields
and the part fields that link to records (a belt at `0x54`, ropes at `0x66` and `0x68`). A caller forgets the named
part fields on every tracked object, the owner included, because a reached part can be the owner. It forgets the
record fields only on objects reached through those links, because the records are separate allocations. Every other
field stays known, so the helper no longer makes the caller lose the owner's state and step.

Two rope helpers have such summaries, checked against their complete instruction graphs in every compiler form of the
supplied builds (four forms of the geometry update, two of the reversal). The rope geometry update places a rope's
ends in its own record, updates the rope record of every pulley on the way and sets the end words `0x96` and `0x9c`
of the rope's first part, which is often the caller. The rope reversal swaps the links `0x5a` to `0x60`, `0x6a` and
`0x6c` and the rope records of every pulley on the rope, then the rope's own ends, and notifies its first part; that
notification only queues screen rectangles. Each summary requires its callee to change no part or record.

The belt end check builds on them. It calls a search through the parts lists when a belt end is missing, which
hit-tests each listed part against the point in two globals. A hit can swap the ends of that part's belt record or
turn one of its ropes around, so the check may write what the rope reversal writes plus the belt ends at `0x04` and
`0x06`. The hit test, the search and the check have their own summaries, each requiring its callees' summaries;
the list helpers they use only read.

The byte relay is the last piece. It copies a byte to field `0x14` of the owner and of the parts at the other end of
its ropes and belt, a value the electric parts pass along, and updates the belt and rope geometry on the way.
Its summary combines the belt geometry update, the belt end check and the rope geometry update, each proved as
above. A call can therefore change only `0x14`, the rope end words `0x96` and `0x9c` and the pulley links in a
part, plus fields of belt, rope and pulley records. The owner's state, step, flags and position stay known. In Even
More this frees 62 trigger walks, and about 25 routines per build now have complete effects. All eleven builds
match one of the relay's two compiler forms.

### The rope connection query

The connection query asks the part at the other end of each rope what to do. It calls that part type's rope callback,
the far pointer in field 54 of the type table entry, so the analysis can't follow the call itself. The reader instead
checks that the call goes through that table (by the data segment in TIM 1 and by an explicit segment in Even More),
analyses every rope callback in the table and takes the union of what they write. The teeter-totter's callback asks
its own ropes again, so the union is repeated until it stops growing. A callback may write fields of its own part,
which is the part at the other end, and fields of that part's rope, belt and pulley records. If any callback writes
anything else or has unfinished effects, the query keeps its old open summary.

One assumption makes this sound. It is stated on the summary and on every finding that uses it, and listed with how
to recheck it in [the decided assumptions](behaviour-assumptions.md):

- A rope end's slot number is one of the part's two rope links, so indexing the links at `0x66` by it reaches a rope
  record.

Ropes can form a ring, so a question can come back to the part that asked. The query only skips the part the question
came from, and nothing marks a part as asked, so in a ring of three or more teeter-totters the question goes round and
the asking part's own rope callback runs on it. That callback changes only its own part, and in a ring that part is the
one that asked. The reader finds the routines that call the query: when every one is named directly by the type table
and called by nothing else, the part that asks is of a type that names one of them, and only that type's rope callback
can change it, in the fields it writes on its own part. Those are `connected.askingFields`. If the check fails, they are
every part field a callback writes.

`connected.exceptArgument` names the argument that is the asking part. When a caller passes its own part there, it
forgets the asking fields and keeps every other field; other parts forget every field a callback writes. In all eleven
builds the callers are the teeter-totter's run and rope callback, the callbacks can change fields `0x08`, `0x0c`,
`0x12`, `0x20`, `0x2a`, `0x2c`, `0x44` and `0x46` of other parts and field `0x0e` of their rope records, and the asking
teeter-totter can change only its control value `0x12` and its flags `0x08`.

Until 2026-11-05 the reader assumed that ropes never form a loop and that a rope never ties a part to itself, and let
the asking part keep every field. The user built a ring of teeter-totters in the game that locks them all, so those
two assumptions were dropped (see [the decided assumptions](behaviour-assumptions.md#1-ropes)).

After the call, each asking field of the caller's own part holds one value it can't know: what the field holds right
after that query, named `part after the query at` the call's address. Like a query's answer, it is a value of that
run, and it never becomes an address. When the teeter-totter asks for real (`0x1d2d1`, Even More, English floppy), its
run then adds that control value to its frame. The walk can't know the number, but it is still the teeter-totter's
own control value, so [the decided control values](behaviour-assumptions.md#9-control-values) hold for it: -1, 0 or 1.
The walk follows each of them as its own branch of that same run, with the number put into the run's rules. The
number belongs to that run only: the branch knows the control value it leaves, but the next run's query gives a new
value, which is branched on again. Since the run adds the value to the frame it started the run on, the teeter-totter
is on that frame with that value, so a number that would tip it past an end
([the teeter-totter's ends](behaviour-assumptions.md#10-the-teeter-totters-ends)) isn't followed.

After such a run, the teeter-totter's flags at `0x08` are unknown too, so the next run splits on its flag `0x400`,
the answer of its first query and the frame it came from: nine ways. One step may now split into nine ways instead of
eight.

All 85 walks of the teeter-totter end in each of their branches again, in both recorded builds. Six input cases that
named its control value at frame 0 or 2 are gone: they were only added because the walk stopped there. Over all parts,
walks that end in each branch went from 446 to 491 in Even More and from 377 to 422 in TIM 1, and no walk stops or
stays open in Even More any more (TIM 1 keeps one, from another part). No recording comparison changed (440 complete in
Even More, 388 in TIM 1, none different).

### The scissors' rope cut

When the scissors close, their run routine calls a rope cut. It walks the parts list for ropes, tests each against the
cutting edge and splits a rope it crosses into two: the part factory makes a new rope and two rope ends, and the cut
relinks the parts and pulleys on the old rope. The reader checks the cut's complete instruction graph (eight compiler
forms over the eleven builds, all writing the same fields) and the summaries of the eight routines it calls.

On existing parts a cut can change only the rope and pulley links `0x5a`, `0x5c`, `0x66` and `0x68`, the list links
the insertion rewrites on the new piece's neighbours, and what the rope geometry update names. On the cut rope's own
record it changes the far end `0x04`, the slot byte `0x0b` and the two end points. It never changes a part's state, so
the scissors keep their frame. This needs four stated assumptions, listed with how to recheck them in
[the decided assumptions](behaviour-assumptions.md):

- A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or
  other storage, and releasing a piece that was never linked changes nothing else.
- A rope end's slot number, in bytes `0x0a` and `0x0b` of its rope record, is 0 or 1: one of the part's two rope
  links.
- Rope, belt and pulley records are allocations of their own and never overlap a part.
- The parts list and a pulley chain each end, without cycles.

In each recorded build 4 more recorded animations now match completely, 14 more walks end and 11 more end in every
branch.

### The explosion's wall split

The explosion's run (`0x1a73a` in Even More, English floppy) finds the parts it hits with an overlap search and goes
through them one by one. It sets a balloon's control value to 1, starts a mouse motor, makes a new explosion for
dynamite, pushes loose parts away, and splits a brick or wood wall at `0x1a8ae`. The split copies the wall with the
part copy at `0x66aa`, puts the copy on the parts list and shrinks the wall.

The reader checks the part copy's complete instruction graph (three compiler forms over the eleven builds): it
allocates the copy and its belt, rope and outline records from the allocator the part factory uses, only reads the
source part, and on a failed allocation calls the release, whose graph is checked too. Its summary returns a fresh part
or zero and changes no existing part. That rests on two decided assumptions, listed with how to recheck them in
[the decided assumptions](behaviour-assumptions.md):

- A part copy gets fresh memory, and so do the belt, rope and outline records it makes for the copy: none of it
  overlaps an existing part, a rope, belt or pulley record or other storage.
- Releasing a copy that was never linked, after one of its allocations failed, frees only the copy and the records it
  made for it, and changes nothing else.

A routine's return relation can now become a summary when it also writes to a part it made with the part factory or
the part copy: those writes stay in the fresh part and are left out, as long as no kept write stores the new part's
address. Putting the new part on the parts list may rewrite the list links of any part, so the summary names those.
The wall split then has a summary of what it writes on the wall, and so does the dynamite case, which makes a new
explosion with the factory.

With both, the loop over the parts the explosion hits is proved like the other overlap list loops: the search leaves
out the explosion, the body writes fields of the member, its own stack, globals and the parts list links of any part,
and never the found list's next link at `0x78`. The explosion keeps its frame. All its walks end in both recorded builds, and in each 8 more
recorded animations match completely. TIM 1 has the same routines at other addresses (French: run `0x18dd7`, split
`0x18f4a`, copy `0x5a15`), and the run is proved in all eleven builds.

The balloon's and the mouse motor's triggers "A recorded effect of explosion" are gone. They came from the first part
the unproved loop met. A proved loop's effects on its members are kept as per member outcomes. The ones that change a
part's frame are walks of that part again, see [walks from other parts](#walks-from-other-parts).

### The explosion's push

The push that throws a cat or a ball away from an explosion is part of the same loop (Even More, English floppy). A
member whose list flag `0x1000` in field `0x06` is set, and that is not a balloon (type 4) or dynamite (type 19),
takes three calls:

- `0x1a836` picks a speed from the word at `+0x02` of the member's type record: 6144 below 2, 5632 below 6, 5120
  below 10, 4608 below 21, 4096 below 121, 3584 below 151, 3072 below 201, 2560 below 1801 and 2048 from there on.
  The cat's record has 120, so it gets 4096; a bowling ball (200) gets 3072.
- `0x496e` gives the angle of the line between the centres (position plus half the size) of the explosion and the
  member, with the movement angle helper.
- `0x7d97` sets `velocityX` (`0x36`) and `velocityY` (`0x38`) to that speed times the sine and the cosine of the angle,
  shifted right by 14. It replaces the member's speed; it doesn't add to it.

The pinball bumper's bounce calls the same two helpers with its arguments in the same order to throw the ball off, so
the speed points from the explosion's centre to the member's. The flag `0x1000` marks a part on the moving parts list:
the routine at `0x6469` gives a part `0x1000` and puts it on that list when its type's starting flags (the table at
`0x2488` in the data segment) don't have `0x4000`, and `0x2000` with the fixed parts list otherwise. The overlap
search at `0x417e` gets the mask `0x3000`, so it walks both lists, and leaves out a part with `0x2000` in field `0x08`.
The cat has no `0x4000`, and every cat that a shipped level puts in the machine is saved with `0x1000`. The search
runs once, on the step where the explosion goes from frame 1 to frame 2, over its own box widened by 20 pixels on
each side and 24 above and below.

The analysis already has this: the explosion's member outcomes write `0x36` and `0x38` on these paths, and its
description lists them as "Updates another part's motion". Their values stay unnamed. A push changes no frame, so a
walk from it would show nothing new. TIM 1 has the same code (French: test at `0x18e31`, speed `0x18ed6`, angle
`0x3dd6`, speeds `0x726d`), with the type record read from the data segment. The next section shows the push on the
pushed part's own description.

### Effects of other parts

A part's description now lists what other parts do to it without changing its frame, as short lines in
`effectsFromOthers` instead of walks. The first is the explosion's push: "An explosion that reaches it sets its speed
to 4096, away from the explosion. Only when it is on the moving list." Turning the explosion's member
outcomes into trigger walks was tried first: it added about 1,230 walks and made describing a build take 95 seconds
instead of 6, and a push shows no new frame anyway.

Four things make the line possible:

- **The speed setter.** The routine at `0x7d97` is now proved from its whole instruction graph, in two compiler forms
  over the eleven builds (the English CD calls the shift far). It takes a part, an angle and a speed, and sets
  `velocityX` (`0x36`) and `velocityY` (`0x38`) to the speed times the coefficient a quarter turn on and the plain
  coefficient of the angle, each shifted right by 14. The coefficients come from the same checked table as the
  collision rotation, and both fields are always written. The written values stay unknown, since the angle is, but a
  caller now keeps the speed it passed with the two fields (`directedSpeed`), until something else writes them. In the
  explosion's loop that speed is one number on each path, from the speed class of `0x1a836`. The pinball bumper's
  bounce passes 7168.
- **The centre angle.** See [the push's direction](#the-pushs-direction) below: it proves that the speed points away
  from the explosion.
- **The type table.** The report keeps the words of every type record (`typeTable`), so a table read the analysis
  keeps, like the mass at `+0x02` that picks the speed class, can be looked up for a known type. The line states that
  the record keeps its words from the program while a level runs.
- **The starting flags.** The part factory's summary now lists the words a new part gets from the factory's
  type-indexed table (`startingWords`), such as the list flags at `0x06`. Together with
  [the decided assumption on the fixed list](behaviour-assumptions.md#11-parts-on-the-fixed-list), a part of a type
  with `0x4000` there gets no push line.

A line is made from a proved per-member outcome of another part's routine when, for this part's type:

- the outcome's tests on the member are decided by its type and the type table, apart from which list it is on, which
  becomes the line's condition ("on the moving list");
- the outcome writes only the member, and every field it writes gets a number: a constant, or a speed;
- it doesn't write the part's state, or any field that the part's own rules read. Such a write can change the frame,
  and walks are the place for that.

The source's own tests stay as the line's source condition (for the explosion: going from frame 1 to frame 2), and a
named drawing flag among them is said in words, like "mirrored". Lines that say the same are kept once.

In Even More (English floppy) these parts get the push, with their speed: the cannonball 2048; the rocket, the rope end
and the shamrock 2560; the bowling ball 3072; the birdcage 3584; the cat, the bucket, the jack-o-lantern, the cheese,
the teapot and the pool ball 4096; the basketball, the candle and the super ball 4608; the baseball 5120; the heart and
the tennis ball 5632; the mouse and the explosion 6144. TIM 1 gives the same speeds to the parts it has. The same rule
also finds the jack-in-the-box's punch, which sets both velocities from the same speed classes: for the cat -4096 and
-4096, or 4096 and -4096 when the box is mirrored. A line that sets both velocities to numbers says where that moves
the part on the screen, with the numbers after it: "sets its velocity up and to the left (velocityX -4096, velocityY
-4096)". That a negative velocity moves a part left or up is what the user saw in the game, recorded as
[the decided assumption on screen directions](behaviour-assumptions.md#12-screen-directions): the code shows that a
velocity has the sign of its position's change, but not how a position maps to the screen. The lab's row shows the direction,
like "Jack-in-the-box up and to the left", and keeps the numbers in its tip.

These effects of other parts are left out, so they are known gaps:

- The balloon's control value set to 1 by the explosion, the mouse motor the explosion starts, and the fish bowl and
  the dynamite it sets to frame 11 and 5: these change the frame, so they are walks, see
  [walks from other parts](#walks-from-other-parts).
- The push on the bullet and on Mel Schlemming: their own rules read their velocity, so these are walks, see
  [hits found by a search's flags](#hits-found-by-a-searchs-flags).
- The wall split: it writes the wall's position and size, but with values that depend on where the explosion is.
- Every other per-member outcome, like those of the bellows, the fan, the teapot and the vacuum cleaner: each writes a
  value the analysis doesn't know, writes the state or a field the part's rules read, or depends on more than the
  part's type, like where the part is.

Describing a build takes as long as before (about 6 seconds for Even More and 5.5 for TIM 1), and no walk changes.
The lab shows the lines in the Behaviour tab, under "From other parts": one row each, with the other part's name, what
it sets and the value, and a chip for what either part must be.

### The push's direction

The explosion's run gives the speed setter the answer of the routine at `0x496e` (Even More, English floppy) as its
angle. That routine is now proved from its whole instruction graph, in three compiler forms over the eleven builds
(TIM 1 reloads the answer before it returns, and the Even More demo pushes a word straight from DX). It takes two
parts, works out each centre as the position plus half the frame size (`0x1e` plus `0x44` halved with an arithmetic
shift, and `0x20` plus `0x46`), and gives the movement angle helper at `0x2ede0` the first centre minus the second
across and the second minus the first down, each as a sign-extended word. That helper was already proved from its
whole graph, with its loaded table of 512 words.

A caller now keeps which two parts an answer is of with the answer, through registers, its own locals and pushes,
until something else is computed from it. When the speed setter gets such an answer as its angle, the speed it keeps
with the velocity fields says so too (`direction`). In the explosion's loop the first part is the explosion and the
second the part it hits; in the pinball bumper's bounce they are the bumper and the ball.

Whether the velocity then points from the first centre to the second can't be read from the instructions alone: it
depends on the two tables. `directionError` checks it over everything the helper can answer. The helper folds every
direction into one eighth of a turn, picks a table word by the ratio of the smaller difference to the larger in steps
of 1/512, and folds back. So each of its about 4,100 answers stands for a known range of true directions. For each
one the check works out the velocity the setter gives, with the program's own table words and the setter's integer
arithmetic, and the largest angle to any direction in the range. Host trigonometry is only used for the true
directions. Over every speed the explosion and the bumper use, in all eleven builds, the velocity is within 0.23
degrees of the line from the explosion's centre to the part's centre. A line only says "away from the explosion"
when this check passes for its speed; otherwise it keeps "in a direction the explosion works out". The line keeps
the bound with the speed (`away`). The lab's row then reads "speed away", with the bound in its tip.

This rests on two things the line states. The tables must keep their words from the program, as the helpers'
existing assumptions already say. And the centres must be less than 32768 apart across and down, so the word
differences are the true ones. When the two centres are the same point there is no direction: the helper answers a
quarter turn, and the setter puts the whole speed into `velocityY`.

The jack-in-the-box's punch doesn't use the centre angle: it sets fixed numbers, chosen by whether the box is
mirrored. Its lines say the direction on the screen instead, as described above.

### Walks from other parts

When an explosion hits a balloon, the balloon pops; when it hits a mouse motor, the mouse starts running. The user saw
both in the game. The explosion's loop gives these as per member outcomes: it sets a balloon's control value (`0x12`)
to 1, and it calls the mouse motor's start at `0x1c074` (Even More, English floppy). They are now walks of the part
that is hit, with the trigger "Hit by an explosion".

The mouse motor's start first needed its stores to have conditions. It sets the step at `0x12` to -1 when the motor is
mirrored and to 1 otherwise, and the counter at `0x96` to 100 on every path. A helper that only updates its part's
fields was summarised with its stores but without the tests that pick them. The reader now walks every path of such a
helper (`behaviour-owner-paths.ts`) and gives each plain store the tests of the part's own fields that lead to it, when
they decide it: every path through the store makes those tests, the store is the last one to its field there, and
every other path fails one of them. A test only counts when no store or call before it may change the field it reads,
and an `or` or `inc` sets no value. The counter's store gets no condition at all, so a caller knows the counter is 100.
When a loop passes the member it looks at to such a helper and the helper's tests aren't decided yet, the pass splits
on them, so each member outcome knows the step it sets. Of the helpers in Even More the mouse motor's start, the eye
hook's at `0x1aaaa` and the light bulb's at `0x1bbef` (whose stored values stay unknown) get conditions, and only the
start is called on a loop's member: by the explosion, the alligator, the boxing glove, the jack-in-the-box and the teapot. TIM 1 has the same start at `0x1a78b` (French).

The walks come from `hitsFromOthers` (`describe-hits.ts`), which works out each part type's hits from every proved per
member outcome of another part's routine, like the lines in [effects of other parts](#effects-of-other-parts):

- The source's tests on the member must name this part's type (`member type == 4`). A search can hold parts its owner
  never acts on: the candle's first loop sets `0x12` to 1 on every part its search finds, and that search keeps only
  parts with a flag in field `0x0a` that the outcome doesn't show. Without a named type such an outcome gets no walk,
  unless the search's own tests are known, see [hits found by a search's flags](#hits-found-by-a-searchs-flags).
- The member's other tests are worked out for the type, with the type table and the decided assumption on the fixed
  list. What is left, like being mirrored or on the moving list, is a test on the part's own fields that the walk keeps.
  The source's tests of its own fields, like the explosion going to frame 2, are left out.
- The outcome must write a field the part's rules read, or its state, and every such field must get a number. Other
  fields it writes are kept too, as their number or as unknown.
- Outcomes that leave the same numbers in the fields the rules read share one walk, whichever part and path they come
  from. That walk keeps only the tests all of them make, so it may start from more frames than a single path would.

Each hit is walked from the part's reset fields and from each documented stable state, like a callback. In Even More
(English floppy) 8 parts get 11 walks:

- the balloon, control value 1, from a candle, an explosion or a rocket: it pops;
- the mouse motor, step -1 or 1 by whether it is mirrored and counter 100 (two walks), from an alligator, a boxing
  glove, an explosion, a jack-in-the-box or a teapot;
- the cat, frame 1, from a candle or a rocket;
- the fish bowl, frame 11, from an alligator, a boxing glove, an explosion or a jack-in-the-box;
- the dynamite, frame 5, from an explosion (three walks, with its two stable states);
- the windmill, control value 1 and counter 20, from the bellows or a teapot;
- the candle, frame 0 and control value 0, from the bellows, a fan or a teapot;
- the teapot, control value 1, from a candle or a rocket.

TIM 1 (French) gets the same walks for the parts it has, 10 in all. Every one of them ends. The lab shows them in the
Behaviour tab by walk, under "hit by" and the parts that do it.
Describing takes about 6.1 seconds for Even More instead of 5.6, and 5.5 for TIM 1 instead of 5.3. The recordings
match as before: 556 and 468 complete, none different.

The push on the bullet and on Mel Schlemming, and what the candle's first loop lights, are walks now too, see the next
section.

### Hits found by a search's flags

The jack-in-the-box's punch sets the velocity of every part on the moving list that it finds, and the candle's first
loop sets the control value at `0x12` to 1 on every part it finds that isn't lit yet. Neither names a type, so the rule
above gave them no walk: a search may keep only some parts, by tests the loop's outcome doesn't show. The reader now
reads those tests from the search itself.

**The search's tests.** An overlap query (`behaviour-helpers.ts`) now lists the flag tests that decide whether it keeps
a part (`memberTests`). Each is a `test word [part+X], mask` with a `je` or `jne` to the instruction after the link-in,
or the form some builds use, a `je` over a `jmp` there. Every other conditional branch that follows a compare of the
part's fields must only pick between two ways that meet again with no store outside the stack, like the wider box the
search gives type 62. Otherwise, as for a type test that leaves a part out, the query gets no list. Compares of the
position and size were already taken as the spatial test. In Even More (English floppy):

- the search at `0x42da`, which the punch uses (call at `0x1b92f`), leaves out a part with `0x2000` in field `0x08`
  (`0x430b`), and keeps the rest that overlap its box;
- the search at `0x448e`, the candle's first (call at `0x19ab2`), leaves out the same parts (`0x44c0`) and keeps only
  parts with `0x0004` in field `0x0a` (`0x44c7`) whose point lies in its box.

TIM 1 (French) has both, at `0x370f` and `0x38ea`, in the jump-over form. The explosion's search at `0x417e` writes
more fields after the link-in, so its tests are not read; it names its types anyway.

**The flags a type gets.** The part factory now also lists the flags each type's constructor ORs into the new part in
its first straight run of code, before any branch, call or return (`constructorFlags`). Only `0x0004` in field `0x0a`
matters here: the constructors of the cannon (`0x162c9`), the dynamite (`0x16306`), the rocket (`0x1664f`) and the
candle (`0x167ea`) set it, and the factory's own table gives it to no type.

**The walk.** When a loop's outcome names no type, `hitsFromOthers` takes the tests of the searches that fill the list
(those all of them make, when there are several). A part type gets the walk only when the program gives it every flag
the search needs: from the factory's table or from its constructor. The walk keeps every test of the search on the
part, so it still says "only when it has `0x0004` in field `0x0a`" and "only without `0x2000` in field `0x08`": a level
stores these words, so a part may have other flags than its constructor gives. The part reader (`0x13653`) reads the
second word into `0x08` (`0x1368f`) and, in a level of version `0x101` or later (`0x13692`), the third into `0x0a`
(`0x136a4`), clearing only `0x0010` there (`0x136a9`). The rest is as for other hits.

In Even More (English floppy) this adds 8 walks, all of which end:

- the bullet, punched up and to the left or up and to the right (velocityX -2048 or 2048, velocityY -2048), only when on
  the moving list (two walks);
- Mel Schlemming, velocityY -4096 (one walk; the velocityX his rules don't read stays unknown, since a mirrored box
  sets the other sign);
- the cannon, the dynamite (with its stable state, two walks), the rocket and the candle: "Hit by a candle or a
  rocket", control value 1 when it was 0. The rocket's run has the same first search.

TIM 1 (French) gets the same walks for the parts it has, 7 in all. Walks that end, before and after: Even More 1,064
and 1,072, TIM 1 902 and 909, and no part has a walk that stops.

In the shipped levels (Even More, English floppy, and TIM 1, French), every cannon, candle, dynamite and rocket is
saved with `0x0004` in its third flags word and no other part is, and no part is saved with `0x2000` in its second.
No level saves a bullet, and the gun doesn't give the bullets it makes `0x1000`, so the bullet's walks may never
happen in a game; the walk keeps the test.

### Lightable parts

[Assumption 17](behaviour-assumptions.md#17-parts-the-candle-can-light) settles the first point of the section above:
only the cannon, the dynamite, the rocket and the candle are marked as lightable (`0x0004` in field `0x0a`), and they
always are. `hitsFromOthers` takes that flag as known for every part: set for these four, clear for the rest. Their
"Hit by a candle or a rocket" walks no longer keep the flag test as a condition; a walk still needs the type's
constructor to set the flag. Other types still get no such walk. The ones whose rules read the control value, which
would otherwise get one, state the assumption in their description, like the balloon and the teapot (21 types in Even
More, English floppy).

No walk is added or lost: walks that end stay at 1,098 in Even More and 926 in TIM 1, and the recordings match as
before, 564 and 476 complete, none different.

### The bullet and the jack-in-the-box

[Assumption 18](behaviour-assumptions.md#18-the-bullet-and-the-jack-in-the-box) settles the second point: a bullet
never has `0x1000` at `0x06`, so the jack-in-the-box never punches it. It works like the assumption on the fixed list
(`offMovingList` in `describe-effects.ts` gives either one), but only for the bullet. The bullet's two punch walks are
gone, and the bullet states the assumption in its description instead. The effect lines take it too, though the
bullet had none.

Walks that end, before and after: Even More 1,098 and 1,096, TIM 1 926 and 924. No part has a walk that stops, and
the recordings match as before: 564 and 476 complete, none different.

### Walks from parts that touch

The contact dispatch (`0x1078` and `0x10bc` in Even More) goes through the moving parts. For one that touched another
part, it calls the bounce callback of the touched part's type, with the moving part as its argument: the analysis
calls it `collider`, and `part` is the touched part. So a bounce callback's writes to `collider` are what the touched
part does to the part that touches it.

`hitsFromOthers` now also reads these outcomes, the same way as a loop's member outcomes: the tests on `collider` must
name the part's type, every write must be to `collider`, and tests of the touched part itself are its own business. The
walk is named "Touching a thumb tack" and kept apart from the "Hit by" walks, even when it writes the same. Its
assumption says the part touches the source, not that a level makes it happen.

In Even More the balloon gets "Touching a bullet, a gear, a scissors or a thumb tack": each sets its control value at
`0x12` to 1, so it pops. The thumb tack does it only at contact angles `0x5e00`, `0x8000` and `0x9c90` (`0x1e2ce`),
which the walk keeps as its condition. Mel Schlemming gets four walks for touching another Mel. TIM 1 has the bullet,
gear and scissors for the balloon. Bounce outcomes that also change the touched part, like the trampoline's and the
electric switch's, or that write values that aren't numbers, like the alligator's, get no walk.
Those that change the touching part without changing its frame get a line instead, see the next section.

### Effects of parts that touch

Most of what a bounce does to the part that touches it changes no frame: the conveyor belt changes its `velocityX`,
the alligator throws it up, the pinball bumper gives it a new speed. These are now lines in `effectsFromOthers`, like
the explosion's push, and the lab shows them with a "touching" chip. In Even More (English floppy) a basketball gets,
among others:

- "A conveyor belt it touches, when the conveyor belt's stateDelta is at least 1, adds 4096 to velocityX. Only when its
  contactEdge is 0 and its velocityX + 4096 is at most 4096. Its bounce returns 1 then, so the game may go on to a
  contact response, which can change these again."
- "An alligator it touches, when the alligator is not mirrored, sets velocityY to -|velocityY|. Only when its
  contactEdge is 0 and |its velocityY| is at least 1536 and ..."
- "A pinball bumper it touches sets its speed to 7168, away from the pinball bumper. Its bounce returns 0 then, so no
  contact response follows."

A bounce path gives a line for a part type when:

- its effects are complete and it writes only the touching part (`collider`) and the touched part (`part`). What it
  does to the touched part is that part's own business, and the line doesn't say it;
- every value it writes on the touching part is a number, a speed the speed setter got (as for the explosion), or
  worked out from the touching part's own fields when the bounce is called, like `velocityX >> 1`. A value that reads
  the touched part, a table or something unknown gives no line;
- it writes no field the part's own rules read, and not its state. Those are walks, see the section above;
- its tests of the touching part's type pass for the type. Tests that name a type, like the alligator's for the mouse
  (type 42), give the line to that type only; the others go on every type that can move. Its other tests stay as the
  line's conditions, in words: of the touching part ("its contactEdge is 0"), of the touched part ("the alligator is
  mirrored") and of the two together ("its centre x - the trampoline's centre x is between -14 and 14").

The contact dispatch walks the moving parts list (head `0x4d7d` in Even More, English floppy, the list the routine at
`0x6469` puts a dropped part on at `0x649a`; TIM 1 French `0x52f9`, at `0x57ee`). So a part of a fixed type never
touches, by [the decided assumption on the fixed list](behaviour-assumptions.md#11-parts-on-the-fixed-list), and states
it instead of the lines. The assumption on the bullet doesn't apply here: the gun links each bullet into this list
itself. In Even More the game also calls Mel Schlemming's bounce on Mel himself, with what he touched as `part`, so
Mel's own bounce gives Mel no line.

A bounce reaches the same writes on many paths, like the pinball bumper's on four. The paths that set the same and
return the same are joined: each path's tests become the values each tested expression may take, a path whose cases
another already covers is left out, and two paths that differ only in one expression's values become one when the
values together are still one range. A test every value passes drops out, so the bumper's four paths give one line
without tests. Joining only unites whole paths, so a line holds exactly when one of its paths' tests hold.

What the bounce returns decides what follows: 0 skips the contact response, and another number lets the dispatch
pick one by the part's flags, which can change the velocity again (see [contact callbacks and response
selection](#contact-callbacks-and-response-selection)). The line says which. The words read the compiler's absolute
value `(x ^ (x >> 15)) - (x >> 15)` as `|x|`, a position plus half the frame size as the centre, and the trampoline's
two words at `0x1a` and `0x1c` as one long, positionY times 512 with its sign.

In Even More (English floppy) this gives 441 lines on 24 part types:

- 20 types that can move get 19 each: 12 from the conveyor belt, 4 from the alligator, 2 from the trampoline and 1
  from the pinball bumper (the bowling ball, balloon, basketball, birdcage, bucket, dynamite, baseball,
  jack-o-lantern, heart, rocket, explosion, cannonball, tennis ball, candle, rope end, cheese, super ball, teapot, pool
  ball and shamrock);
- the cat gets no trampoline lines, and the mouse none either but 8 from the alligator: their rules read the list flags
  at `0x06`, where the trampoline clears `0x0001`. The alligator's other 4 lines for the mouse set `0x2000` in its
  drawing flags and `0x0200` in field `0x0a`, which takes it out of the contact dispatch;
- Mel Schlemming gets the conveyor belt's, the alligator's and the trampoline's, but not the bumper's: his rules read
  `velocityY`;
- the bullet gets the alligator's 4 and the trampoline's that keeps `velocityX`, since its rules read `velocityX`.

TIM 1 (French) has no alligator or bumper and a simpler conveyor belt: 167 lines, 10 each for 15 types (8 from the
conveyor belt, 2 from the trampoline), 8 for the cat and the mouse and 1 for the bullet. No walk changes, the lines of
other parts stay the same, and the recordings match as before: 596 and 504 complete, none different. Describing a build
takes about as long as before.

These touch outcomes still give no line:

- The vacuum cleaner's (`0x1e5af`): it changes fields `0x08`, `0x0a` and `0x12` through a helper whose values the
  analysis doesn't know.
- The electric switch's (`0x1a5d8`): it subtracts 1 from a bullet's `velocityX`, which the bullet's rules read. As the
  value isn't a number, it is no walk either.
- The teeter-totter's: its paths depend on a query's answer and stay unresolved.
- The trampoline's paths for Mel that return 1: they read the frame tables and set `velocityY`, which Mel's rules read.

What the user sees in the game (asked on 2026-11-06) fits two of these lines:

- The alligator bounces a ball up off its back, but not off its head. The code only bounces the ball near one end of
  the alligator: when the ball's centre is past the alligator's position plus 64, or before its position plus 16 when
  it is mirrored. That this end is the back and not the head is what the user saw, not something the code shows.
- A running conveyor belt pushes a ball under it against the belt's direction, as its bounce does on the underside.

### Touch lines with cases

The gear's push gave each moving part 96 lines: 2 turning directions, each read from two state differences, times 8
edges, times the limit cases. Paths whose tests differ in more than one value can't be joined into one test, so they
stayed apart. Lines from the same routine that set the same and return the same are now one line with `cases`: each
path's tests, in words, and a line holds when one case holds. The tests every case makes stay on the line. A
basketball now gets 24 lines from the gear, like "A gear it touches adds 4096 to velocityX in 4 cases: (1) when ...".
The lab shows a "N cases" chip and lists them in the row's tip.

### Exact helper stores

The gear's bounce (`0x1b032` in Even More, English floppy) used to give no line. It pushes the part that touches it
through four small helpers, each given the part and an amount `s` (4096 or 2048):

- `0x1afc2` and `0x1affa` add `s` to `velocityX` or `velocityY`, and set it to `s` when the sum is above `s`;
- `0x1afdc` and `0x1b014` subtract `s`, and set it to `-s` when the difference is below `s`. That is not the mirror of
  the first two: a part still moving the other way at less than twice `s` gets `-s` at once.

The owner paths reader only knew stores of numbers under tests of a field against a number, so their summaries kept
the written values unknown. A second reader (`ownerPathStores`) now follows every path of such a helper exactly, when
it makes no calls: registers, locals and the part's fields hold values worked out from the part's fields and the
helper's arguments as it got them, and each test compares two such values, like `velocityX - s` with `s`. For each
field it gives the value each path leaves, with that path's tests, and joins paths that leave the same value the way
the first reader does. It reads `mov`, `add`, `sub`, `and`, `or`, `xor`, `inc`, `dec`, `neg`, `cmp` and `test` on words
(and fields of a byte), and the branches that follow a `cmp` or `test`. Any other instruction, a call, a store
elsewhere, a byte register or a value it can't work out, and the helper keeps its old summary. It only fills in fields
the first reader left open, so the stores that reader proved keep their tests.

A bounce now splits on these tests when it passes the part that touched it (`collider`), as a loop already did for a
member it observes, so each outcome knows the exact value. The gear's 40 bounce outcomes become 104, all with exact
writes. Over the eleven builds the four helpers have one compiler form, and all 44 are proved. The reader also proves
helpers the first reader left open elsewhere (the state helper at `0x1ce45` that ors 1 and 2 into the state, and
helpers at `0x1badd`, `0x1bb2e` and `0x1bbb8` that test a position against their argument), but no walk changes.

What the gear does to a part that touches it, by the code: it compares its state with its previous state, so it acts
only while it turns. Which way it pushes follows where it was touched: `contactEdge`, which the contact search sets
to the index of the gear's outline edge (or corner) it met, counted from corner (8, 0) of its octagon. Turning one
way (the state went up by one, or wrapped from the last frame to the first) it pushes along its rim: on edge 0 (the
top) right, on edge 2 (the right side) down, on edge 4 (the bottom) left, on edge 6 (the left side) up, and on the
slanted edges between both ways at once with half the amount. Turning the other way, it pushes the opposite way. A
balloon (type 4) pops instead. The bounce returns 1, so a contact response may follow.

In Even More (English floppy) the touch lines grow from 441 to 2,489: 96 from the gear for each of the 21 types that
can move and don't read the velocity (2 turning directions, each read from two state differences, times the 8 edges
and the limits each push may meet), 16 for Mel Schlemming (those that leave `velocityY`, which his rules read) and 16
for the bullet (those that leave `velocityX`). The balloon gets none. TIM 1 (French) grows from 167 to 1,719 the same
way: 96 for 16 types and 16 for the bullet. No walk changes, and the recordings match as before: 596 and 504
complete, none different.

The gear picks its push through a jump table, so its tests first read like "its contactEdge is at most 7 (unsigned)
and its contactEdge << 1 is 4". The touch tests now say such a test of `x << n` as a test of `x` when another test (or
a mask like `& 7`) keeps `x` below the bits the shift keeps, since `x << n` is then `x` times `2^n`, and drop a test
that every value the expression can take passes, like `(x & 7) <= 7`. The line then reads "its contactEdge is 2". A
line in Even More (English floppy) for a basketball:

- "A gear it touches, when the gear's state - the gear's previousState is 1, sets velocityX to -4096. Only when its
  contactEdge is 4 and its velocityX - 4096 is at most 4095. Its bounce returns 1 then, so the game may go on to a
  contact response, which can change these again."

No other part's lines change.

### The outline search

The teeter-totter finds the parts lying on it with an outline search. It clears the owner's found list at `0x78`,
walks the parts lists its caller's mask allows, tests every edge of each part's outline against a shape the caller
gives, and puts each part with a crossing edge at the front of the list. The reader checks its complete instruction
graph (three compiler forms over the eleven builds) and its list helpers. Unlike the other overlap queries it does not
skip the owner, so the list may hold the teeter-totter itself.

A loop over such a list is still proved, with two extra rules. The body may never write a listed part's state, and
every other field it writes on a listed part counts as a possible write to the owner too. The teeter-totter keeps its
frame, and forgets the positions it writes on the parts lying on it. Its assumptions are listed in
[the decided assumptions](behaviour-assumptions.md). In each recorded build this removes 24
unresolved transitions and 9 more walks end.

### Find-first loops

The cat looks through the parts its search found, one by one, until one is a mouse close enough to chase; then it
moves, picks its frame and stops looking. A pass that goes on may still change things: it marks the cat and a mouse it
passes, and plays a sound. The reader proves such a loop from its code. A pass that goes on to the next member may
change only fields of the owner other than its state, fields of the member, private locals, registers and globals;
every other write and every other call lies on a path that clears the member pointer and so ends the walk. Writes to
the member are allowed only when the list comes from a search that leaves out the owner on every path.

Then the loop either goes on to the end of the list or acts once for one member, whichever it is. At the loop head the
analysis follows two cases instead of the passes: no member acted on, and one member, an opaque `member found by the
loop`, acted on. Both start from the state after any number of passes: what a pass may change is forgotten, the
owner's fields read as their value after the loop, and its locals and registers as one named value each, never used as
an address. A pass that goes on is then covered by those two cases and is not followed again. If a pass that goes on
could change the owner's state, the loop keeps needing an invariant.

This finishes the cat's run routine in every build. Its walks then still stopped where the cat tests whether its new
position is blocked; see the query answers below.

A loop's own evidence now cites the calls in its body rather than copying the called summaries' evidence; each summary
keeps its evidence in `helpers`. Findings that say the same thing are kept once, whichever path proved them. Both keep
the reports and the analysis time small.

### Query answers

After the cat moves 32 pixels, it calls the routine at `0x4a36` (Even More, English floppy) and tests its answer: when
the new spot is blocked, it moves back and tries the other way. That routine is a `private-buffer-query`: it reads its
inputs and writes nothing but its own stack, so all a call gives back is one word in AX. That answer depends on where
the other parts are, so the analysis can't know it, but it is one value. The reader now names it `answer of the query
at` the call's address, as an unresolved field, instead of an opaque unknown. A condition on it can then be decided as
a value of that run, like the result of a contact scan, and the walks can branch on it: blocked or free. It never
becomes an address. Other helpers' results stay opaque.

The cat's run rules no longer contain an opaque unknown, so their walks don't stop there any more.

### Answers that lead to the same frame

When both answers of a test lead to the same next frame, the reader joins the two rules into one without that test
(see [Descriptions and conditional frame walks](#descriptions-and-conditional-frame-walks)). A rule is unresolved when
its condition or its next frame holds a value the analysis doesn't know, like a query's answer. If that answer was the
only such value and the joined rule no longer tests it, the frame path no longer depends on it, so the joined rule is
no longer unresolved. This needs every path of the routine to have known effects: a path that lost track of a write
could have made the rule unresolved for another reason, and then the rule stays unresolved. A field the two answers
write differently keeps both values, chosen by the answer (see [Values two paths set differently](#values-two-paths-set-differently)).

The teeter-totter's bounce asks a query and its rope callback asks along the rope; their frame does not depend on the
answers. In each recorded build its unresolved transitions go from 15 to 6, and no walk changes.

### Values two paths set differently

Two return paths that lead to the same frame and differ only in one test and its opposite are joined into one rule.
When they write a field differently, the joined rule used to call the field unknown ("differs on complementary
paths"), although both values were known. It now keeps both: the field is `(test) * a + (opposite) * b`, with each
test 0 or 1, the same form the drawing fields already had. Exactly one of the two tests holds, so the value is exact.
This works for every comparison: the values compare as unsigned numbers, so a signed test (`jl`, `jg` and the like)
compares both sides with their sign bit turned round, which orders them the same way. A value or a side of the test
that is unknown keeps the joined value unknown, with that value's own reason. `choiceOf` gives the test and the two
values back; the lab shows such a value as "3 if test, else 5". A walk works the value out when it knows the fields
the test reads, and otherwise forgets it, as it did with the unknown value. A rule whose paths split on a countdown
is still taken apart into its paths, as in [Countdowns](#countdowns).

Rules that write an unknown value go from 365 to 247 of 925 in Even More, English floppy, and from 324 to 223 of 764
in TIM 1, French. No write is unknown only because of the join any more: what is left is unknown for its own reason,
like a related part a helper may change or a field after a list scan. In 4 rules of the teeter-totter in each build
both values are known but a query's answer picks one, so they still count. Every walk still ends and no recording
comparison changes; the rocket's walks from frames 0 and 7 now know its field `0x84` after frame 7, so they repeat one
cycle later, with the same frames.

### Conditional rules

Many rules depend on what the part finds during that step: whether the cat sees a mouse, whether its new spot is
blocked, which part the mouse finds nearest, whether the mouse motor touches a mouse. The analysis names such a value
(the answer of a query, a part a loop found, a local or an owner field a list scan leaves behind, a field after a rope
query) and keeps it as one unknown value of that run. A rule that tests it says what happens for each value the run
finds; the rules for every value together cover all cases, and no value is chosen.

Such a rule is conditional, not unresolved, when every unknown in its condition and its next frame is one of those
named values and no path of its routine lost track of an effect. It lists them in `runValues`. It keeps its
`unresolved` confidence, because the walks still branch on those values and do not carry them to the next step.
The counts treat it as conditional: `transitionCounts` gives unresolved rules without them, conditional rules, and,
apart from both, rules that write a field whose value is still unknown, so the writes that remain open are not hidden.
The extraction notes and the comparison table show all three.

A field of the owner that a list scan may change is now named `part after list scan at` the scan's address, like a
local the scan leaves behind, instead of an unknown write. This names the mouse motor's and Mel's house's control
value after their scan.

In Even More, unresolved transitions go from 128 to 2 and 126 are conditional; in TIM 1 from 122 to 2, with 120
conditional. The 2 left in each build are the magnifying glass: its run calls a helper that keeps the part's state but
not a complete footprint of its other fields, so its routine lost track of an effect. 462 of 925 rules in Even More
and 402 of 764 in TIM 1 write a field whose value is still unknown. No walk and no recording comparison changes.

### Found lists and parts reached through ropes

A search or a rope, belt or pulley helper writes parts that only the running game picks: the parts a search finds,
the parts at the other end of a rope. Those writes used to be anonymous unknowns ("A selected related object may
change this field", "Conditional overlap-list effect on field 0x78"). Each value is now named after the call that
gives it, with the existing expression form of a field marked `unresolved`, so every traversal reads it as before
and a walk still forgets it. Within one run a name is one value: no path passes the same call twice.

- **The found list.** An overlap query clears the asking part's head at `0x78` and puts each part it finds at the
  front (`linkedInsertion`, or the outline search's checked graph). After the query the head is `found list after
the query at` the call's address: the part found last, or 0 when none. The outline search may list the asking part
  itself, but it stores the link before the head, so the head still ends as the head.
- **The found parts.** A found part's link at `0x78` gets the head it pushed down, `next in the found list of the
query at` the call: the next part in the list, or 0 for the part found first. The query at `0x417e` (Even More,
  English floppy) also fills in `0x7a` and `0x7c`, the shorter of the two edge distances between the boxes across and
  down; that value is named `value the query at` the call `writes to a found part`, without claiming the formula.
- **The relay's byte.** The relay gives the owner its byte first unless the owner's type (field `0x04`) is 49, the
  number its pattern matches, and every other store to `0x14` copies the same byte; no callee writes `0x14` of a part.
  So the summary now has an exact owner write (`exact`, chosen with `choose` against the old value) and
  `connected.values` gives a reached part's `0x14` as the byte. A part's own rules run on a part of its type, so
  `withOwnType` puts the type in and the test folds: the owner's `0x14` is the byte, 2 in every caller of both measured
  builds. Even if a rope led back to the owner, the reached store writes the same byte, or nothing when it only fills a
  zero.
- **Other fields of reached or selected parts.** The rope links `0x5a` to `0x60`, `0x6a`, `0x6c` and the rope ends
  `0x96`, `0x9c` of a reached part, and the fields a gear graph or contact response changes on its selected part, are
  `value the call at` the address `writes to a selected part`.
- **The owner after such a call.** A reached or selected part may be the owner itself (the code doesn't rule out a
  rope back to the same part), so the owner's field is `part after field effect at` the call: unchanged unless the call
  reached the owner. An uncached read after the call already gave that name.
- **After a list scan.** Another part's field a complete list scan may change is `value after the list scan at` the
  scan `in` that part, like the owner's `part after list scan at`.

`transitionCounts` now counts two groups apart. Rules with unknown writes write at least one value nobody named: an
unknown, or a field read again after an unknown write. Rules with named run values write only known values and values
named after the run time thing that gives them (the names in `RUN_VALUE`: a query's answer, a part a loop found, what
a list scan leaves behind, a found list, what a call writes to the parts it selects, the owner after such a call), and
at least one of those. The extraction notes and the comparison table show both.

Measured by the new rule, rules with unknown writes go from 242 to 33 of 925 in Even More, English floppy, and from
218 to 28 of 764 in TIM 1, French; rules with named run values go from 5 to 214 and from 5 to 195. The relay's owner
byte is now known in 37 rules of Even More and 33 of TIM 1. Every walk still ends and the recordings stay at 596 complete, 52 prefix
and 0 different (Even More) and 504, 48, 0 (TIM 1). What is left unknown is a helper's conditional effect without an
exact condition (the contact speed limit, owner field relations), the order a created object takes in a sorted list,
and a few values the symbolic budget gives up on.

### The owner's rope fields after the relay

After the relay, the owner's rope links (`0x5a` to `0x60`, `0x6a`, `0x6c`) and rope ends (`0x96`, `0x9c`) stay
"part after field effect". Whether a rope or belt can lead from a part back to itself doesn't decide them (it never
can, by the user's answer, and no shipped level has one). What the code shows (Even More, English floppy; the same
structure in all eleven builds):

- **Rope records.** A rope record's slot 0 is the part that holds it, slots 2 and 4 are the two tied parts (the far end
  helper `0x7b11` picks between them). Only four places store slot 0, each with the part the record is made for: the
  level loader (`0x1386b`), the rope's and the pulley's constructors (`0x160e7` and `0x1604b`, type 10 and 7) and the
  part copy (`0x6783`, only for types 10 and 7). The loader makes a record for any part whose rope data in the file is
  set, whatever its type; in every shipped level of the eleven builds only ropes and pulleys have it.
- **Rope ends.** The relay gives its byte to slot 0 of the owner's rope records, and the rope geometry update writes
  `0x96` and `0x9c` only there, and not at all while `[0x4a6d]` is `0x2000`. So the owner's ends change only when the
  owner holds its own rope record: a rope piece or a pulley, or a part a level file gave rope data. The relay's owners
  are 27 part types, none a rope or a pulley.
- **Rope links.** These come only from the belt end check (`0x582a`), which runs while `[0x4a6d]` is `0x1000` and the
  owner's belt has a loose end. It looks for the part under a point held in `0x539b` and `0x539d` and may turn round a
  rope tied to it (`0x4e50`, `0x4d3e`). That part can be the owner whatever the ropes look like.
- **When the relay runs.** Every call of the relay comes from a flip callback (`+0x2e`), which the editor calls
  (`0x5314`, and the flip buttons on the selected part at `0x11660` and `0x11692`). What mode `0x1000` means isn't
  proved: it is set at seven places, three of them only around a call of the rope routine `0x6c3d` (`0x8156`,
  `0x821c`, `0x1cb2c`) and one inside the scissors' cut until `0x1cdee` puts the old mode back (`0x1cd47`).

So the analysis keeps both groups named after the call. Knowing them would take a decision: that only ropes and
pulleys hold a rope record (the loader trusts the file), and that a flip never meets a belt with a loose end.

### The magnifying glass's last call

At the end of its run, the magnifying glass (Even More English floppy: run at `0x1c0ac`, call at `0x1c21c`) passes
itself to the routine at `0x793f`. That routine writes no memory itself. It calls three helpers with the same part and
the byte 1: `0x65c1` copies the byte to field `0x14` of the part and of the parts at the other end of its belt and
ropes, updating the belt and rope geometry on the way; `0x6b30` and `0x70fb` write only globals (the screen rectangle
queue).
The wrapper was proved before the connection summaries existed, so it kept only the part's frame, and the caller
forgot every other field of every part after the call. That made the run's routine lose track of an effect, and its
two rules stayed unresolved.

The wrappers are now proved again after the connection summaries. When every helper a wrapper calls has a complete
footprint for its part, the wrapper's footprint is their union: the same part fields, the fields named on parts and
records reached through ropes, belts and pulleys, and the globals. Only where a helper writes carries over, never
its values or conditions, since those come from the helper's own arguments. A helper that writes through another
argument, through a selected object, or that carries anything a caller reads specially, keeps the old state only
contract. After the call the magnifying glass forgets field `0x14` and the fields a rope, belt or pulley update may
change, on itself and on any part such a link reaches, and keeps the rest.

Its two run rules are now conditional on the part its list scan finds, in all eleven builds. Unresolved transitions
go from 2 to 0 in each build (the Even More English CD goes from 5 to 3: the cannon's 2 and the gun's 1 remain), and
conditional ones from 126 to 128 in Even More and from 120 to 122 in TIM 1. One more wrapper per build composes the
same way (`0x8744` in the Even More English floppy). No walk changes, and no routine keeps the forgotten footprint any
more.

### The control value's known numbers

Many parts move their frame by a control value, as in "frame + control value", that other parts and their own
routines set. When a walk reaches such a step without knowing the value, it lists the writes it found. Proving those
are all the writers isn't possible yet: hundreds of routines still have unfinished effects, and any of them could
write the field. So the walk branches on what it does know: when the unknown is one field of the part and the writers
found give between one and six plain numbers, each number is followed as its own conditional walk from that frame,
and a last branch for any other value keeps the stop. Nothing is claimed about which values occur.

For the teeter-totter the writers give 0 (its own run), 1 and -1 (its rope, a bounce, the windmill and the motors).
In each recorded build 27 walks that stopped now reach the end in some of their branches.

### Ways that lead to the same frame

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

### Walks that split at every step

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
decided assumption ([the monkey bike's starting frame](behaviour-assumptions.md#4-the-monkey-bikes-starting-frame)):
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

### Parts drawn by their own code

The conveyor belt and the gear have no list of frames in their type record: their own code draws them. So the walks
had no number of frames to start them on, and every walk that began from a level's saved frame stopped at once.

The code shows which frames they have. The belt's frame is a block of 7 frames per width: the editor keeps its width
between 32 and 96 in steps of 16, its resize sets the shown and the saved frame to the first frame of that width's
block, and its run only moves within the block. The gear's run adds its control value to its frame and wraps it within
0 to 3. Two decided assumptions now give these starting frames
([the conveyor belt's](behaviour-assumptions.md#5-the-conveyor-belts-starting-frame) and
[the gear's](behaviour-assumptions.md#6-the-gears-starting-frame)): the belt starts on frame 0, 7, 14, 21 or 28, the
gear on any of its four frames. Every shipped level of all eleven builds fits them.

The belt then stops when the part at the other end of its belt link is a gear whose train is blocked, and a gear stops
when its own train is blocked. Whether a train is blocked is the "gear connection conflict" the analysis already
works out from the connected gears (see [the full gear conflict relation](#the-full-gear-conflict-relation)). It is a
value of that run, like a query's answer, so walks may now branch on it.

All 73 walks of the belt and all walks of the gear now end in every branch they can follow, in both recorded builds.
The gear's walks that stay open are only the branches for a control value other than 0, 1 and -1, the numbers the
analysis found its writers set. Over all parts, walks that end in every branch went from 330 to 380 in Even More and from
283 to 333 in TIM 1, and walks that stop from 152 to 98 and from 135 to 81. No recorded animation changes.

The mouse motor and the electric motor are drawn by their own code as well. The mouse motor's run only flips between
frames 0 and 1, and the electric motor's counts down within 0 to 2. Two more decided assumptions start them there
([the mouse motor's](behaviour-assumptions.md#7-the-mouse-motors-starting-frame) and
[the electric motor's](behaviour-assumptions.md#8-the-electric-motors-starting-frame)). Together with the generator
change below, walks that end in every branch reach 409 in Even More and 362 in TIM 1, and walks that stop 69 and 52.

### Frames a partly known state allows

The generator shows its state as one of 16 frames. Its run turns the two low bits round, and its reset at `0x1aeb3`
(Even More, English floppy) keeps those two bits and sets bit 2 and bit 3 when the words at `0x62` and `0x64` are not
zero. Shipped levels save it on frame 0 or 4. Walks that knew only some of these bits, like the reset or a trigger
that kept the low bits, used to stop: more than three bits were unknown, and the frame bound only applied when no bit
was known.

A part with at most 32 frames can only be on one of them, so the walk now follows each frame whose number has the
known bits, the same way it does when no bit is known. A part drawn without frames still stops. All 45 walks of the
generator now end, in both recorded builds. After the belt and the gear, walks that end in every branch went from 380
to 395 in Even More and from 333 to 348 in TIM 1, and walks that stop from 98 to 83 and from 81 to 66.

### Unnamed values that keep the frame

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

### Rules that give the next frame from any frame

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

### Helpers that keep the state

Some helpers are proved to keep the part's state, but not which of its other fields they change. The magnifying glass
looks for a light source every run, and when it finds a part to heat it calls one (`0x793f`, Even More, English
floppy) that updates the drawing of the part it is given. Its run then never writes its state, but the path through
that helper has incomplete effects, so its walks stopped at once.

Such a path is now marked `keepsState` in the routine's outcomes. When it is the only reason a routine's effects are
incomplete (no other uncertainty, and every return path analysed), its rules still fix the state path: the destination
is exact, and the walk forgets every other field after that step, since any of them may have changed. A path with any
other gap still stops the walk. The magnifying glass's walks from its creation and from frame 0 now rest on frame 0.

### Holding a frame the walk doesn't know

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

### The teeter-totter's rope answer

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

### The teeter-totter's bounce and the bounce pool

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

### Starting frames a callback rules out

A callback's walk starts from the fields its outcome leaves. When those don't fix the frame, the walk follows each
frame the part has, but it used to forget the callback's own condition while doing so. The teeter-totter's bounce, for
example, only tips it to the left when it isn't already at frame 0, yet its walk also started from frame 0 and then
reached a frame -1 that doesn't exist. Now the tests a callback's or a related writer's condition makes on the part's
own fields hold when its walk starts, as far as its writes leave those fields alone, and a starting frame they rule out
isn't followed. When that leaves one frame, the walk follows it as the only way. In both recorded builds 20 more
teeter-totter walks end in every branch, among them all of its bounce walks. No other part changes its counts.

### Cases in the middle of a run

A walk now leaves out starting frames that its own condition rules out ([starting frames a callback rules out](#starting-frames-a-callback-rules-out)). That
showed two things. An input case describes the part in the middle of a run, where the belt can be on any of its 35
frames, not only on the first frame of a block that a level starts it on. Input cases therefore start on every frame
the part can show, and walks from a level's frame keep using the frames a level gives. And an input case that needs a
frame the part doesn't have, like a frame above the fish bowl's last one, describes nothing the game can be in, so it
is left out, like the cases a decided assumption rules out.

### Decided control values and ends

Two more decided assumptions close the last walks of the jack-in-the-box, the gear and the teeter-totter
([control values](behaviour-assumptions.md#9-control-values) and
[the teeter-totter's ends](behaviour-assumptions.md#10-the-teeter-totters-ends)). Where a walk needs one of their
control values, it now branches on -1, 0 and 1 and has no branch for any other number. A teeter-totter on frame 0 with
control value -1, or on frame 2 with 1, is ruled out wherever a walk would start, branch or begin an input case there;
the branches on known numbers check it too, and they also leave out a number the walk's own tests rule out.

Every walk of these three parts now ends in each of its branches, in both recorded builds. Over all parts, walks that
end in every branch went from 416 to 495 in Even More and from 347 to 426 in TIM 1. Walks that stay open went from 98
to 7 and from 99 to 8: all of them are walks from the explosion. The teeter-totter has 12 fewer walks in each build,
the input cases the second assumption leaves out. Since ropes may form a ring, the teeter-totter's control value
after it asks for real is one value of that run; the walk branches on it with the same numbers (see
[the rope connection query](#the-rope-connection-query)).

### Recordings that start on a branch

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

### Widening at the branch depth limit

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

### Recordings compared along a walk's branches

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

### Countdowns

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

### Values a list scan leaves behind

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

### The recorder's normal seed

The v25 recorder sets a part's normal seed on the part before each of its clips, and then the clip's own seed over it
(`clip` in `research/v24/verify_animations.py`). Its frames save the frame, control value, counter, heat and flags,
but not the speed. The comparison used to take a clip's starting fields from the clip's own seed and its first frame
only, so the speed of 0x3000 that the bullet's normal seed gives was lost. The bullet's run tests that speed on its
first run: at 0x3000 (or 0xd000) it stays on frame 0, at any other speed it shows its impact frames 1 and 2. Without the
speed the impact stayed a way the recording allowed, and the bullet's normal recordings were prefixes.

The comparison now takes the part's normal seed under the clip's seed and frames, as a starting field like the others
(only on the first run). Only the bullet's normal seed gives a field the frames don't save. Its four normal recordings
now match completely in both builds: complete matches went from 560 to 564 in Even More and from 472 to 476 in TIM 1.

The recorder also puts each part alone on an empty bench, touching nothing. Decided with the user, the comparison
takes the contact bits of the list flags at `0x06` as clear at the start of every recording: `0x0002` and `0x0004`,
which the contact dispatch tests before it calls a bounce callback (`0x1071`, `0x10b5`), and `0x0001`, which picks
its response (`0x1096`, Even More English floppy). The other list flags, like the moving list `0x1000`, stay unknown,
and so does the belt link at `0x54`, which the user chose to leave open. Like the other recorded fields this only rules
out ways at the start. The cat's flipped move recordings and the mouse's normal recordings test those bits on their first
run, so 4 more of each match completely per build: 564 to 572 in Even More and 476 to 484 in TIM 1, none different.

What stays a prefix, by cause (Even More 84, TIM 1 76):

- The recorder writes the control value again while it runs: the teeter-totter (4), the gear (8), the bellows (4) and
  the teapot (4). A single trigger can't describe that.
- Another part may start it: the mouse motor (8), whose run with the control value at 0 scans the parts lying on it
  (0x1bff5 in Even More, 0x1a70c in TIM 1), and Mel's house in Even More (4, the scan at 0x1e29b). In Even More the
  mouse motor's run recording is open one run after its countdown on a test of the control value, which the walk
  doesn't know there.
- Its search for another part: the cat (8), through the loop at 0x1a01a and the query at 0x19fd3 in Even More
  (0x186af and 0x18668 in TIM 1).
- A field the recording doesn't save: the mouse (8) starts again once its counter is 0 when bit 0 of the word at 0x06
  is set (and, in TIM 1, a value the scan at 0x1acf5 leaves is not 400). The monkey bike's recordings seeded on frames 5 to 12
  (32) are compared with its hit, which sets the counter, so the recorded counter of 0 doesn't apply; its rules there
  also test the word at 0x54, which the recording doesn't save.
- A field the recording gives only at the start: the monkey bike's reaction (4) ends on frame 0 with its counter at
  0, where the run pedals again when the control value is not 0. No rule on that way writes a known control value, and
  the recording gives it only at the start, so the walk can't tell it is still 0.

### Recordings whose recorder writes again

Some v25 clips write an input again while they run (`clip` in `research/v24/verify_animations.py`). Before each run the
recorder writes its hold values, on every run when the clip names no `holdTicks`, or else before run `holdTicks`, and
at run `holdTicks` it writes its release values (the control value 0 when it names none). The write at run 0 is part of
the clip's starting fields. A frame the recorder saves is taken after a run and before the next write. The teeter-totter
holds its control value at 1 and writes -1 at run 1, the bellows writes 1 twice and -1 at run 2, the teapot writes 1
for 60 runs and 0 at run 60, and the gear writes 1 (or -1) before every run. A walk follows one trigger, so these
recordings used to stay prefixes after their first write.

The comparison now restarts at each write that changes the part:

- A write of the value the saved frame already shows changes nothing, so the walk goes on through it. That holds only
  for the fields the recorder saves in full: the frame, the control value, the counter and the heat. The bellows'
  second write and the teapot's release are such writes.
- At any other write the comparison starts a new walk from the fields the recording gives there: the saved frame's
  fields with the written values over them, everything else unknown. It is a walk of the run rules from those fields,
  like an input case in the middle of a run. The part's normal seed and the clear contact bits are not used there:
  they only hold at the start of the recording.
- Each part of the recording up to the next write only needs to agree with the walk up to there, by the same rules as
  a whole recording (some way the recording allows matches, and no allowed way stops before then). The last part needs
  a proved ending, like a whole recording.
- A recorder that writes on every run must have recorded a cycle. Its cycle was found on the fields after the write, so
  from the end of the recording on, each run restarts from the fields of the run the cycle repeats. The comparison
  checks one more round of the cycle that way; after that every part is one it already checked. A recorder that
  writes on every run and records no cycle stays a prefix.

The start of a recording is still compared with every described start as before; the parts after a write are the same
for all of them. A restart only forgets fields, so it never proves more than the recording gives.

All 20 such recordings in Even More and 16 in TIM 1 now match completely: complete matches went from 576 to 596 in Even
More and from 488 to 504 in TIM 1, none is different, and the walks themselves don't change. The teeter-totter's walk
from its frame after the write asks along its ropes, which the recording can't rule out, so its ending is proved over
the ways the rope answers allow, like any other branch.

### Recordings that wait for a search

Twenty recordings in Even More and sixteen in TIM 1 agree with the walks frame for frame but stay prefixes, because
the part next waits for a search to find another part: the mouse motor's restart (8 per build), the cat looking for a
mouse (4), the mouse starting again (4) and Mel's house in Even More (4). Decided with the user, such a recording may
only close when the part stays alone for the whole recording: no part in it makes another part, and the recording
shows nothing else on the bench.

The second check can't be made from the recordings. Each v25 clip in `animations.json` holds the recorded part's own
saved fields per frame (the frame, control value, counter, heat, the masked drawing flags and whether it is hidden),
the input it got, the callback it ran, how the clip ended, a source note `isolated-original-callback` and a count of
the engine calls it skipped (`skippedEngineServices`). It lists no other part and no position, not even the recorded
part's own. What else lay on the bench is not in the data, so none of these recordings closes, and nothing is assumed
in its place.

The data does show something else: the searches these parts wait for are among the calls the recorder skipped. In
Even More the cat's move clips skip the overlap search at `0x417e` four times, the mouse motor's clips skip it once,
and Mel's house skips the overlap search at `0x42da` on every run (in TIM 1 the cat and the mouse motor skip the
overlap search at `0x3597`). So the recorder did not run the search over an empty bench, it left the search out, and
what the part got in place of its answer comes from the recorder, not from the game. Taking it as "found nothing"
would be a new assumption. The mouse's clips skip no search: what its run tests there, bit 0 of the list flags at
`0x06`, is a field the clips don't save.

### What the recorder gives for a skipped search

Decided with the user: a clip that lists a search as skipped may be compared with the walk's "found nothing" way,
since that is what the recorder gave the part. This is a fact about the recorder, not about the game.

The recorder (`research/v24/verify_animations.py`) runs only the part's run routine. Its hook catches the first
instruction of any routine outside the part types' code segment, pops the far return address, sets AX and DX to 0 and
writes no memory, and counts the call in `skippedEngineServices`. Before each clip it loads the program again and
clears the part's 0x300 bytes, then sets the type, the flags, the frame, the fields `0x1e` to `0x28` (the position) at
100, the size, the outline and drawing pointers at `0x80` to `0x84` and the clip's seed (the control value, counter,
heat, speed). Between runs it only writes the previous frames at `0x0e` and `0x10`, the position fields at 100 again
and its hold values.

An overlap search like `0x417e` first clears the found list at `0x78` of the part and then links each part it finds.
Skipped, it writes nothing, so the field keeps the 0 the recorder cleared it to, as long as nothing else writes it. The
comparison checks that on the run routine: no instruction outside the loops over the list writes `0x78` through any
pointer, and every call outside those loops leaves the part's code segment (so the recorder skips it too). Then every
loop over that list finds it empty:

- a loop that stops at the first part it acts on, like the cat's at `0x1a01a`, finds no part: its member link is 0;
- after a loop over every part, like the mouse motor's at `0x1bff5` and Mel's house's at `0x1e29b`, the part's fields
  hold what they held before the loop. That is the value at the run's start when nothing on the way from the start to
  the loop writes the field and the only call is the search.

The comparison rewrites the walk's branch conditions with those values, and a condition that then tests a field for one
number and for another (like "the control value is 0 and the control value after the scan isn't 0") is ruled out. A
search's answer in AX is 0 too, but none of these runs uses it. Only clips that list the search get this, and only when
the walks as they are don't already match. Such a match has its own basis, `recorder-skipped-search`, and is counted
apart: it shows the walk agrees with the recorder, not that the game finds nothing.

Complete matches went from 596 to 606 in Even More (10 through a skipped search) and from 504 to 512 in TIM 1 (8), and
prefixes from 52 to 42 and from 48 to 40. None is different. In Even More Mel's house's four still recordings close,
and so do the mouse motor's four still recordings and the cat's two move recordings that look in the found list. In
TIM 1 all eight mouse motor recordings close. What stays open, and why:

- the mouse motor's four run recordings in Even More: at the end of the countdown some joined branches no longer know
  the control value is 0, so they may still flip the frame. That is the countdown, not the search;
- the cat's four still recordings in both builds: the cat first compares two of its position fields, `0x20` and `0x28`
  (when they differ by more than 1 it counts up and then shows frame 1), and after the first run the walk no longer knows its counter, its flags
  or whether it touches something. The recorder sets both position fields to 100 before every run, but that is another
  fact about the recorder, not a skipped search;
- the cat's two move recordings in TIM 1: the analysis doesn't sum up the cat's loop over the found list at `0x186af`
  as a loop over that list (it does in Even More), so the comparison can't tie the loop to the skipped search;
- the mouse in both builds (4 each): it skips no search. It only searches when bit 0 of its list flags at `0x06` is
  set; the recorder clears those flags and the run never sets them, but the comparison only takes them as clear on the
  first run.

### The monkey bike's control value after its reaction

The monkey bike's reaction recordings start on frame 5 with the counter at `0x96` at 20 and the control value at
`0x12` at 0. After 20 runs the bike is on frame 0 with the counter at 0, and there its run (`0x1be5a` in Even More,
`0x1a567` in TIM 1) pedals again unless the control value is 0. Those recordings stayed prefixes in both builds.

Nothing lost the value on the way: the reset walk never knew it. The reset puts back the control value a level saves,
which the walk doesn't know, and the run doesn't write it during the reaction, so the walk carried "unknown" to frame 0. The join into the walk that starts on frame 0 didn't lose anything either, since that walk didn't know it. The
comparison takes a recording's starting fields as the part's fields only on the first run, and on later runs only as
starting values of fields the walk follows from its start (the countdowns). So at run 21 the test of the control value
stayed open.

A decided assumption ([the monkey bike's reaction](behaviour-assumptions.md#16-the-monkey-bikes-reaction)) settles
it: while the bike plays its reaction, nothing pulls its rope or bounces it, so its control value keeps the value it
had when the reaction started. A walk that starts in the reaction (a first walk, or a starting frame a level saves, on
frames 5 to 12) now keeps the control value as its starting value, like a countdown that never moves. It keeps it
through every run that begins on frames 5 to 12 and through the run right after them, which reads it; then the field
goes back to plain tests of itself. A run that writes it ends this, as for a countdown. A walk started by the bike's own
bounce or rope callback doesn't keep it, since those write the control value; the reset, the flip and the input cases
can. Every finding that keeps the value past a run states the assumption.

The four reaction recordings now match completely in both builds: complete matches went from 564 to 568 in Even More
and from 476 to 480 in TIM 1, and prefixes from 84 to 80 and from 76 to 72. None is different. Walk endings don't
change (Even More 521 end through branches and 577 end directly, TIM 1 450 and 476), and the monkey bike's 65 walks
all still end. What stays a prefix for the bike are its recordings seeded on frames 5 to 12, as before.

### Outlines

Many parts build their own outline in their reset: the shape other parts bounce off. The part's outline pointer at
`0x82` (the layout's `outlinePoints`) leads to a list of four-byte records, an X byte, a Y byte and an edge word the
shared geometry helper works out from the corners. The descriptions used to read writes through that pointer as fields
of another part, so the balls' reset showed "Selects state 31 on another part" where it really writes corner 4's Y.

Writes through the outline pointer now become one line per routine path, "Sets its outline to 8 corners: (8, 0),
(23, 0), ..." when a path writes every corner from the first, and "Moves its outline corner 2 x to ..." when it writes
only some. A size field in a corner reads as that size, and adding 255 to it in a byte reads as the size minus 1. In
Even More:

- the bowling ball, basketball and gear: an octagon from (8, 0) to (0, 8) in a 32 by 32 box;
- the cannonball, super ball and pool ball: an octagon in a 23 by 23 box; the baseball and tennis ball: in a 15 by 15 box;
- the walls and the grass floor: a rectangle from (0, 0) to their frame width and height minus 1, which their resize
  moves when the size changes;
- the conveyor belt and mouse motor: a rectangle as large as their frame;
- the birdcage (12 corners), the bucket (6), the fish bowl (3), the generator and the jack-in-the-box (4).

Writes through another part's outline pointer read the same way, for "another part's" outline. The jack-in-the-box
does that to a part it reaches (`0x1b888` in Even More): it sets that part's outline to the 3 corners (8, 47),
(24, 44) and (39, 47), the same 3 corners the fish bowl's bounce gives its own outline.

The curved pipe wall and the electric switch copy their corners from tables in the data segment, chosen by their
frame, in a loop through a copy of the outline pointer kept on the stack (`behaviour-outline-tables.ts`). The reader
recognises that loop in both compiler forms (TIM 1 reloads `bx` before the second byte), follows every path from the
entry to it to find which frame tests pick which table, and reads the tables' bytes. It gives up when a path does
anything else, or when any instruction it read writes into a table by its address; the tables are then assumed to keep
the bytes the program ships with. In Even More (`0x1c83e` and `0x1a64a`) and TIM 1 the curved pipe wall gets one
8-corner outline for each of frames 0, 1 and 2 and one for any other frame (its four turns), and the switch a thin
4-corner lever, at (8, 8) to (15, 9) on a frame below 4 and at (8, 23) to (15, 24) from frame 4 on.

### Writes on parts reached through ropes and belts

A callback that calls a rope, belt or pulley helper with a summary (see "The byte relay" above) forgets the fields
the summary names on every part, since the part reached can be the owner. Those writes used to show as "Updates
another part's part-specific field". They now say what the summary proves the helper may change: field `0x14` (the
value the relay passes along), the rope links `0x5a` to `0x60`, `0x6a` and `0x6c` (turning a rope round) and the rope
end words `0x96` and `0x9c`, each on "a part its ropes, belt or pulleys reach (this part too)". The flips of the eye
hook, the wood incline and the curved pipe wall, among others, show these three lines.

Two more kinds of writes got plain lines. A write through a part's belt link `0x54` or rope links `0x66` and `0x68`
goes to a belt or rope record, not a part: the birdcage's, bucket's and heart's rope callbacks "Add 1 to field 0x0e
of the record of its rope at 0x66" when asked with mode 1. A bounce callback's writes to its argument go to the part
that touched its owner (see [walks from parts that touch](#walks-from-parts-that-touch)): "Selects state 9 on the
touching part" instead of "on another part". And an overlap query's writes to the parts it finds say "Links a part its
search finds into its found list (field 0x78)" and "May change field 0x7a of a part its search finds". Writes to an
object the routine allocates itself said "Sets field 0x1e of the object it creates at 0x19ba8", without claiming the
object is a part; see [parts a part makes](#parts-a-part-makes) for what they say now.

A flip that turns a drawing flag round with an exclusive or (`xor word [si+0x08], 0x0010`) now says so: "Turns the
part's horizontal reflection round", or the vertical one for `0x20`, as the eye hook's flip does. It used to say the
complete visual change wasn't established, since the new flags depend on the old ones. In the same way an `or` with a
number sets those bits and an `and` with a mask clears the others, whatever they were, so such a write now names the
bits: "Sets flag 0x40 of the part's drawing flags", which the runs of the teeter-totter, balloon, gear, bellows, switch
and solar panel do. What `0x40`, `0x200`, `0x400` and `0x2000` mean isn't proved yet, so they stay numbers (the
searches pass over a part with `0x2000`).

A helper that only updates its part's fields used to be described as "Updates object fields whose meaning is not
established" as soon as one field had no checked name. It now names the fields it can and gives the others by offset,
like the eye hook's helper at `0x1aaaa`: "Updates fields 0x6a, 0x6b while preserving the state".

A routine that does the same thing on many paths, like the teeter-totter's run moving the parts lying on it, used to
give one effect line per path: 1,424 lines for the teeter-totter in Even More. The same effect of one routine is now
one line, which keeps every path's condition in `conditions` when they differ; the teeter-totter has 122.

### Parts whose run keeps everything

Most simple parts share one empty run routine (`0x29f` in Even More: it only sets up and restores `bp`), and the same
for their bounce, flip, resize and rope callbacks. Its only rule keeps the frame and writes nothing, so the description
lists each of the part's frames (up to 32) as a resting frame: a walk from any of them rests at once. Nothing is
assumed about which frame a level saves. A run that keeps the frame only under a test, or writes other fields, still
gets its resting frames from its rules as before.

In Even More this gives frame 0 as the resting frame of 16 parts with one frame: the bowling ball, basketball, rope,
birdcage, bucket, eye hook, baseball, jack-o-lantern, heart, Christmas tree, cannonball, tennis ball, cheese, thumb tack,
pool ball and shamrock (11 of them in TIM 1). Their reset keeps the frame the level saved, and with
[the decided assumption on parts with one frame](behaviour-assumptions.md#13-parts-with-one-frame) that is frame 0, so
their reset is now known too. The walls, floors, pulley, belt, rope end, super ball and curved pipe wall
share the empty run too, but the program draws them its own way, so they have no frame list to count and stay without
one.

### Resets that set the frame from the sockets

The resets of the electric switch, the generator and the solar panel set the frame from the link slots at `0x62` and
`0x64`, where the editor plugs plugs in. They used to be described only as "the frame depends on fields the reset
doesn't fix". Addresses below are from Even More, English floppy.

- The switch's reset (`0x1a64a`) keeps bit 2 of its frame (the lever) and sets bit 0 when the word at `0x62` isn't 0
  and bit 1 when the word at `0x64` isn't 0. It also picks the lever's outline by whether the frame is at least 4.
- The generator's reset (`0x1aeb3`) keeps bits 0 and 1 (the phase its run turns round) and sets bit 2 and bit 3 the
  same way.
- The solar panel's reset (`0x1ce45`) keeps nothing: its frame is 0, plus 1 for `0x62` and 2 for `0x64`.

The level reset (`0x892b`) copies the saved state `0x90` into the frame (`0x89c6`), calls the part's reset
(`0x8a93`) and saves the frame it leaves back into `0x90` (`0x8a9c`). It doesn't touch `0x62` or `0x64`. The level
loader reads the saved state into `0x90` (`0x136af`) and, from file version 0x101 on, the two plugged parts into
`0x62` and `0x64` (`0x13941`). In the editor, plugging a plug in (`0x5d14`) takes `0x62` when it is free and `0x64`
otherwise, calls the reset of the part it leaves and of the part it joins, and saves their frames into `0x90`
(`0x5de4`, `0x5e25`). The switch's flip (`0x1a6ed`) sets the frame to 4 below frame 4 and to 0 otherwise, saves that
into `0x90` (`0x1a709`) and only then calls the reset, so a level saved after a flip keeps 0 or 4 even when a plug is
in. The generator and the solar panel have the shared empty flip.

When every path of a reset writes the frame as some bits of the frame it starts from with other bits set, and every
frame such a path can give is one the part has, the description now says which bits are kept, which test sets each
other bit, and the frames it can leave (`rest.frames`). For these three parts that is every frame they have: 0 to 7,
0 to 15 and 0 to 3. Which one depends on the saved frame and on the plugs, which TIM.EXE alone doesn't give. The
starting fields of the walks don't change, and every walk of these parts still ends. A write of the saved state is
now described as the state the next level reset starts from, so the switch's flip says it saves 0 or 4.

Shipped levels show that the starting frame isn't always the saved one. In Even More, a switch saved on frame 0 with a
plug in `0x62` starts on frame 1, one saved on 4 with a plug starts on 5, and a generator saved on 0 with a plug
starts on 4.

### Starting frames from decided assumptions

Three decided assumptions give more parts their starting frames
([13](behaviour-assumptions.md#13-parts-with-one-frame), [14](behaviour-assumptions.md#14-parts-the-game-draws-itself)
and [15](behaviour-assumptions.md#15-the-generators-starting-frame)). When the reset keeps the frame the level saved,
the reset now lists the frames it can start on (`rest.frames`): the part's own frames, or the ones the assumption gives
a part the game draws itself (the pulley and the curved pipe wall on 0 to 3). When that is one frame, the reset is
known: the one-frame parts, the walls, the grass floor and the super ball start on frame 0, and a part whose run keeps
everything rests there. The generator's reset keeps bits 0 and 1 of the saved frame, which are 0, so it leaves frame 0,
4, 8 or 12, and its walks start on those. The table of these frames is `LEVEL_FRAMES` in
`behaviour-saved-frames.ts`; an entry with `framed` narrows a part that has a frame list.

### Resets the level gives

A reset whose paths are all read and keep the frame the level saved used to count as unresolved. That is what the
game does: the level gives the frame. The reset now has status `saved` in that case, with the frames it can be
(`rest.frames`) when they are known: the part's own frames up to 32, or the ones in `LEVEL_FRAMES`. A part without a
frame list and without a decided assumption (the wood incline, the belt, the rope end and the pinball bumper) keeps
the status with no frames listed, and its uncertainty says why.

A reset that sets bits of the frame by whether its words at `0x62` and `0x64` are 0, as the electric switch, the
generator and the solar panel do, has status `sockets`. Those two words are where the part's plugs are (see the
section above): the level loader fills them and the editor's plug code takes `0x62` first. The description now says
"when a plug is in its first socket (+0x62)" instead of naming the word. Only a reset whose varying bits are all
decided by those two words gets this status; any other field keeps it unresolved.

So `unresolved` only remains where a reset path can't be read, or where its frame depends on another field. The
comparison counts only those as unresolved resets and counts the other two as resets the level gives. In Even More
that is 0 unresolved and 41 given by the level (38 saved, 3 from sockets); in TIM 1, 0 and 36. The lab doesn't show
the reset's status, so it needed no change.

### Resting frames from the walks

A part's resting frames used to come only from its run outcomes: a rule whose next frame is known and whose walk rests
after one more run. Many parts never get one that way, because the frame they stay on is reached over several runs.
The walks prove more: a walk rests when one more run leaves its frame and every field it knows as they were, under the
tests on its way. A walk that holds a frame it doesn't know proves the same for each frame its rules keep.
`stableStates` now also lists each frame a walk rests on that the run outcomes don't give, once per frame, with the
fields every walk resting there agrees on, the number of resting walk branches (`walks`) and the conditions on the way
of the first eight. No walk starts from these frames: the walks already reach them.

In Even More, 28 of the 33 parts without a resting frame now have one (24 of 28 in TIM 1). The rest have none for a
reason: the wood incline and the belt (and in TIM 1 the rope) rest on any frame they are on, but they have no frame
list to name it from; the mouse motor, Mel's house and the alligator never rest in any walk, their walks only loop or
join another branch.

### Walk notes that name the frame and the test

Two notes were left vague. "The seed does not establish the state. No state zero is assumed." (34 parts in Even More)
comes from a walk whose starting frame isn't known, mostly because the reset keeps the frame the level saved. Every
one of these walks goes on from each frame the part can be on, so the note now says which: "The frame it starts on
isn't known, so the walk follows each frame it can be: frames 0 to 18." When only some bits are known it names those
bits, and when the walk can't follow the frames it says why (no frame list, more than 32 frames, no branch depth left,
or tests that leave no frame).

"The unknown condition selects different next fields, so no branch is chosen." (15 parts) comes from a step where the
rules that apply set different fields and a test the walk doesn't know decides between them. The walk does follow
each way. The note now names the tests, with a test and its opposite said once: for example "At frame 9, the rules
that apply set different fields, and which one does depends on whether the counter at +0x9c is 0, which the walk
doesn't know, so each way is followed." Fields go by their plain or layout name, or their offset, and other objects
by how the part reaches them (the part linked at `+0x54`, the part a search found, its fields when the walk started).
At most four tests are named. Neither old wording is left.

### All input cases

The description used to keep at most 64 conditional input cases per part, and the jack-in-the-box and the monkey bike
went past that. The rest weren't repeats: without the bound the jack-in-the-box has 156 cases with 89 different walks
(39 before) and the monkey bike 154 with 60 (30 before), in Even More and in TIM 1 alike. The list is finite on its
own: the cases come from the run's tests and from the plain numbers the writers found, and each input is expanded at
most 64 times. So every case is now kept, with a safety bound of 1024 that no part reaches; a part past it would still
keep the note that more cases remain. The descriptions grow by about a tenth and take about a tenth longer, and the
recordings compare the same.

### The gear's frame -1

One gear note read "At frame 65535, the next state depends on...". A gear never reaches that frame. Its run adds the
control value at `0x12` to its frame and wraps -1 to 3 and 4 to 0, and the advancement of connected gears does the
same (see [connected gear traversals](#connected-gear-traversals)); the reset keeps the saved frame, which a level
gives as 0 to 3 ([the decided assumption](behaviour-assumptions.md#6-the-gears-starting-frame)), and creation sets 0. So a run always starts on 0 to 3. The run's rules still test for -1 and 4, because the code tests the frame after
it adds the control value. The input cases turned the test "the frame is -1" into a case that starts on frame -1,
and that case gave the note.

The rules were read right; the case was not one the game can be in. An input case now has to allow a frame the part
can be on in the middle of a run: one of its own frames, or for a part the program draws itself, the frames its decided
assumption gives (as the walks already use). The gear loses its cases on frames -1 and 4, and no walk stands on frame
65535 any more. The cases that test the frame after adding the control value against 65535 stay: that test is real.
The recordings compare the same.

### Where a part is drawn and how large its frame is

After a routine changes a part's frame, it calls two shared helpers (`0x68aa` and `0x6940` in Even More, English
floppy, `0x5c15` and `0x5ca8` in TIM 1, French). The first sets `drawX` and `drawY` (`0x2a`, `0x2c`) and calls the
second, which sets `frameWidth` and `frameHeight` (`0x44`, `0x46`). Most run and callback rules end with them, and
their writes used to be unknown. The code shows what they compute:

- The belt and the rope (types 8 and 10) get a size of 0 by 0.
- A part with `0x40` set in its flags at `0x06` gets the size it keeps itself, `baseWidth` and `baseHeight` (`0x50`,
  `0x52`).
- Otherwise the word at `+0x1a` of the type record, when it is not 0, points to a list of sizes, four bytes for each
  frame. When it is 0, the word at `+0x14` points to a list with a pointer for each frame, to a record with the width at
  `+6` and the height at `+8`. When that is 0 too, the size is 0 by 0.
- `drawX` starts at `positionX` (`0x1e`). When the word at `+0x18` of the type record is not 0, it points to two signed
  bytes for each frame, the frame's offset. A mirrored part (`0x10` in the drawing flags at `0x08`) is drawn at
  `positionX` plus `horizontalExtent` (`0x40`) less the offset and less the frame's width, any other part at
  `positionX` plus the offset. `drawY` is the same with `positionY`, `verticalExtent`, the flag `0x20` and the height.

The analysis reads each helper the way it reads a callback, with a far pointer kept on the stack and a word read from a
table both read as table reads, like the code does. Every return path must be plain: its tests are equalities of the
part's fields and table words, and its writes are values of those. A field's value is then the sum over the paths of
the path's value times the 0 or 1 of its tests, with a test that every path makes taken out in front. Exactly one
path's tests hold, so the value is exact, and a caller gets it in place of an unknown write. When two paths of a rule
differ only in one test and give a drawing field different values, the rule keeps both values the same way instead of
an unknown one, like any other field (see [Values two paths set differently](#values-two-paths-set-differently)).

A part's own rules run on a part of its type, so for each part the type field becomes its type and the words at
`+0x18` and `+0x1a` of its type record become the words in the program, under the type table assumption of
[effects of other parts](#effects-of-other-parts). The word at `+0x14` is not taken from the program, since the program
sets it while a level runs: it stores it when it loads a sheet (`0x107dc` in Even More, English floppy) and clears it
again (`0x1084c`). The cat has no size list, so its frame's size stays a read of that list at run time.

Both helpers are proved in all eleven builds, in every compiler form they have: TIM 1 reads the type table in the data
segment, Even More through a far pointer, and the Even More CD loads that pointer again instead of sharing the ends of
paths. Transitions with unknown writes went from 462 to 365 in Even More, English floppy, and from 402 to 324 in TIM 1,
French. Transitions with an unknown drawing write went from 313 to 70 and from 272 to 12; the rest come from other
values on the same path, like the cat's position after its search loop. Every walk ends the same way and no recorded
animation changes; the monkey bike's walk from its creation rests after one run instead of two, since its drawing
position now stays known. A periodic walk leaves out the drawing fields no rule reads, since their values depend on
the frame.

### Parts a part makes

The balloon, cannon, gun and dynamite plunger make a part with the part factory (`0x15d9b` in Even More, English
floppy; `0x145d7` in TIM 1, French). The factory takes the type as its one argument, stores it as the new part's type
word (`mov [si+0x04], di`) and calls that type's constructor. Each of the four pushes a number right before its call,
so the type is that number:

| Part             | Call (Even More) | Pushes | Makes      |
| ---------------- | ---------------- | -----: | ---------- |
| balloon          | `0x192d3`        | `0x31` | rope end   |
| cannon           | `0x19ba8`        | `0x2b` | cannonball |
| gun              | `0x1b3a1`        | `0x14` | bullet     |
| dynamite plunger | `0x1c3c1`        | `0x29` | explosion  |

Part 43 keeps its id `pinball`, since ids never change once published, but in TIM 1 and Even More it is the cannonball
the cannon fires, so the descriptions call it that.

Helpers make parts the same way: an explosion at `0x1a432`, and in the other builds the scissors' rope cut makes two rope ends and a rope (types `0x31` and `0x0a`). The reader takes the type only from `mov` of a number into a
register and `push` of that register, or a `push` of a number, right before the far call, with nothing jumping to the
push or the call, and only for a factory whose own store of its argument as the type word it has proved
(`createdParts` in the report). The other factory calls in both builds pass a type they read, and get no type.

The effect lines used to give one line per field ("Sets field 0x1e of the object it creates at 0x1b3a1"). Now each
way through the routine that leaves fields on the new part gives one line, with the fields that way leaves on it, the
frame the type's constructor starts it on when the creation defaults know it, and the other fields it sets by name.
The gun, when not flipped: "Creates a bullet (type 20) at positionX = its positionX + 36 and positionY = its positionY

- 3, moving at velocityX = 12288 and the bullet's starting velocityY (each kept within the bullet's speed limit). It
  also sets previousX to its positionX + 12, previousY to its positionY + 3, ...". Flipped, the bullet starts at
  positionX - 32 and moves at -12288. The cannon's cannonball starts at positionX + 97 (flipped - 48) and positionY - 7,
  moving at 12288 (or -12288) and -4096. The plunger's explosion starts at its positionX - 16 (flipped + 80) and its
  positionY. The balloon's rope end starts at the end point its rope record keeps for the balloon's end of the rope, and
  takes over the balloon's rope links at `0x5a` and `0x66`.

The speeds go through the speed limit at `0x37bc`, which keeps each speed within the limit in the new part's type
record (see [The speed limit](#the-speed-limit)); the line gives the speed the routine stored before that limit. The
list insertion at `0x629d` links the new part between neighbours it picks while the game runs ("links it into a list
of parts")); the rules name those neighbours (see [Parts linked into an ordered list](#parts-linked-into-an-ordered-list)).

### The type record words the game writes

Lines about other parts read words of a type record from TIM.EXE, like the mass at `+0x02` that picks the explosion's
speed class, under the assumption that a type record keeps its words while a level runs. Three words don't, so they
are never read from the program, and the assumption says so:

- **The frame list at `+0x14`.** The game stores a part's frame list there when it loads the part's pictures and
  clears it when it frees them (`0x107dc` and `0x1084c` in Even More English floppy, `0xfcda` and `0xfd38` in TIM 1
  French).
- **The acceleration at `+0x08` and the speed limit at `+0x0a`.** Both are 0 in the program for every type. The
  routine at `0x369c` (Even More, English floppy; `0x2af1` in TIM 1, French, where the table sits in the data
  segment) works them out for every type: the acceleration from the type's density, the air pressure (`[0x4cb7]`) and
  the gravity (`[0x4cb9]`), and the speed limit as `0x3000` (12288) for the bullet (type 20) and the cannonball (type 43) and as `0x2600` minus a value of the air pressure for every other type: `9728 - (air >> 1)` when the air
  pressure is below 70, else `9728 - (air << 4)`. The level loader calls it right after it reads the air pressure and
  the gravity (`0x13b46`), and so do `0x12593`, right after it stores a new air pressure, and `0x15d90`. In the Even More
  builds no other store reaches those words (the other `es:` stores to `+0x08` and `+0x0a`, at `0x7193` to `0x71f2`,
  go to a block the game allocates); in TIM 1 the table sits in the data segment, where a store to it doesn't show by
  its form. Leaving the words out holds either way.

No line or walk read `+0x08` or `+0x0a` in the recorded builds before the speed limit below, so nothing else changes.

### The speed limit

The routine at `0x37bc` (Even More, English floppy) keeps a part's speeds within its type's speed limit, vertical
first: a speed above the limit becomes the limit, else a speed below minus the limit becomes minus the limit, else it
stays. Its matcher gives two writes per speed, each with its test, and a caller used to call the field unknown
("Conditional contact-velocity-limit effect"). The two tests for a speed never both hold, so the new speed is now one
exact value: `limit if speed > limit, else -limit if speed < -limit, else speed`, signed, built with `choose` from the
speed the caller holds and the limit word `+0x0a` of the part's type record. `speedLimitOf` gives the speed and the
limit back.

This names the speeds of the touching part that the trampoline and the alligator write, the rocket's own speeds and
the speeds of the bullet and the cannonball the gun and the cannon make. The limit is a word the game works out from the
level's air pressure (see above), so for a part whose type the rule knows it is that type's limit; for the bullet and
the cannonball it is 12288, no less than any speed the gun and the cannon set, so those speeds stay as set. Rules with
unknown writes go from 33 to 25 of 925 in Even More, English floppy, and from 28 to 23 of 764 in TIM 1, French; every
walk still ends and the recordings stay at 606 complete, 42 prefix, 0 different and 512, 40, 0.

### Parts linked into an ordered list

The insertion at `0x629d` (Even More, English floppy) links a part into a list of parts kept in order. It walks along
the list from the head slot it is given and stops where comparisons of the type records' words (`+0x20` for the list
at `0x4cdb`, `+0x02` for the others) and of the parts' fields `0x8e` and `0x8c` say the new part goes. It then sets
the new part's link `0x00` to the part it now stands before (0 at the end of the list) and its link `0x02` to the
part before it, or to the head slot when the new part goes first. Which parts those are depends on the parts the level
has, so the rules name them after the call: `next in the ordered list after the insertion at` and `previous in the
ordered list after the insertion at` the call's address, in the field form marked `unresolved`, like the other values
only the run gives (`RUN_VALUE`). The summary keeps which link is which (`orderedLinks`).

This names the links of the rope end, cannonball, bullet and explosion that the balloon, cannon, gun and dynamite
plunger make. Rules with unknown writes go from 25 to 16 of 925 in Even More, English floppy, and from 23 to 14 of 764
in TIM 1, French.

### Fields a helper sets on every way

A helper whose every way through was followed becomes a relation (`engineFromObjectRelation`): its stores to the
part, each with the tests of its way. A caller used to call such a field unknown ("Conditional owner-field-relation
effect") unless one store covered every case, although the helper sets it on each way. Now, when every way ends with
a value in the field and the ways split like a tree on their tests (one test is on every way, as itself or its
opposite, and so on), the field gets one exact value, `chooseByTests`: the value of the way whose tests hold, built with
`choose`. A field one way leaves alone, or whose ways don't split like that, keeps its stores with their tests.

Most of these helpers are the flip helpers that move a rope or belt point with the part's flip flag (`0x08 & 0x10`):
the cannon's and the dynamite's `0x72` and `0x73`, the dynamite plunger's `0x6a` and `0x6b`, and the belt point
`0x56` to `0x58` of the monkey bike and the electric motor. Rules with unknown writes go from 16 to 10 of 925 in Even
More, English floppy, and from 14 to 8 of 764 in TIM 1, French.

A caller takes such a helper's ways one by one when it can. It can't when the helper also makes a part, like the
dynamite's explosion helper (`0x1a432`), which sets the dynamite's frame to 5, makes an explosion and sets flag
`0x2000` of its drawing flags on both ways (whether the explosion was made or not). The caller used to put in only a
field the helper sets to one number on every way and call every other field unknown ("Conditional effects of
helper"). Now it also puts in a field the relation gives one exact value, worked out from the part's fields as they
are when the helper starts, before any of the helper's writes go in. The dynamite's three rules that call it now know
its drawing flags: Even More, English floppy, goes from 10 to 7 rules with unknown writes, TIM 1, French, from 8 to 5.

### A small helper's table reads

The reader of a small helper's exact stores (`ownerPathStores`, the one that gives the gear's push its exact value)
now also follows a word or byte read from the data segment at an index it knows, a shift left by a number, and the
byte halves of the word registers (a byte write forgets the word, a word write forgets both halves). Such a read is a
table read, as in the routine analysis. This gives the light bulb's helper `0x1bbef` (Even More, English floppy) its
values: it sets `0x6a` and `0x6b` to the bytes at `0x2f3c` and `0x2f3e` of the data segment, four bytes per frame,
indexed by the frame. Before, it called both "the value stored requires symbolic analysis". The two light bulb rules
that call it now write known values: Even More goes from 7 to 5 rules with unknown writes, TIM 1, French, from 5 to 3.
No other helper changes.

### Helper stores made exactly when their tests hold

A small helper's store gets the tests that lead to it in two ways: `ownerStoreConditions`, when every way through the
store passes the tests, it is the last store to its field there, and every way that passes them goes through it; and
`ownerPathStores`, when every way is read exactly. Either way the field ends with the stored value exactly when the
tests hold, and two stores to one field never both have their tests hold. These stores are now marked `exact`, so a
caller gives the field the stored value when the tests hold and its old value otherwise, instead of an unknown. A
caller used to do that only for a single test; it now also does it for several tests together (`choose` nested over
them).

This names the mouse motor's control value after its start (`0x1c074` in Even More, English floppy): 1, or -1 when the
motor is flipped. Even More goes from 5 to 4 rules with unknown writes; TIM 1, French, from 3 to 2.

### Large values a caller takes from a helper

When a caller takes a helper's ways one by one, it puts the part's fields as it holds them into each value the helper
leaves. Those values used to be cut off at the usual expression budget (96 nodes), which a drawing position the frame
drawing helper set is larger than, so the field became "Unresolved operand in +". They now get the budget the frame
drawing helper's own values get. This gives the fish bowl's run (`0x1ad0e` in Even More, English floppy) the drawing
position `0x2a` and `0x2c` its helper `0x1ad71` sets when it moves the bowl to frame 11. Even More goes from 4 to 3
rules with unknown writes; no other rule changes. TIM 1, French, goes from 2 to 1 (its fish bowl).

### The speed setter's velocity

The speed setter (`0x7d97` in Even More, English floppy; `discoverDirectedVelocity`) gives a part a velocity
of a given speed in the direction of a given angle. Its summary used to call both velocity words unknown ("The speed
times a coefficient of the angle, shifted right by 14") and keep only the speed beside them. They are now the formula
its proof already checks: the signed long product of the speed and the angle's coefficient (the coefficient routine's
table read, `rotationScalarExpression`, a quarter turn on for velocityX), shifted right by 14, low word. A test works
it out for many speeds and angles against the code's own steps. The speed stays beside the field (`directedSpeed`), as
the effect lines use it.

The angle the pinball bumper gives it is the centre angle's answer from the bumper's centre to the ball's. Where the
centre angle's summary has no formula for that answer, the answer is now named after the call, `centre angle answer
at` the call's address, like the other values one run gives (`RUN_VALUE`); the call keeps which two parts it is of
(`centreAngle`). So the bumper's bounce writes the ball's velocity as a named value of that angle: Even More, English
floppy, goes from 3 to 2 rules with unknown writes. TIM 1, French, has no pinball bumper and stays at 1.

### Frame sizes from the part's sheet

A part without a size of its own or a list of sizes in its type record gets its frame's size from the list at `+0x14`
of its type record. The program shows what that list holds (Even More, English floppy; TIM 1, French in brackets):

- The routine at `0x10770` (`0xfc73`) loads one part's pictures. It builds the name from `part`, the type number in
  base 10 and `.bmp`, calls the sheet loader `0x2658:0x067c` (`0x24dc:0x067d`) with it and stores what the loader
  returns at `+0x14` of the type record (`0x107dc`, `0xfcda`).
- The loader opens the sheet. When it has a `BMP:SCN:` chunk, the loader's reader `0x1ee5:0x630c` (`0x1c71:0x728d`)
  finds `BMP:INF:`, reads its frame count and makes a list of a word for each frame and a 0 after the last one, each
  word pointing to a ten-byte record. It reads the widths and then the heights and stores frame n's width at `+6` and
  its height at `+8` of record n, as the words they are. Only when the chunk is shorter than four bytes for each frame
  does every frame get the first width and height.
- The loader then marks each record's packing at `+4` (`0x2658:0x09be`), reads the pixels into a block of its own and
  stores where each frame's pixels start at `+0` and `+2`, and counts the list (`0x2658:0x09ea`). An `RLE:` or `SCL:`
  chunk would make it go over the list again; no part sheet has one. When anything fails, it frees the list and
  returns 0.
- The frame size helper reads the list word `L`, and when it isn't 0, the width at `+6` and the height at `+8` of the
  record that `L + 2·frame` points to.

So each frame of such a part is as wide and high as the same frame of its sheet, `PART` and the type number. The analysis matches the routine
that stores the list, the loader, the reader and the two routines the loader hands the list to against their complete
compiler forms, which are two for the store (TIM 1 in the data segment, Even More through `es`), two for the loader
(the Even More CD picks between two allocators for the pixels) and one for the reader, in all eleven builds. Their
strings must be `part`, `.bmp` and the chunk names. The sizes come from the `INF:` chunk the way the reader takes
them; for every part sheet of the eleven builds they are the sizes the resource reader's `decodeImage` gives.

`readProgramParts` takes the sheets' files as an optional fourth argument and keeps the sizes by type. A frame size
read then becomes the sheet's number when the frame is a number. When the frame is a value of the part, like the
frame after this one, it becomes the sheet's sizes selected by that value; for a frame the sheet doesn't have, where
the game reads past the end of the list, the read stays. The test that the list isn't 0 becomes true. These values
state the assumption that the list is the one the game built from the build's `PARTn.BMP` when it loaded the part's
pictures, and that nothing changes its sizes while a level runs.

In Even More, English floppy, 522 of the 1,296 drawing writes of transitions read the list, for 11 parts like the cat,
balloon, teeter-totter and mouse; all of them now use the sheet, and 328 no longer read the list at all (the others
keep the read for a frame past the sheet). In TIM 1, French, it is 640 of 1,122, for 11 parts, and 394. These reads
were never unknown, so transitions with unknown writes stay at 365 and 324, every walk ends as before and no recorded
animation changes; a walk now has numbers for these fields where it knows the frame.

What the size helper reads for a frame the sheet doesn't have (`0x6940`, Even More English floppy): it takes the
frame's entry of the list, `list[frame]`, with no test of the frame or of the entry, and reads the width and height at
that entry plus 6 and plus 8. The list ends with a 0 entry after its last frame. So the frame just past the last one
reads `DS:0x0006` and `DS:0x0008`, which in both recorded builds hold bytes of the compiler's copyright string at the
start of the data segment ("Borland C++ ..."): a width of 27762 and a height of 28257, as long as nothing writes
there. A frame further on reads past the list into memory filled while the game runs. The analysis keeps both cases
unknown: no walk puts a part on a frame its sheet doesn't have, so neither size is ever needed.

## Saved evidence

Large derived JSON files use `evidenceEncoding: "opentim-instruction-evidence-1"`. Each finding's `evidence` retains
instruction addresses. `evidencePool` stores the original bytes and decoded text once. Distinct interpretations at
one address use an explicit `evidenceIndex`. `assumptionPool` similarly shares repeated English assumptions.
`restoreEvidenceDocument` validates and restores the full plain-data findings. Both validation scripts accept this
encoding and earlier reports. `readBehaviour` and `describeBehaviour` still return full evidence objects in memory;
the browser API does not require a decoder for saved JSON.

The comparison script also writes a Markdown description per build, with rest, conditional frame walks, durations,
other effects and stop reasons for every part. These files and the JSON reports are derived from the games and
should not be committed.

## Independent cross-check

The user-supplied [mrfixit2001/OpenTIM](https://github.com/mrfixit2001/OpenTIM/tree/83fac1af87651fb6bcb128c9470fad236133e3c8)
was inspected only for verification. No implementation, tables or tests were imported. Its reverse-engineering notes
identify a Windows executable, so agreement is corroboration rather than proof for the supplied DOS builds. The part
layout agrees on state histories, control storage, position, velocity, contacts, outline data and reused extra slots.
The trampoline and conveyor rules were checked against independently decoded DOS instructions. Several other part
implementations are incomplete in that port, so it cannot validate every animation. Its disappeared-flag label was
not adopted: the inspected DOS paths establish a narrower queueing effect, not a complete drawing contract.

## Conditional scan invariants

A scan may preserve the owner's state only under an established precondition. The reader can specialise direct
owner-state comparisons for a nonzero state at the loop header. It then checks every reachable store and helper
again. Any reachable state-changing operation rejects that invariant. The unspecialised paths remain in the routine
graph and remain unresolved where their effects are unknown.

The caller must entail the precondition using its current symbolic state, including preceding updates. An unknown
entry value does not select the convenient invariant. This permits nonzero-state cat scans to preserve their current
frame without claiming that the frame-zero search or its collision-dependent state changes have been resolved.

## Constructors that cannot reach failure cleanup

The factory's null-constructor proof can also cover a constructor with a checked success-only continuation. The
reader checks the table-selected far routine, bounded stores into the fresh owner, unchanged type and state, paired
nonvolatile saves/restores, the entry frame and every symbolic return. This narrow proof rejects callees, implicit
memory effects, escaped stores and any return other than zero.

The factory must compare the result with one and branch to the same continuation used when the constructor pointer
is null. Its owner push and dispatch sequence must have one unambiguous entry. The constructor-failure edge is then
unreachable. Initial allocation failure still uses the separately proved null cleanup. The evidence includes the
constructor table entry, constructor instructions, dispatch bridge and original factory skeleton.

This covers the rope-end constructor used while a balloon detaches from its rope. Constructors that allocate outline storage can return failure and do not receive this success-only contract. Their
separate cleanup proof is described below.

## Constructors with owned failure cleanup

A constructor which allocates outline storage can fail even when its successful writes stay inside the fresh part
and its outline buffer. These are separate proofs. The reader now combines the successful write scope with a checked
allocation-failure path, the factory's cleared allocation, unchanged cleanup fields and the actual cleanup CFG.

The failure-path matcher requires the allocation result to be stored before its zero test. Returning one requires a
null result; the success helper is unreachable on that path. A success return may jump through a shared epilogue bridge,
but that bridge must not execute the failure-value assignment. The other cleanup-owned words must retain their proved
entry zero. The cleanup matcher checks every instruction and edge: zero fields skip secondary releases, leaving only
the fresh owner to release. A shared stack argument such as `push word [bp+6]` can forward the owner to a helper when
that entry argument remains intact. Byte arguments, changed stack arguments and different slots do not qualify.

The release certificate is restricted to an exclusively owned allocation. It matches the complete header-release,
coalescing, free-ring insertion, tail removal and logical-boundary routines. The allocator must use the same header
layout, unlink entry and heap globals. Its initialization, growth and split routines are checked as well. The cleared
allocation proof separately follows the argument wrapper, checked product, allocator call and forward byte/word fill.
Every nonnull return has its whole requested payload cleared. These are decoded structure checks, with no selected
heap contents, callback invocation or execution of game instructions.

The contract assumes valid finite heap metadata, separate live payloads and stack storage, and sufficient stack
capacity. It invalidates the freed payload and preserves other live allocations on normal returns. It grants no
preservation contract to an arbitrary release call. The logical boundary helper writes only its recorded bookkeeping
globals; it does not call an operating-system service. Heap validation can prevent return for a malformed heap.

The factory proof then checks both constructor results through the existing CFG. A return of one follows failure
cleanup; a return of zero follows the shared success continuation. The type-selected constructor and every shared
prefix/suffix operation must remain scoped. `ownedConstructors` records the resulting type-specific certificates,
with evidence and assumptions. It does not supply invented initial states or numeric allocation addresses. This
covers the projectile and bullet constructors used by the cannon and gun in the supplied builds.

Counted loops also require a complete part-memory footprint from a helper that can write object fields. State
preservation alone cannot justify retaining old counter, pointer or drawing values after the loop. Such a helper
leaves the loop unresolved until its remaining writes are bounded.

### The release wrapper in the Even More CD build

The release certificate starts at a checked wrapper: validate the heap, push the owner, call the release wrapper,
validate again. In the Even More floppy build that middle call is `nop`, `push cs` and a near `call`. In the Even
More English CD build it stays a real far call (`call 0x0000:0x63a0` at `0x1193e`, inside the wrapper at
`0x11933`; the floppy wrapper at `0x9024` has its near form at `0x902f`). The matcher only knew the near form, so the CD
factory at `0x15d85` got no owned constructors. The cannon's projectile (`0x19ba8`) and the gun's bullet (`0x1b3ff`)
then left their run rules with unresolved effects: two cannon transitions and one gun transition. A far call pushes
the same return segment and offset as `push cs` with a near call, so the wrapper still reads its argument at `[bp+6]`
and returns with `retf`. The matcher now accepts either form; every other instruction, edge and the whole chain behind
the wrapper are checked unchanged. The CD build then proves the same fifteen owned constructors as the floppy.

## Connected gear traversals

The reader matches the complete propagation, advancement and peer-query instruction graphs. Both compiler forms
of their shared return bridges are accepted. Discovery binds fields and call targets from operands and references;
it does not use a build address. Connection slots and the peer endpoints must denote complete part bases in a valid
finite graph. Distinct parts have disjoint storage, while repeated references and self-links may alias.

Propagation writes pending movement and visited flags. A nonzero pending movement is never replaced, so the caller's
nonzero movement survives a traversal which comes back to that caller. Marking a gear before expansion bounds the
recursive visits. Advancement adds the source's pending movement to its state, applies the two decoded boundary
cases, and clears pending movement before following neighbours. The zero-movement gate then prevents a cycle from
advancing the original owner again. This proves the owner relation without choosing any connected parts or executing
the recursion. The full conflict result is now retained as an ordered graph relation, described below; its numeric value depends on the runtime connections and movement inputs.

The part-graph footprint lists every possibly changed field on any connected part. Applying it invalidates cached
values and gives later uncached or overlapping reads a new symbolic field version. A protected owner field keeps its
previous version rather than reverting to the invocation input. Broader unknown calls supersede older field versions, while a state-preserving contract retains the owner's state
version. Partial stores also prevent old word guards from constraining the changed value. Explicit related-object writes remain in the report,
so a bounded field footprint cannot be promoted to an owner-only relation. General forwarder and list-scan proofs do
not consume this contract; counted loops check the bounded connection argument separately.

The frame graph can become larger when an earlier unresolved loop boundary is replaced with the actual state cases.
Unknown conflict-dependent conditions remain unresolved in that larger graph. Removing a call or loop diagnostic is
not proof of a complete animation. The full effect footprint, scalar return and state relation have separate claims.

## Scalar helper returns and analysis work

Read-only leaf helpers sometimes select a constant from consecutive ranges of one input. The reader proves a complete,
disjoint interval cover and the saved-register frame before composing these returns. It encodes the result as ordinary
binary arithmetic: a base value plus changes enabled at each range boundary. Flipping the input sign bit preserves
signed order. All operations retain their recorded word widths. The existing expression size and analysis limits apply;
a failed proof falls back to the existing separate return paths. No public expression kind is added.

Private hints preserve correlations between uses of the same immutable arithmetic expression. They are an analysis
optimization; the serialized arithmetic remains exact without them. Feasibility work has a separate bounded allowance
and keeps a path possible when that allowance is exhausted. `analysisWork` records instruction-analysis visits, their
limit and pending paths. These are reader work counts, not game steps or animation durations.

This lets the teeter-totter callback finish within the existing visit limit. Its remaining unresolved collision calls,
geometry effects and back edge remain visible. Finishing the queue does not prove those effects complete.

## Conditional gear conflict results

The propagation routine returns one after any local conflict; otherwise it returns its incoming accumulator. It is
not a bitwise OR for arbitrary accumulator values. A nonzero target movement conflicts in mode one when it differs
from the source movement, and in mode two when it equals the source movement. Mode two does not establish an exact
opposite movement without additional domain assumptions. `partGraph.conflict` records these tests and argument roles.
An incoming accumulator of one therefore returns one under the existing finite-graph assumptions. The ordered graph relation below describes the remaining graph-dependent result without selecting a runtime graph.

A separate instruction-graph certificate recognizes the root callback's bounded connection loop. When every inspected
connection word is null, each active iteration skips directly to the counter increment. No propagation call occurs and
the conflict accumulator is retained. The transfer records the actual scratch registers, pointer slot and counter writes.
It applies only after the existing entry proof establishes an active iteration and the nonnegative counter domain.
For a bounded loop without a complete root certificate, the complementary nonempty branch retains conservative graph effects and an unresolved conflict result. A certified root uses the defined graph result described below. The null specialization is conditional on supplied connections; it does not assert that a part is disconnected at runtime.

## Selected overlap candidates

An overlap query first clears its output head, then selects candidates from independent part lists. Candidate stores
therefore do not address the object found through the incoming head. An incoming null head is valid and is never
interpreted as a candidate pointer. `selection: "overlap-candidate"` marks those stores with an unknown root, their
actual field offsets, instruction evidence and unresolved eligibility predicate.

Applying the summary records conditional effects on an opaque selected candidate. It also invalidates overlapping
cached and uncached fields on every potentially aliasing part, including byte reads of a written word. Unless the
query is proved to skip the part that asks (below), the reader does not assume that the selected candidate differs
from the analysed owner. These possible aliases are invalidated
after the ordinary summary stores so that unresolved store ordering cannot restore an old value. Complete query
footprints preserve unrelated fields. Incomplete footprints retain the existing broader nonstate invalidation.
Unknown-root effects remain ineligible for generic owner-only or list-loop promotion.

### Queries that skip the part that asks

Three of the four overlap queries compare each listed part with the part that asks and pass over it before they link
it (`0x417e`, `0x42da` and `0x448e` in Even More, English floppy; the same three in every supplied build). The reader
checks that comparison and its branch on the query's code (`list.excludesArgument`). When the analysed part itself
asks such a query, the parts it marks are never the asking part, so its own fields at those offsets keep their values;
only its list head at `0x78` changes. When another part asks, the owner may be selected and those fields are still
forgotten. The teeter-totter's outline search (`0x437d`) does not skip the part that asks and keeps the old rule.

The cat, for example, now keeps its own `0x7a` and `0x7c` through its search for a mouse. No walk and no transition
count changes: those transitions test what the search found, so they count as conditional.

## Connection-query bypasses

The reader matches the complete two-connection query graph, including compiler return bridges and its far indirect
callback operand. The second far-call argument is the owner; the first is the excluded peer. A set tested entry flag
returns one before scanning. With that flag clear and both connection words null, both iterations skip every call
and return the unchanged zero accumulator. Both cases preserve non-stack memory and retain their decoded evidence.
The flag is not given a gameplay meaning beyond its checked branch role.

`shortCircuit` records these conditions, results and the complementary unresolved case. A caller uses a bypass only
when its existing input relations establish the entire guard and its far-return frame is correct. Unknown connections
are not assumed null and do not cause speculative path expansion. The remaining query calls the peer type's rope
callback; [the rope connection query](#the-rope-connection-query) bounds what those callbacks may change.

## Fresh lists passed to another routine

Some helpers consume a list which their caller has just built. Their bodies do not establish that the incoming list
is acyclic or excludes the owner. `listConsumer` therefore records a conditional contract, including the head and
next fields, complete member and separate outline footprints, calling convention and explicit list requirements.
Discovery reuses the list-loop CFG proof with an external entry; ordinary analysis does not assume this entry.
Private frame effects are excluded from the caller footprint and return registers remain unspecified.

A stronger `overlapProducer` certificate establishes the required output shape on normal return. The head starts at
zero and each candidate is prepended at most once. The checked head/next helpers define a deterministic successor;
the query does not change its source links, class flags or global heads. Repeating a candidate would therefore repeat
the successor cycle and prevent normal return. A returned enumeration is finite and has no repeats. Together with
the checked owner exclusion and prepend operations, this gives an acyclic owner-excluding result. Valid complete part
bases, nonwrapping fields and separate part, global and private stack storage remain explicit assumptions. This proves
a postcondition of returning; it does not claim that arbitrary source lists make the query terminate.

At a consumer call, every incoming CFG path must cross a matching producer on the same preserved owner register.
No intervening call, object store, owner-register replacement or frame mutation may invalidate that provenance.
Argument pushes must have a unique straight path into their calls, with the correct near/far frame. The actual
consumer argument must also be the analysed owner's complete base; a list built for another object gives no owner
exemption. Missing or invalidated provenance leaves the original unresolved effects in place.

Only at a proved call site does the analyser preserve the owner's fields while recording conditional effects on
listed parts and their separate outlines. Scoped invalidation retains overlapping and uncached aliases of those
related objects. Outline effects retain their storage identity and are described as coordinate changes, not as part
flags at coincident byte offsets. Backend globals and numeric return values can remain unresolved independently.

The producer proof also accepts constant masks in the head and successor call bridges. It verifies the complete
constant setup and its unique path into the call. Such a query can rewrite its coordinate argument because that
argument no longer supplies the successor mask. Queries using an argument mask still have to preserve that argument.
The successor remains deterministic on normal return; no new source-list termination assumption is introduced.

## Scalar angle helpers

The reader matches the complete four-sector classifier, including its shared-return compiler form. The two explicit
boundary returns are combined with the general shift-and-mask result into one ordinary expression. Arithmetic wraps
to the decoded 16-bit width. This preserves every input case while avoiding three-way path splitting in callers.
The summary retains the complete instruction evidence, scalar argument position and near/far return convention.
It has no part or global writes. Its mathematical relation is tested over the complete 16-bit input domain; no x86
instructions or game callbacks are executed by that check.

A second complete graph matches the enabled saved-angle check and verifies its call to that classifier. It reads
three discovered global words and compares the requested angle with the saved angle in two disjoint shifted windows.
Its single Boolean expression preserves the explicit signed bounds and inclusive side comparisons, without assuming
that the saved sector agrees with the saved angle. The globals are assumed stable during this read-only call.
Both scalar summaries require a matching return frame at the caller: a far call or an unavoidable PUSH CS bridge
for a far-return routine, and a near call for a near-return routine. Missing frame evidence keeps the call unresolved.

## The full gear conflict relation

`partGraph.propagation` describes the complete recursive relation: movement, type and flag fields, argument roles,
ordered connection slots, peer selection, assignments into zero movement, local conflict predicates and the returned
accumulator. The root callback has a separate `gearRun` certificate. Its entire graph and referenced propagation,
advancement and peer graphs are matched and independently rechecked. No level graph, concrete connected part or
callback execution supplies the result.

For each invocation, a zero target receives the source movement in mode one or its modular negative in every other
mode. This assignment reports no local conflict. A nonzero target retains its movement. Mode one conflicts when
that value differs from the source, mode two when it equals the source, and other modes do not report a local
conflict. The comparison happens before the type and visited tests. Thus a visited target can still report a conflict
or receive movement, even though it does not expand again.

An unvisited gear is marked before its four direct slots and then its linked peer are followed in depth-first order.
The four slots use mode two, and the peer uses mode one. Recursive candidates are skipped when null or blocked.
The peer query returns zero for a null connection record, otherwise its second endpoint when the first equals the
owner, or its first endpoint otherwise. It is not assumed that an arbitrary owner belongs to a malformed record.

Let a checked invocation be any invocation admitted by this ordered traversal. The exact return is one if any such
invocation reports a local conflict; otherwise it is the incoming accumulator. This follows by induction over the
finite marked traversal: a local conflict stores one, every child receives the current accumulator, and the child
return replaces it. The result is not a bitwise OR for arbitrary incoming words. Nonzero incoming accumulators stay
nonzero; the root's zero seed gives exactly the domain zero or one.

With a nonzero source, each first encounter with a zero target gives it a nonzero label, and nonzero labels never
change during propagation. Existing nonzero words are initial seeds. Later incoming edges test those labels with the
recorded comparisons. This is the exact first-encounter relation for arbitrary words. A simpler sign-constraint
interpretation requires all initial nonzero seeds to share a common magnitude with two distinct signs, and invocation
modes one or two. Only in that domain does conflict mean inconsistent equality/opposition constraints extending those
seeds. A checked odd cycle of mode-two edges then conflicts. The word 0x8000 is its own modular negative and is not
in that domain. A zero-target assignment edge is never silently turned into a conflict check.

The root callback marks itself and folds four nonnull direct slots in order, starting with accumulator zero. This
initial pass does not test the blocked flag and does not include the root's peer. `derivedValues` binds its result to
the exact propagation relation and the heap before that scan. The named `field` expression is a symbolic register
result with an explicit definition, not a memory field at byte zero or an independent game input. The definition
must accompany its zero/nonzero conditions and must not be reused as a fixed value across subsequent invocations.
The existing expression kinds remain unchanged.

The analyser applies this relation only to the checked root loop, at counter zero, with its actual owner pointer and
nonzero movement established. The complete root proof puts the owner's visited mark before the loop. Propagation
can only OR that mark into flags, so the owner's already marked flags and nonzero movement retain their current
versions. Other connected parts retain the complete possible field footprint and chronological alias invalidation.
The existing all-null branch still gives a literal zero result without referring to the symbolic graph result.

## Advancing and suppressing connected movement

`partGraph.advancement` records a different graph relation and input phase. Its movement snapshot is immediately
before advancement, after propagation and any root clearing. The root always adds its input movement to its state,
normalizes a sum of 65535 to three or four to zero, and clears movement before scanning neighbours. Other sums are
retained; there is no general modulo-four operation.

The reached gear closure starts at the root and follows unblocked nonzero-input-movement targets, expanding only
gears. Adjacent eligible non-gears form terminal targets. Without suppression, each reached gear adds its pending
movement once and clears it; terminals retain theirs. With suppression, a target is cleared before its type check
and a recursive gear call. Reached gears therefore add zero and terminals are cleared too. The helper itself still
uses the root's input movement; the root callback clears that root before calling it on conflict. Even with zero
movement, raw states 65535 and four normalize to three and zero. States zero through three hold under suppression.
Parts outside the reached gear and terminal sets are unchanged by this helper. Blocked targets and zero-movement
intermediate gears can leave other movement in the physical connection component untouched.

## Gear scheduling and drivers

`gearScheduling` certifies two regions of the enclosing run dispatcher: a list pass clears the processing mark
along with two other recorded bits, and a later gear-only pass checks the type and current exclusion/processing flags
before invoking the type-selected run callback. The regions use the same global head and primary next field. Their
complete edges, pointer identity, table index, return bridge and ordering are checked. Earlier passes may already
have called or marked a part; the finding does not claim that every gear runs exactly once per cycle. List membership,
valid finite storage and the calling convention remain explicit assumptions.

`describeBehaviour` exposes the propagation, conflict, advancement and scheduling rules in plain words. It also links
movement writes from other parts when their selected connection endpoint uses the same checked connection layout.
A driver source is conditional on this gear being the endpoint selected by that write; its original source predicate,
value, confidence and evidence are retained. A continued rotation is not inferred from a single assignment, and a
reset or a level's starting movement is not invented.

## Building the direct gear connections

`gearConnections` is a separate normal-return postcondition of the reset callback. After the common outline helper
returns, the callback clears its four direct slots and scans the checked global list. It skips the owner and types
other than the checked gear type. Two saved-position differences select a slot: one must be zero and the other
exactly plus or minus 32 as a wrapped word. A later matching candidate replaces an earlier one; a null slot means no
matching candidate was selected. The entire graph, frame, loop progress, type/self filters and stores are checked.
The helper may change fields before this measurement; the construction snapshot is explicitly after its call.

Each such direct edge flips `((savedX >>> 5) ^ (savedY >>> 5)) & 1`, including word wrap. If all retained direct links
refer to one common stable saved-position map, this is a bipartite mesh: a direct closed chain cannot have odd length.
The generic propagation relation still permits arbitrary self-links and cycles, but the reset builder itself excludes
self-links and does not produce an odd direct cycle under that coordinate invariant. Extra same-direction peer edges
and incompatible input movement seeds can still conflict. Reciprocal links, unique occupants, global membership of
every gear and permanent coordinate stability are not inferred from the reset scan.

The retained-mesh corollary is conditional too. If no eligible peer edge is checked, only the root is initially moving,
and its nonzero movement differs from its modular negative, every first-encounter label is determined by the coordinate
colour relative to that root. Each checked mesh edge joins opposite colours and cannot report equality, so conflict is
zero. Pruned branches from blocked or initially visited targets do not break that proof. This includes ordinary plus-one
or minus-one movement through an otherwise idle reset-built mesh. It does not apply to multiple input seeds, a checked
same-direction peer edge, changed direct links, or the self-negative word 0x8000.

## Shared contact searches

The reader now separates three contact contracts. `contactBounds` records the ordered scratch-coordinate
calculations, including wrapped subtraction, signed half dimensions, signed minima and word absolute values.
The source dimensions remain explicit: the supplied TIM 1 builds use current frame dimensions for their centres,
whereas Even More uses the separate stored dimensions. These formulas prepare bounds; they do not establish a hit.

`contactSelection` checks the complete candidate-scanner graph. The previous contact is tested first, followed by
eligible members of the selected global lists. The first contact test requires strict rectangle overlap. The
second also requires strict overlap for the previous contact, but admits touching rectangle boundaries for a listed
candidate. Both tests can run for one candidate, and accepted updates can change the subject and scratch bounds
before later candidates. The report therefore does not call this a first-hit or nearest-contact search. Even More's
scanner additionally excludes four unordered type pairs through its checked scalar filter. TIM 1 has no corresponding
call in this scanner. The remaining first candidate filter is retained as a read-only helper result.

`contactSegment` describes the endpoint test's actual integer calculations. Coefficients and the determinant wrap
to words. The nonzero-determinant case uses full signed word products, wrapped long subtraction and a separately
certified signed long quotient, rounded towards zero; the output takes its low word. The division proof uses a
32-iteration restoring-division invariant, never sampled machine states. The zero-determinant case tests the encoded
sum of two products and chooses either the first segment's second endpoint or the origin. This unusual branch is
preserved directly. The output is written before four inclusive coordinate-range tests decide acceptance, so a
false result does not mean the output buffer is untouched.

A separate pointer-provenance proof bounds the contact searches' memory effects over every CFG edge. Identical
argument, global and local pointer origins survive joins; ambiguous origins fail the proof. Complete callee
footprints are composed, private output buffers must stay inside the frame, and volatile registers and local pointer
facts are discarded across calls. This proves state preservation while retaining potential writes to position,
drawing geometry, contact fields and flags. A global subject can alias the caller, so those fields are invalidated
in every possible part, including the owner. They are never promoted to preserved inputs merely because the helper
was passed a scalar probe flag.

The scanner's zero-outline return is certified separately. It still stores the argument pointer in the global
contact context before returning zero. The caller may use this bypass only when the extracted conditions already
prove the outline pointer is zero. No outline, collision or successful-contact input is supplied by the analyser.

The two `contactOutline` relations now check the complete edge and vertex loops, including their angle gates,
endpoint extension, both endpoint tests and position correction. They preserve the encoded order: a successful
correction changes the inputs to later pairs, while some edge coordinates retain earlier snapshots. Closing edges
use the remembered first point. The finite-loop interpretation assumes valid separate outline storage and counts
between two and 32766; it does not promise termination for arbitrary corrupt counts.

The first pass tests candidate edges against moving subject vertices. The reverse pass tests subject edges against
moving candidate vertices. Both reject the extended endpoint and can restore the previous position after a failed
correction while still recording a contact. Flag mask `0xfff9` clears bits two and four, preserving bit one. The
contact pointer, angle, edge index and accumulating side bytes retain their exact branch conditions. The reverse
side comparison uses a centre saved before geometry refresh; the forward helper reads the refreshed centre.

`contactSmall` certifies endpoint extension, direction-dependent side marking and the typed linked-list membership
filter. The latter tests type 17 (the bucket) and its selected list; a list member is not given a physical meaning
that the instructions do not establish. A wrong type or empty list returns zero. A nonempty list remains conditional
on its actual members, and cyclic lists need not terminate.

`contactMotionAngle` records the entire movement-angle wrapper, integer backend, shift, signed long quotient and
code-segment table reference. The wrapper sign-extends wrapped position differences. Their magnitudes are at most
32768, so the ratio index is proved to lie between zero and 511. Equal magnitudes bypass division and lookup. The
loaded table words are included as an initial image snapshot, not assumed immutable runtime constants. Wider
arbitrary long inputs have separate qualifications; no host trigonometric function replaces the game calculation.
The candidate scanner links its angle context to this wrapper at entry and after successful passes.

Callers can use two narrower outline contracts when their existing conditions prove the inputs: zero displacement
in both contact-context words returns zero without nonprivate writes; a nonzero probe performs no nonprivate
writes but still has an unknown contact result. The calling frame must be established. A near call requires an
immediately preceding `PUSH CS` on its sole incoming edge. These facts never supply a runtime collision, infer
zero displacement from velocity alone or preserve stale context through an unknown call.

The relations are symbolic contracts, with confidence, instruction evidence and explicit storage assumptions.
Unknown level geometry, selected contacts and indirect callbacks can still stop animation walks. A complete
geometric relation is not a claim that every part's triggered animation is now known.

## Contact callbacks and response selection

`collisionDispatch` checks the complete contact-processing list region, including every incoming and outgoing
control-flow edge. The two indirect calls select a callback using the recorded contact partner's type, while
passing the moving part as the first argument. The report retains all loaded type-table alternatives and their
pointer bytes. These are conditional targets: the partner's runtime type must be valid and the table must remain
unchanged. The original calls remain indirect in the decoded routine.

The dispatcher first excludes parts with mask 8 at `+0x06` or mask `0x2000` at `+0x08`. Contact mask 2 has priority
over mask 4; the second dispatch is reached only when mask 2 is clear. A callback returning zero skips the response
helper. A nonzero return selects the recorded helper, using flags read after the callback. The list's next pointer
is also read after callbacks and responses, so this is not a claim of fixed membership or one visit per game step.

Even More has an earlier self callback for type 54, Mel Schlemming, when either contact mask is set. Its return is
ignored. Later contact gates read the fields again, and the first response route excludes this type. TIM 1 has no
corresponding self call or type exception in this region. Eligibility before the self call is not silently reused
as a statement about fields after it.

Only complete return-only callback bodies receive a constant return in this contract, with their own instruction
evidence. Other return values and effects remain in the callback analysis. `describeBehaviour` adds a conditional
contact description per part. It does not supply a collision, choose a runtime partner or create an animation seed.
The response helpers' addresses and arguments are established; their physical effects need their own contracts.

## Small contact response effects

`contactResponse` on a helper now retains two complete wrapper relations. The velocity limiter reads field `0x0a`
from the moving part's runtime type record, then tests vertical and horizontal velocity in that order. Its signed
upper comparison has priority over the comparison with the wrapping negative limit. If neither write condition
holds, the field is unchanged. The table reference is checked against the discovered type table; the report keeps
it as a runtime read. A negative or changed record value is not silently replaced by a positive imported limit.

The other wrapper tests type zero and computes two word absolute values with `CWD`, `XOR` and `SUB`. Their sum wraps
before a signed comparison with 4096. Only a passing gate requests scalar resource 20. The wrapper establishes a
resource request, not audible sound or a particular recording. In particular, `0x8000` absolute values and sums
crossing `0x7fff` do not behave like an unbounded mathematical speed. The resource backend's unknown global and
driver effects remain unresolved. Owner-memory preservation retains the backend's explicit separate-storage and
no-hidden-owner-alias assumptions.

Both relations match the entire routine and every CFG edge across the compiler forms. A changed comparison, store,
calling frame or table reference declines the summary. `collisionDispatch.responseSupport` links the checked small
relations to response routines through their direct call graph. These links establish reachability, not execution,
argument identity through an arbitrary wrapper, or the complete physics of a response. Their field predicates apply
to the helper's actual argument when reached. The larger rotation and momentum calculations remain open.

## Collision velocity and position responses

The response contracts retain integer arithmetic as named computed stages and ordered stores. A stage is defined
from its declared inputs or earlier stages; it is not an independently assignable part field. Word and long results
wrap before later comparisons. Products use signed word operands, shifts preserve the encoded sign and rounding,
and fixed-point positions retain their low and high word stores. These relations are extracted from complete
routine graphs and their checked arithmetic dependencies. The library does not execute them on a game object.

`rotationScalar` describes the two coefficient lookups. The optional phase addition wraps before four logical
right shifts. Indices in the upper half are folded using 4096 minus the index, giving a proved range from zero to
2048 inclusive. The report retains the 2049 loaded table words as snapshot evidence and keeps later reads dependent
on runtime table stability. `contactRotation` records the two full signed products for each output, wrapped long
addition or subtraction, arithmetic shift by fourteen and low-word results. Both input coordinates are read before
either output is stored. The second store replaces any overlapping bytes of the first, including when the output
words overlap by one byte.

The arithmetic helpers include the compiler's near-call adapters that build a far return frame internally. Their
logical calling convention is proved from the complete adapter and shift body. A scalar, rotation or response
contract is applied only when the caller supplies its required frame. The generic analyser retains precise state
preservation and possible write footprints, while numeric results that need the larger stage relations remain
unresolved in that analyser. No synthetic coefficient, runtime contact or velocity is supplied to complete a walk.

`collisionDispatch.responses` links each selected response directly to its numerical relation, field footprint,
plain-word description and evidence. Missing contracts remain explicit unresolved entries. Per-part contact
summaries expose those descriptions conditionally on the selected response route and callback return. Before a
response footprint is applied, potentially aliased cached part fields are invalidated, including fields of an owner
that could be the related argument or recorded partner. Fields outside the complete footprint retain their values.

The reflected response records a further difference between games. TIM 1 always applies the encoded scaling and
word damping. Even More can bypass that step when the owner's record field six is zero, and Even More also has an
additional coefficient exception for type 59. The two-part exchange uses a separation threshold of 512 in TIM 1 and
1024 in Even More.
Even More additionally suppresses one separation candidate when its signed absolute horizontal component exceeds
the vertical component, before the final control-mask override. These differences are retained in the relations.

The exchange also has a genuine normal-return requirement: the signed long sum of the two record weights must be
nonzero before division. Its ordered contract retains that gate and the field writes preceding it. Until the generic
caller analysis can compose this requirement, the exchange relation remains metadata-only and grants no caller
state-preservation shortcut. The resource wrapper's unresolved globals also remain explicit. Full numerical
relations live in the report's helper and dispatcher contracts; per-part descriptions refer to them by routine.
