# Ropes, belts and pulleys

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
to recheck it in [the decided assumptions](../../assumptions/behaviour-assumptions.md):

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
two assumptions were dropped (see [the decided assumptions](../../assumptions/behaviour-assumptions.md#1-ropes)).

After the call, each asking field of the caller's own part holds one value it can't know: what the field holds right
after that query, named `part after the query at` the call's address. Like a query's answer, it is a value of that
run, and it never becomes an address. When the teeter-totter asks for real (`0x1d2d1`, Even More, English floppy), its
run then adds that control value to its frame. The walk can't know the number, but it is still the teeter-totter's
own control value, so [the decided control values](../../assumptions/behaviour-assumptions.md#9-control-values) hold for it: -1, 0 or 1.
The walk follows each of them as its own branch of that same run, with the number put into the run's rules. The
number belongs to that run only: the branch knows the control value it leaves, but the next run's query gives a new
value, which is branched on again. Since the run adds the value to the frame it started the run on, the teeter-totter
is on that frame with that value, so a number that would tip it past an end
([the teeter-totter's ends](../../assumptions/behaviour-assumptions.md#10-the-teeter-totters-ends)) isn't followed.

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
[the decided assumptions](../../assumptions/behaviour-assumptions.md):

- A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or
  other storage, and releasing a piece that was never linked changes nothing else.
- A rope end's slot number, in bytes `0x0a` and `0x0b` of its rope record, is 0 or 1: one of the part's two rope
  links.
- Rope, belt and pulley records are allocations of their own and never overlap a part.
- The parts list and a pulley chain each end, without cycles.

In each recorded build 4 more recorded animations now match completely, 14 more walks end and 11 more end in every
branch.

## Found lists and parts reached through ropes

A search or a rope, belt or pulley helper writes parts that only the running game picks: the parts a search finds,
the parts at the other end of a rope. Those writes used to be anonymous unknowns ("A selected related object may
change this field", "Conditional overlap-list effect on field 0x78"). Each value is now named after the call that
gives it, with the existing expression form of a field marked `unresolved`, so every traversal reads it as before
and a walk still forgets it. A name for a field of a found or selected part is that part's value, so two parts one
search finds can hold different values under the same name. Every other name is one value within a run: no path
passes the same call twice.

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
at least one of those. The extraction notes and the comparison table show both. That second group says more than
it shows: most of its names only say that a call may have written the field, see
[values a call writes but nobody follows](#values-a-call-writes-but-nobody-follows).

Measured by the new rule, rules with unknown writes go from 242 to 33 of 925 in Even More, English floppy, and from
218 to 28 of 764 in TIM 1, French; rules with named run values go from 5 to 214 and from 5 to 195. The relay's owner
byte is now known in 37 rules of Even More and 33 of TIM 1. Every walk still ends and the recordings stay at 596 complete, 52 prefix
and 0 different (Even More) and 504, 48, 0 (TIM 1). What is left unknown is a helper's conditional effect without an
exact condition (the contact speed limit, owner field relations), the order a created object takes in a sorted list,
and a few values the symbolic budget gives up on.

## Values a call writes but nobody follows

A review found that the named run values say more than they show. A value named `value the call at` an address
`writes to a selected part`, or `part after field effect at` a call, only says that the call may write the field and
where; what it writes isn't followed. That tells no more than the unknown it replaced. In Even More, English floppy,
193 of the 234 rules counted as named hold such a name, and 181 of 214 in TIM 1, French.

`transitionCounts` now splits these rules in three, and the extraction notes, the comparison's summary line and its
table show all three:

- **Rules with unknown writes** (`unknownWrites`), as before: they write a value nobody named.
- **Rules with call-written values** (`callWritten`): no unknown, but at least one value only says that a call, a
  query or a list scan may have written the field (the names in `CALL_WRITTEN`: what a call writes to a part it
  selects, what a query writes to a part it finds besides the list link, the owner's field after such a call, after a
  list scan or after a question that comes back, and another part's field after a list scan).
- **Rules with named run values** (`namedRunValues`): every value is known or a run value whose identity is known (a
  query's answer, a part a loop or a list scan found, a search's found list and the next part in it, the list links
  after an ordered insertion, the centre angle answer), and at least one is such a run value. A rule that writes both
  kinds counts as call-written.

The relay's byte is an exact value, not a run value, so it is in neither group. Nothing about the rules changed, only
how they are counted. Even More: 0 with unknown writes, 193 with call-written values and 41 with named run values of
925; TIM 1: 0, 181 and 33 of 764. Every walk still ends (1,391 and 1,207) and the recordings stay at 648 and 552
complete, none different.

## The owner's rope fields after the relay

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

The user decided both on 2026-11-06:
[decided assumption 19](../../assumptions/behaviour-assumptions.md#19-parts-that-hold-a-rope-record), only a rope piece or a pulley ever
holds a rope record, and [decided assumption 20](../../assumptions/behaviour-assumptions.md#20-flipping-a-part-with-a-loose-belt-end), in
the editor a part is never flipped while one end of its belt is still loose. The reader (`addRelayOwnerKeeps`) now
records, for each routine that calls the relay, which of the owner's fields it keeps:

- The rope ends `0x96` and `0x9c`, when the routine is named directly by the type table, nothing else calls it, and none
  of the types that name it is the rope or the pulley. The relay summary says which part fields come only from the
  rope geometry update (`ropeHolderFields`).
- The links `0x5a` to `0x60`, `0x6a` and `0x6c`, when the routine is moreover named only as a flip callback. The relay
  summary says which part fields come only from the belt end check (`beltEndFields`).

Every part callback that calls the relay passes both tests in all eleven builds (27 types in Even More, 23 in TIM 1,
all flip callbacks). The relay has other callers that the type table doesn't name (eleven in Even More, English
floppy); they keep nothing, and the analysis doesn't walk them. Assumption 20 concerns flipping a part in the editor; it
says nothing about the machine running. Parts the relay reaches, other than the owner, still forget these fields.

## The magnifying glass's last call

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

The wrapper also passes the byte 1 to `0x65c1` (`mov ax, 1; push ax` right before it pushes the part). A field a
helper writes exactly, as a value of its part and of a number the wrapper passes this way, now carries over with its
value and its test instead of becoming "Conditional state-preserving-forwarder effect". So the magnifying glass's
`0x14` after the call is 1 unless its type is 49, which it isn't: the relay's byte, as in
[Found lists and parts reached through ropes](#found-lists-and-parts-reached-through-ropes). That was the last rule
with an unknown write in both measured builds: Even More, English floppy, goes from 1 to 0, TIM 1, French, from 1 to 0.

Such a write carries over only from a call the wrapper makes on every way to its return, and only once (no way leads
from the call back to it). A call the wrapper makes behind its own test, like `0x793f` in Even More calling `0x70fb`
only when the type isn't 0x31, would otherwise give the caller the helper's test without the wrapper's. It also
carries over only when no other call of the wrapper writes the same field, and no call that may come before it writes
a field its value or test reads: the helper's test is of the part as the helper gets it, which is then the part as
the wrapper got it. Every exact write that carries over today comes from a first call made on every way (`0x65c1`,
`0x58f3`, `0x5924`, `0xec49`, `0x6623`), so nothing changes in the measured builds.

## Writes on parts reached through ropes and belts

A callback that calls a rope, belt or pulley helper with a summary (see "The byte relay" above) forgets the fields
the summary names on every part, since the part reached can be the owner. Those writes used to show as "Updates
another part's part-specific field". They now say what the summary proves the helper may change: field `0x14` (the
value the relay passes along), the rope links `0x5a` to `0x60`, `0x6a` and `0x6c` (turning a rope round) and the rope
end words `0x96` and `0x9c`, each on "a part its ropes, belt or pulleys reach (this part too)". The flips of the eye
hook, the wood incline and the curved pipe wall, among others, show these three lines.

Two more kinds of writes got plain lines. A write through a part's belt link `0x54` or rope links `0x66` and `0x68`
goes to a belt or rope record, not a part: the birdcage's, bucket's and heart's rope callbacks "Add 1 to field 0x0e
of the record of its rope at 0x66" when asked with mode 1. A bounce callback's writes to its argument go to the part
that touched its owner (see [walks from parts that touch](other-parts.md#walks-from-parts-that-touch)): "Selects state 9 on the
touching part" instead of "on another part". And an overlap query's writes to the parts it finds say "Links a part its
search finds into its found list (field 0x78)" and "May change field 0x7a of a part its search finds". Writes to an
object the routine allocates itself said "Sets field 0x1e of the object it creates at 0x19ba8", without claiming the
object is a part; see [parts a part makes](frames-and-resets.md#parts-a-part-makes) for what they say now.

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
