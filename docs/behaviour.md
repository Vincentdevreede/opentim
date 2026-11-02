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
The limits are 12,000 decoded instructions per routine, 1,800 call-graph entries, 4,000 symbolic visits per callback,
800 per helper, and 96 expression-tree nodes. Exhaustion is a diagnostic and an unresolved result. These limits
bound browser work; they are not claims of completeness.

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

Creation analysis can use a zero state word only when the factory's cleared-allocation proof explicitly establishes
that word. It follows masked assignments and complete owner calls from that fact. Other unassigned fields remain
unknown, and the result still describes a fresh construction before level overrides rather than a loaded level's rest.

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
the recursion. The accumulated movement-conflict return remains unknown until its full graph predicate is described.

The part-graph footprint lists every possibly changed field on any connected part. Applying it invalidates cached
values and gives later uncached or overlapping reads a new symbolic field version. A protected owner field keeps its
previous version rather than reverting to the invocation input. Broader unknown calls supersede older field versions, while a state-preserving contract retains the owner's state
version. Partial stores also prevent old word guards from constraining the changed value. Explicit related-object writes remain in the report,
so a bounded field footprint cannot be promoted to an owner-only relation. General forwarder and list-scan proofs do
not consume this contract; counted loops check the bounded connection argument separately.

The frame graph can become larger when an earlier unresolved loop boundary is replaced with the actual state cases.
Unknown conflict-dependent conditions remain unresolved in that larger graph. Removing a call or loop diagnostic is
not proof of a complete animation. The full effect footprint, scalar return and state relation have separate claims.
