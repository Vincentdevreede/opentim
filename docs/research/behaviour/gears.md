# Gears

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
