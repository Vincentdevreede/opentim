# Reading the report

## Reading the report

Every finding contains instruction addresses relative to the unpacked load image, original bytes, decoded text,
confidence and assumptions. A far address also retains its segment and offset. `checked` means a direct instruction
fact; `inferred` includes stated calling-convention or symbolic-analysis assumptions; `unresolved` asserts no
particular interpretation of an unknown value or effect. A transition that tests only values found during its run is
counted as conditional rather than unresolved (see [Conditional rules](helpers.md#conditional-rules)).

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

`extract-behaviour`, `list-assumptions`, `list-other-part-pairs` and `check-level-frames` read the builds side by
side, each on its own worker thread, and print what they find in the order the builds were given. By default they
read one build per core but one, as far as free memory allows (an Even More build takes up to 1.7 GB). `--jobs <n>`
sets how many at once; give `--jobs 1` to `extract-behaviour` when its times are to be compared, because a build read
next to others takes longer. Over all eleven builds `list-assumptions --check` takes about a minute instead of five.

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

### All eleven builds

Step F1 of the plan measures every supplied build the way the two recorded ones are measured: `extract-behaviour` and
`compare-behaviour --no-descriptions` over all eleven in one run each, `leaves.ts` (every walk must end),
`check-level-frames` and `list-assumptions --check`. Nine different executables: the TIM 1 English floppy and disk
image builds have the same `TIM.EXE`, and so do the two French Even More builds.

| Build                          | Executable | Parts | Unresolved transitions | Conditional | Unknown writes | Call-written values | Named run values | Vague effect lines | Unresolved resets | Resets the level gives | Without resting frames | Walks that end | Levels | Recordings               |
| ------------------------------ | ---------- | ----: | ---------------------: | ----------: | -------------: | ------------------: | ---------------: | -----------------: | ----------------: | ---------------------: | ---------------------: | -------------: | -----: | ------------------------ |
| TIM 1 English                  | `1d8702c4` |    51 |               0 of 764 |         122 |              0 |                 181 |               33 |                  0 |                 0 |                     36 |                      4 | 1,154 of 1,154 |     89 | none for this executable |
| TIM 1 English floppy           | `34c844ba` |    51 |               0 of 764 |         122 |              0 |                 181 |               33 |                  0 |                 0 |                     36 |                      4 | 1,154 of 1,154 |     89 | none for this executable |
| TIM 1 English disk image       | `34c844ba` |    51 |               0 of 764 |         122 |              0 |                 181 |               33 |                  0 |                 0 |                     36 |                      4 | 1,154 of 1,154 |     89 | none for this executable |
| TIM 1 French                   | `4a54cc37` |    51 |               0 of 764 |         122 |              0 |                 181 |               33 |                  0 |                 0 |                     36 |                      4 | 1,154 of 1,154 |     89 | 552 of 552 complete      |
| TIM 1 German                   | `8aec613a` |    51 |               0 of 764 |         122 |              0 |                 181 |               33 |                  0 |                 0 |                     36 |                      4 | 1,154 of 1,154 |     89 | none for this executable |
| Even More English floppy       | `b11cf18e` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |    163 | 648 of 648 complete      |
| Even More English CD           | `2557edb3` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |    172 | 644 of 644 complete      |
| Even More English demo         | `605e9c0a` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |     12 | none for this executable |
| Even More French               | `9b15a150` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |    163 | none for this executable |
| Even More French (with German) | `9b15a150` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |    163 | none for this executable |
| Even More German               | `9cad1156` |    63 |               0 of 925 |         128 |              0 |                 193 |               41 |                  0 |                 0 |                     41 |                      5 | 1,338 of 1,338 |    163 | none for this executable |

The two recorded builds: in Even More 456 recordings match from the reset or a resting frame, 1 from creation, 135 from
an input case, 2 from a seeded state, 38 through the recorder's fields and 16 through a search the recorder skipped; in
TIM 1 it is 364, 1, 135, 2, 38 and 12. None is a prefix and none differs. Every build has 0 unresolved call sites, 0
pointer losses and 0 loop gaps, and the same callbacks (158 routines in Even More, 135 in TIM 1). Every shipped level
(1,281 files) agrees with the description, and all 267 assumptions are listed. The rules with run values were split
later (see [values a call writes but nobody follows](ropes-belts-pulleys.md#values-a-call-writes-but-nobody-follows)): that split is measured
on all eleven builds and gives the same counts within each game.

Only two executables have recordings, so the others were also compared with the recordings of their own game, as a
check of the description and not as proof about that executable. The French and German builds of both games match
every recording, like the recorded ones. The Even More CD and demo builds and the English TIM 1 builds match all but
the recordings that need a search the recorder skipped (16 and 12): the recording names that search by its address in
the recorded executable, and in these builds the search sits elsewhere, so those walks stop where the search is and
count as prefixes. None differs.

The Even More CD build was recorded later, on 2026-11-07, so that its skipped searches are checked at its own
addresses. The recorder is Sprite Lab v25's `research/v24/verify_animations.py`, run unchanged except for what it
knows about the build:

- The CD's callbacks, data segment (`0x32f7`) and type table (`0x30900`) come from its own `TIM.EXE`; the frames and
  sizes of the parts come from the floppy's model, and `extract-parts` gives the same 63 parts for both builds.
- The recorder runs only code in the floppy's part segment `0x190f` and returns 0 from every other call. The CD gives
  each part's code its own segment, so the rule becomes the stretch of the image that holds that segment's code: the
  floppy's segment runs from `0x190f0` to `0x1ee50`, and in the CD the same 185 routines lie from `0x190c0` to
  `0x1eb40`. 103 of them match one routine by their first bytes in both directions and none lies outside; the others
  start with bytes that occur more than once.
- Run the same way on the floppy, with its own stretch, the recorder gives the floppy's recording exactly (all 34 parts
  it covers; the bowling ball's entry comes from a separate static check).

The CD recording has the same 644 clips as the floppy's, with the same frames in every clip; only the addresses of the
callbacks and of the skipped searches differ. Against it, every CD walk is complete: 644 of 644, 68 of them through
the recorder's fields and 16 through a search the recorder skipped, the same counts as the floppy. The 16 prefixes
above are gone for the CD; the demo and the English TIM 1 builds still have no recording of their own.

What differs between the builds, and why it doesn't change a part:

- The code is laid out differently. The CD build keeps far calls as far calls and spreads its code over 81 segments
  where the floppy has 36 (see [the release wrapper](helpers.md#the-release-wrapper-in-the-even-more-cd-build)); the demo's
  engine is smaller (44 fewer routines read, 5 fewer that call an interrupt). So the analysis reads more or fewer
  engine routines: Even More 889 (floppy), 940 (CD), 845 (demo), 886 (French and German); TIM 1 830 (English) and 832
  (French and German). The part callbacks and every count in the table are the same.
- Globals and data tables sit at other addresses. A rule that reads a global (a brick wall's test of a value in the
  data segment, for example) reads it at another offset in another build, and nothing in one build says which global
  of another it is. The build comparison numbers each part's globals in the order its findings use them ("global 1"
  is the first), so two builds compare equal when they use their globals in the same places. Which global it is in
  each build stays out of the comparison.
- The same value comes out written another way where the code is laid out differently, and the comparison writes each
  one way (`behaviour-build-comparison.ts`):
  - a choice is compared as its cases, each with the tests it takes and the value it gives, and two cases with the
    same value that differ in one test taken both ways are one case. The cat's rules in the Even More CD build test
    their conditions in another order;
  - two findings that are the same but for one test, taken one way in one and the other way in the other, are one
    finding without that test. The CD build's vacuum cleaner tests whether its frame changed and then draws the same
    either way;
  - a chain of `+`, `*`, `&`, `|` or `^` is compared flat with its terms sorted, and two shifts by numbers as one
    shift (the teeter-totter's reset tables in TIM 1 French and German shift twice by 1 where English shifts by 2);
  - the code address of a call is left out, like the other addresses.
- The names of run values carry the address of the query or search that gives them (for example "answer of the query
  at 0x1d2af"). The build comparison now leaves those addresses out, like the addresses in other names.
- In the CD build the dynamite plunger's rules write a choice with its two ways in the other order (what the new part
  gets when the allocation fails or succeeds, and the plunger's control value). The build comparison now puts the two
  sides of `+`, `*`, `&`, `|` and `^` in a fixed order.
- The demo has the same 63 part types as the full game but only 12 levels; the CD build has 172 levels, 9 more than
  the floppy.

With these, the comparison of builds within each game finds no difference at all, in what the analysis resolves and
in what it leaves unresolved: 0 differences over all eleven builds (on 2026-11-07; before, 19 parts differed in
unresolved findings in TIM 1 French and German, 27 in the Even More demo, 8 in the CD and 6 in the French and German
Even More builds). Every part has the same counts of rules of each kind, the same resting frames, the same reset kind
and the same number of walks in every build of its game. The comparison takes about a minute longer for all eleven
builds.

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
