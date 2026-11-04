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
particular interpretation of an unknown value or effect.

- Each part has six callback references, with its record field, code address, sharing and default-body status.
  The traditional event names remain candidates: dispatch establishes a code pointer more strongly than the
  complete collision, resize or rope semantics of its callers.
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
The limits are 12,000 decoded instructions per routine, 1,800 call-graph entries, 10,000 symbolic visits per callback,
800 per helper, and 96 expression-tree nodes. Exhaustion is a diagnostic and an unresolved result. These limits
bound browser work; they are not claims of completeness.

A visit is one instruction on one path, and a part list's loop body is followed again for every path that reaches it.
The run routines of the teapot, the vacuum cleaner and the cat blow or chase the parts their search finds, with about
twenty paths into the list and several branches in its body. They need 5,900 to 8,400 visits, so the callback limit
is 10,000. Each iteration outcome keeps only the writes to the listed member, since the owner's fields are already in
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

When a seed does not fix the state at all, and the part shows its state as one of at most 16 frames, the walk
follows each frame as a starting state in the same way: a state with no frame cannot be drawn, so the frames are
exactly the states a part can be in. Parts drawn without frames, like the conveyor belt and the gear, are not
bounded this way and keep stopping. In Even More this lets 149 walks end in every case, up from 62.

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

Three assumptions make this sound. They are stated on the summary and on every finding that uses it:

- A rope ties two different parts, so the part at the other end of a rope is never the part that asks.
- Ropes between parts never form a loop, so a chain of questions along ropes never comes back to the part that asked.
- A rope end's slot number is one of the part's two rope links, so indexing the links at `0x66` by it reaches a rope
  record.

With these, `connected.exceptArgument` names the argument that is the asking part. When a caller passes its own part
there, it keeps its own fields and forgets them only on other parts. In all eleven builds the query now has a
bounded summary: the callbacks can change fields `0x08`, `0x0c`, `0x12`, `0x20`, `0x2a`, `0x2c`, `0x44` and `0x46` of
other parts and field `0x0e` of their rope records. Walks that stop went from 287 to 241 in Even More and from 246 to
200 in TIM 1, and those walks now reach a branch with a known condition instead. No recording comparison changed.

### The scissors' rope cut

When the scissors close, their run routine calls a rope cut. It walks the parts list for ropes, tests each against the
cutting edge and splits a rope it crosses into two: the part factory makes a new rope and two rope ends, and the cut
relinks the parts and pulleys on the old rope. The reader checks the cut's complete instruction graph (eight compiler
forms over the eleven builds, all writing the same fields) and the summaries of the eight routines it calls.

On existing parts a cut can change only the rope and pulley links `0x5a`, `0x5c`, `0x66` and `0x68`, the list links
the insertion rewrites on the new piece's neighbours, and what the rope geometry update names. On the cut rope's own
record it changes the far end `0x04`, the slot byte `0x0b` and the two end points. It never changes a part's state, so
the scissors keep their frame. This needs four stated assumptions:

- A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or
  other storage, and releasing a piece that was never linked changes nothing else.
- A rope end's slot number, in bytes `0x0a` and `0x0b` of its rope record, is 0 or 1: one of the part's two rope
  links.
- Rope, belt and pulley records are allocations of their own and never overlap a part.
- The parts list and a pulley chain each end, without cycles.

In each recorded build 4 more recorded animations now match completely, 14 more walks end and 11 more end in every
branch.

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
cached and uncached fields on every potentially aliasing part, including byte reads of a written word. The reader
does not assume that the selected candidate differs from the analysed owner. These possible aliases are invalidated
after the ordinary summary stores so that unresolved store ordering cannot restore an old value. Complete query
footprints preserve unrelated fields. Incomplete footprints retain the existing broader nonstate invalidation.
Unknown-root effects remain ineligible for generic owner-only or list-loop promotion.

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
word damping; Even More can bypass that step when the owner's record field six is zero and has an additional type
59 coefficient exception. The two-part exchange uses a separation threshold of 512 in TIM 1 and 1024 in Even More.
Even More additionally suppresses one separation candidate when its signed absolute horizontal component exceeds
the vertical component, before the final control-mask override. These differences are retained in the relations.

The exchange also has a genuine normal-return requirement: the signed long sum of the two record weights must be
nonzero before division. Its ordered contract retains that gate and the field writes preceding it. Until the generic
caller analysis can compose this requirement, the exchange relation remains metadata-only and grants no caller
state-preservation shortcut. The resource wrapper's unresolved globals also remain explicit. Full numerical
relations live in the report's helper and dispatcher contracts; per-part descriptions refer to them by routine.
