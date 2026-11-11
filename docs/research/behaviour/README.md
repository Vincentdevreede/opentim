# Static behaviour from TIM.EXE

The content reader decodes TIM 1 and Even More code without running the program. The library has no Node APIs or
third-party decoder. It does not use Unicorn, a CPU interpreter, game objects, or v25 callback implementations.

`readBehaviour(program, parts)` accepts the original packed executable and the result of `readProgramParts`. It
checks that the raw records belong to the same image, discovers the callback dispatch and the field used to index
the checked frame-position array, and rejects missing structural evidence. No build-specific code address is used.
The existing part lists are unchanged. The lab runs the analysis in a worker after an import with `TIM.EXE`, which
takes a few seconds, and shows a summary of each part in the Behaviour tab of the Sprites page.

The research is split by topic:

- [Reading the report](reading-the-report.md): what a report holds, the analysis limits, extracting and validating, findings per build, saved evidence.
- [In the Lab](in-the-lab.md): the Behaviour and Interactions tabs, the words they use, the flag bits, the background read.
- [Descriptions and walks](walks.md): descriptions and conditional frame walks, branches, frames a state allows, countdowns.
- [Walks against the recordings](recordings.md): the recorder and how walks are compared with what it saw.
- [Ropes, belts and pulleys](ropes-belts-pulleys.md): the rope connection query, the scissors, relays, writes through ropes and belts.
- [What parts do to each other](other-parts.md): what parts do to each other: effects, hits, touches, searches, the pairs.
- [Helpers and values only the run knows](helpers.md): helper stores, query answers, conditional rules, constructors, overlap candidates, fresh lists.
- [Frames, outlines and resets](frames-and-resets.md): outlines, resets, starting frames, drawing, parts a part makes, speed limits, sheet frames.
- [Gears](gears.md): the gear relation, scheduling, drivers and connections.
- [Contact](contact.md): contact searches, callbacks and responses.
