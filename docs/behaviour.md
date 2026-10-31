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
and locals. Losing the pointer produces an unresolved write. Related pointers remain conditional aliases. The
C calling convention assumption preserves SI, DI, BP and DS across calls; volatile results are discarded.

Static callee summaries are applied only when the caller demonstrably passes the part pointer. Conditional effects
are forgotten rather than selected with a fabricated object. Unknown calls invalidate cached object fields. Near
helper arguments are distinguished from far helper arguments by their return instructions. Unresolved aliasing and
callee effects remain visible in both the routine and its graph.

Acyclic paths are analysed separately. Dense switches require an unsigned bounds check and a scaled code-table
index. Sparse switches require a bounded key search, comparison and parallel target table; the proved search is
summarised directly as cases and a default. Other back edges require a loop invariant and become unknown exits.
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

The exact-hash oracle run covers 644 Even More clips and 548 TIM 1 French clips. It explains 1,310 and 1,102
changed-state steps respectively with inferred assumptions; another 1,238 and 658 remain unresolved. None is missing
from the graph because boundary edges explicitly retain unknown outcomes. This is partial coverage, not a proof of
all recorded walks. Of 200 unchanged steps, 24 have inferred preserving paths and 176 remain unresolved.
