# Contact

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
scanner additionally excludes four unordered type pairs through its checked scalar filter. TIM 1's scanner has no such
call, but it tests the types itself: a subject of type 12 skips a candidate of type 42, in that order only. The
remaining first candidate filter is retained as a read-only helper result.

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
