# Helpers and values only the run knows

## Exact helper stores

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

## Helper paths through calls

The reader that follows every path of a small helper exactly (`ownerPathStores`, above) gave up on any helper with a
call. It now follows a call when the callee's summary changes no
part: a complete footprint whose writes are all globals, like a redraw request or a sound. After such a call it
forgets the scratch registers AX, BX, CX, DX and ES, and keeps the part's fields, the owner register, the frame and
its locals, by the C calling convention the analysis already assumes. A call through a pointer, or to a callee
without such a summary, still stops it.

The vacuum cleaner's pull (`0x1e8bb` in Even More, English floppy) is the first helper this reads. It tests its part's
type: a balloon (type 4) gets control value 1, so it pops; every other part gets `0x2000` set in its drawing flags and
`0x0100` in field `0x0a`, with a sound for the mouse (type 42). Before, the reader kept those three stores without
conditions, so a caller only knew that they might happen.

## The outline search

The teeter-totter finds the parts lying on it with an outline search. It clears the owner's found list at `0x78`,
walks the parts lists its caller's mask allows, tests every edge of each part's outline against a shape the caller
gives, and puts each part with a crossing edge at the front of the list. The reader checks its complete instruction
graph (three compiler forms over the eleven builds) and its list helpers. Unlike the other overlap queries it does not
skip the owner, so the list may hold the teeter-totter itself.

A loop over such a list is still proved, with two extra rules. The body may never write a listed part's state, and
every other field it writes on a listed part counts as a possible write to the owner too. The teeter-totter keeps its
frame, and forgets the positions it writes on the parts lying on it. Its assumptions are listed in
[the decided assumptions](../../assumptions/behaviour-assumptions.md). In each recorded build this removes 24
unresolved transitions and 9 more walks end.

## Find-first loops

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

## Query answers

