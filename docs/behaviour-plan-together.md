# Part behaviour: parts working together

The previous plan (`docs/behaviour-plan.md`, merged in PR #19) describes each part on its own: every walk ends, every
recording matches. This plan is about what that leaves out: what parts do to each other where it depends on where they
are, and a model of the whole machine that runs a level's parts together. Each step gets a short done note when it is
done; the details go in `docs/behaviour.md`. Work happens on `feature/behaviour-together`.

## Questions for you

1. **What should this phase deliver first?** The two halves can go in either order:
   - finish describing what parts do to each other (the missing pairs in A), so the Behaviour tab says, for example,
     "a fan blows a balloon within 64 pixels in front of it, harder the closer it is";
   - or start the machine itself (B and C): load a level, run its parts step by step with the rules found so far, and
     compare that with the game.

   My suggestion is A first. Its steps are smaller, each one makes the descriptions the machine needs, and the
   machine in B then uses them instead of guessing.

2. **May I record whole levels from the game?** The recorder so far runs one part alone. To check a machine, I would
   extend it to run the game's own step loop from TIM.EXE on a shipped level and save every part's frame and position
   after each step. Like the part recorder, it runs only the game's code, with nothing from other projects. It is the
   only way to check B without you playing every level by hand.
3. **Which machines first?** I'd start with machines that don't need falling and bouncing: a motor turning a gear
   train, a belt from a motor to a conveyor belt, a rope over a pulley pulling a teeter-totter, and a switch that
   starts a fan. Do you have levels in mind that show these well, or shall I pick shipped levels with the fewest
   parts that use them?

## The starting point

From `list-other-part-pairs` on Even More (English floppy) and TIM 1 (French), on 758726e:

|                                   | Even More | TIM 1 |
| --------------------------------- | --------: | ----: |
| Pairs of parts the code lets meet |     1,090 |   621 |
| Described                         |       227 |   135 |
| Partly described                  |        46 |    17 |
| Ruled out (they can never meet)   |       570 |   345 |
| Missing                           |       247 |   124 |

Why the missing ones are missing (a pair can have several reasons):

| Reason                                                  | Even More pairs | From                                     | TIM 1 pairs |
| ------------------------------------------------------- | --------------: | ---------------------------------------- | ----------: |
| A test of where the part is, compared with the source   |             128 | teeter-totter, vacuum cleaner (63 each)  |          52 |
| A path through the source's code that isn't read yet    |             128 | teeter-totter, vacuum cleaner, fan, cat  |          52 |
| A table word picked by an angle or a distance           |             105 | fan (61), bellows and teapot (22 each)   |          65 |
| A value the analysis doesn't know                       |              67 | teeter-totter (63), explosion, fan, jack |          55 |
| A value from the source's own place                     |               5 | alligator, jack-in-the-box               |           2 |
| A speed whose direction depends on where both parts are |               3 | explosion, pinball bumper                |           0 |
| A contact response after the bounce                     |               1 | conveyor belt                            |           1 |

## A. What parts do to each other, where it depends on where they are

- [x] **A1. Tables picked by angle or distance.** The word they read was the found part's speed limit, not a table
      of their own. The push itself is a formula now: the analysis reads the compiler's 32-bit multiply and division,
      and names the overlap the search stores. The fan adds ±16 × (256 − |overlapX|) ÷ mass to velocityX, the bellows
      ±8, the teapot pushes by 1536 or 1024; all kept within the part's speed limit. Missing pairs: Even More 247 → 145,
      TIM 1 124 → 59. See "The fan, the bellows and the teapot push what they find".
- [ ] **A2. Where a part must be for the vacuum cleaner and the teeter-totter.** Their searches test a box around the
      source, like the teeter-totter's ends did in the last plan (C3). Say the box in pixels from the source, named
      by what it is where the code shows it ("in front of the nozzle", "above the left end"). Done when no pair is
      missing for a test of where the part is.
      Found so far: the vacuum cleaner's 1,148 ways on what it finds are 760 unresolved because their values outgrow
      what the analysis keeps, not because the code isn't read. Its helpers are plain: `0x1e84e` gives the pull from
      the found part's mass (below 2: 0x0C00, below 6: 0x0A00, below 10: 0x0800, below 21: 0x0600, below 121: 0x0400,
      below 151: 0x0200, below 201: 0x0100, else 0x0080), and `0x1e8bb` swallows a part at the nozzle (a balloon
      pops, the mouse and every other part go out of play with goal mark 0x0100, the mouse with sound 13). The pull
      is written as a sum over its seven mass tests, so the mass word appears seven times before the multiply, the
      clips and the conditional writes repeat it again. For a known type the mass is a number and all of it folds.
      Tried and changed nothing: a compact clip for the speed limit, size limits of 256, 1024 and 4096, more room for
      the 32-bit helpers, and keeping the pull as one table read with its ranges (the paths then stopped joining and the
      report grew past what can be written). Of the 760, 288 have an unknown velocityX and 472 read velocityY after an
      unresolved write at 0x1e721 (`sub [di+0x38], ax`, the pull times overlapY). Next: keep a
      helper's answer that depends only on the found part's type as one value until the type is known, and fold it
      for each type in the line and the pair check.
      Per type (2026-11-07, patch in `~/.cache/opentim-behaviour/patches/per-type-loops.patch`): reading the loops
      again for each type a found part can have, with its type field and the type record words the game never writes
      as numbers, resolves many more ways (vacuum cleaner 6,152 of 17,928, teeter-totter 8,712 of 15,048, fan 1,048 of
      1,064; the cat none of 284). But it takes 315 seconds per build instead of 15, and the report gets too large to
      write. Agreed with you on 2026-11-07: do it, fast first, and in the Lab never in the way (read after the rest,
      like the walks). Grouping types by the type record words a loop reads saves little (vacuum cleaner 44 groups,
      teeter-totter 45, of 66 types; the cat 3, the fan 21). Next: keep only the resolved ways per type with their
      evidence trimmed, measure size and time, then make each run cheaper.
      Done in the patch (updated 2026-11-07): only resolved ways per type, evidence trimmed to 8 instructions; the
      lines and the pair check use a loop's per-type ways for that type in place of the generic ones, read the overlap
      in tests too, and take the speed limit read at a known type's record as the part's own. Even More report 775 MB
      (was 427), 5 minutes per build; pairs 144 missing (was 145), the fan unchanged at 61 described. The vacuum
      cleaner and the teeter-totter stay missing: their resolved ways test where the found part lies from the source
      (a test reading both parts), which the pair check allows only for list consumers. Next: allow and word such place
      tests for overlap searches too (as C3 did for the teeter-totter's ends), then make the per-type reading fast and
      move it after the rest in the Lab.
- [ ] **A3. The paths that aren't read.** Read the teeter-totter's and the vacuum cleaner's list paths, the fan's and
      the cat's: each one is either read, or says which instruction stops it and why.
- [ ] **A4. The values the analysis doesn't know.** The teeter-totter's launch speed, the explosion's split of a wall,
      the fan's and the jack-in-the-box's last ones. Name each one, like the run values in the last plan, or give its
      formula from the source's fields.
- [ ] **A5. The few left.** The alligator's and jack-in-the-box's values from their own place, the explosion's and
      pinball bumper's direction, the conveyor belt's contact response.
- [ ] **A6. The Behaviour tab.** "From other parts" shows the place a part must be in and the table values, readable
      at a glance. Checked in a browser on the fan, the vacuum cleaner and the teeter-totter.

## B. The machine

- [ ] **B1. A level in a world.** Load a shipped level into `packages/engine`: every part with its place, frame and
      flags, and the ropes, belts, pulleys and plugs between them, from the level reader that already exists.
- [ ] **B2. One step as the game takes it.** The order the game runs things in one step, from TIM.EXE: the run loop,
      the gear scheduling, the relay along belts and ropes, the contact searches. The analysis already proved most of
      these one by one; this puts them in the order the step loop calls them.
- [ ] **B3. Connections without motion.** Gears, belts, ropes and plugs: a motor turning a gear train, a belt driving a
      conveyor belt, a switch powering a fan. These need no falling or bouncing, so they can be checked first.
- [ ] **B4. Contacts and searches.** What a part finds or touches each step, using the places from A2.
- [ ] **B5. Motion.** Speed, the speed limit, gravity and the collision responses, from the routines the analysis has
      read (the speed setter, the contact responses).
- [ ] **B6. The Lab.** A way to step a level and see every part's frame and place, next to the game's recording when
      there is one.

## C. Checking the machine

- [ ] **C1. A level recorder** (needs your answer to question 2). Run the game's own step loop in the emulator on a
      shipped level, and save every part's frame, place and speed after each step.
- [ ] **C2. Machines without motion first.** Compare B3 with the recordings of the levels from question 3.
- [ ] **C3. Then with motion.** Compare B4 and B5, level by level, and keep a list of where they part and why.

## D. Close

- [ ] **D1. Docs, numbers and PR text**, shown to you before the PR is opened.