After the cat moves 32 pixels, it calls the routine at `0x4a36` (Even More, English floppy) and tests its answer: when
the new spot is blocked, it moves back and tries the other way. That routine is a `private-buffer-query`: it reads its
inputs and writes nothing but its own stack, so all a call gives back is one word in AX. That answer depends on where
the other parts are, so the analysis can't know it, but it is one value. The reader now names it `answer of the query
at` the call's address, as an unresolved field, instead of an opaque unknown. A condition on it can then be decided as
a value of that run, like the result of a contact scan, and the walks can branch on it: blocked or free. It never
becomes an address. Other helpers' results stay opaque.

The cat's run rules no longer contain an opaque unknown, so their walks don't stop there any more.

## Answers that lead to the same frame

When both answers of a test lead to the same next frame, the reader joins the two rules into one without that test
(see [Descriptions and conditional frame walks](walks.md#descriptions-and-conditional-frame-walks)). A rule is unresolved when
its condition or its next frame holds a value the analysis doesn't know, like a query's answer. If that answer was the
only such value and the joined rule no longer tests it, the frame path no longer depends on it, so the joined rule is
no longer unresolved. This needs every path of the routine to have known effects: a path that lost track of a write
could have made the rule unresolved for another reason, and then the rule stays unresolved. A field the two answers
write differently keeps both values, chosen by the answer (see [Values two paths set differently](#values-two-paths-set-differently)).

The teeter-totter's bounce asks a query and its rope callback asks along the rope; their frame does not depend on the
answers. In each recorded build its unresolved transitions go from 15 to 6, and no walk changes.

## Values two paths set differently

Two return paths that lead to the same frame and differ only in one test and its opposite are joined into one rule.
When they write a field differently, the joined rule used to call the field unknown ("differs on complementary
paths"), although both values were known. It now keeps both: the field is `(test) * a + (opposite) * b`, with each
test 0 or 1, the same form the drawing fields already had. Exactly one of the two tests holds, so the value is exact.
This works for every comparison: the values compare as unsigned numbers, so a signed test (`jl`, `jg` and the like)
compares both sides with their sign bit turned round, which orders them the same way. A value or a side of the test
that is unknown keeps the joined value unknown, with that value's own reason. `choiceOf` gives the test and the two
values back; the lab shows such a value as "3 if test, else 5". A walk works the value out when it knows the fields
the test reads, and otherwise forgets it, as it did with the unknown value. A rule whose paths split on a countdown
is still taken apart into its paths, as in [Countdowns](walks.md#countdowns).

Rules that write an unknown value go from 365 to 247 of 925 in Even More, English floppy, and from 324 to 223 of 764
in TIM 1, French. No write is unknown only because of the join any more: what is left is unknown for its own reason,
like a related part a helper may change or a field after a list scan. In 4 rules of the teeter-totter in each build
both values are known but a query's answer picks one, so they still count. Every walk still ends and no recording
comparison changes; the rocket's walks from frames 0 and 7 now know its field `0x84` after frame 7, so they repeat one
cycle later, with the same frames.

When the walk can't decide the test, it now keeps the bits both values agree on, and when it can decide the test it
takes the value the test picks even if the other one is unknown. Exactly one of the two tests holds, so both are exact.
The monkey bike shows why it matters: when its reaction on frames 9 to 12 runs out, its run (`0x1be07` in Even More,
English floppy) sets the control value to -1 when the bike is flipped and to 1 otherwise. The walk doesn't know the
flip, so it used to forget the control value and then split on "the control value is 0" at frame 1, with one way that
stood still for good. Both -1 and 1 have bit 0 set, so the value isn't 0, and the walk after a hit while pedalling now
pedals on (frames 1 to 4) in each branch. Only the monkey bike's walks change, in both recorded builds: walks that end
through branches go from 696 to 695 and walks that end directly from 629 to 630 in Even More (TIM 1 625 to 624 and 521
to 522). The recordings don't change (616 and 520 complete, none different).

## Conditional rules

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

## Parts linked into an ordered list

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

## Fields a helper sets on every way

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

## A small helper's table reads

The reader of a small helper's exact stores (`ownerPathStores`, the one that gives the gear's push its exact value)
now also follows a word or byte read from the data segment at an index it knows, a shift left by a number, and the
byte halves of the word registers (a byte write forgets the word, a word write forgets both halves). Such a read is a
table read, as in the routine analysis. This gives the light bulb's helper `0x1bbef` (Even More, English floppy) its
values: it sets `0x6a` and `0x6b` to the bytes at `0x2f3c` and `0x2f3e` of the data segment, four bytes per frame,
indexed by the frame. Before, it called both "the value stored requires symbolic analysis". The two light bulb rules
that call it now write known values: Even More goes from 7 to 5 rules with unknown writes, TIM 1, French, from 5 to 3.
No other helper changes.

## Helper stores made exactly when their tests hold

A small helper's store gets the tests that lead to it in two ways: `ownerStoreConditions`, when every way through the
store passes the tests, it is the last store to its field there, and every way that passes them goes through it; and
`ownerPathStores`, when every way is read exactly. Either way the field ends with the stored value exactly when the
tests hold, and two stores to one field never both have their tests hold. These stores are now marked `exact`, so a
caller gives the field the stored value when the tests hold and its old value otherwise, instead of an unknown. A
caller used to do that only for a single test; it now also does it for several tests together (`choose` nested over
them).

This names the mouse motor's control value after its start (`0x1c074` in Even More, English floppy): 1, or -1 when the
motor is flipped. Even More goes from 5 to 4 rules with unknown writes; TIM 1, French, from 3 to 2.

## Large values a caller takes from a helper

When a caller takes a helper's ways one by one, it puts the part's fields as it holds them into each value the helper
leaves. Those values used to be cut off at the usual expression budget (96 nodes), which a drawing position the frame
drawing helper set is larger than, so the field became "Unresolved operand in +". They now get the budget the frame
drawing helper's own values get. This gives the fish bowl's run (`0x1ad0e` in Even More, English floppy) the drawing
position `0x2a` and `0x2c` its helper `0x1ad71` sets when it moves the bowl to frame 11. Even More goes from 4 to 3
rules with unknown writes; no other rule changes. TIM 1, French, goes from 2 to 1 (its fish bowl).

## The speed setter's velocity

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

## Calls in a small helper read exactly

The exact reader of a small helper (`ownerPathStores`) used to give up on any helper with a call. It now reads past a
call that leaves the part alone (the same test `ownerStoreConditions` uses: the callee's footprint is complete for part
memory and it writes only globals), and forgets the registers a C call may change (`ax`, `bx`, `cx`, `dx`, `es` and
their halves). This gives the vacuum cleaner's helper `0x1e8bb` (Even More, English floppy) its stores on the part it
pulls in: a balloon (type 4) gets control value 1, any other part flag `0x2000` of its drawing flags and flag `0x100`
of field `0x0a`, whatever the screen queue and sound calls in between do. Before, its writes had no condition ("This
footprint retains writes without selecting a control-flow path"). Even More goes from 2 to 1 rules with unknown writes.
No other helper changes.

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
callback; [the rope connection query](ropes-belts-pulleys.md#the-rope-connection-query) bounds what those callbacks may change.

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
