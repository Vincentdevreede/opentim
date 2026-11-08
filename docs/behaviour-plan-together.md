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

   Answered: A first.

2. **May I record whole levels from the game?** The recorder so far runs one part alone. To check a machine, I would
   extend it to run the game's own step loop from TIM.EXE on a shipped level and save every part's frame and position
   after each step. Like the part recorder, it runs only the game's code, with nothing from other projects. It is the
   only way to check B without you playing every level by hand.

   Answered (2026-11-08): yes.

3. **May the teeter-totter's search count as finding only moving parts?** It looks only among the parts in the game's
   list the flag 0x1000 picks (`0x682f` gives the list at `0x4d7d` for it). The assumption you approved says a part
   of a fixed type, like a brick wall, is never on the moving list, but the analysis knows the moving list only as the
   flag 0x1000 in a part's field 0x06, and the gun puts its bullets in the list of moving parts without that flag. To
   rule out the teeter-totter launching a brick wall, I'd take the list at `0x4d7d` as that moving list: a fixed
   part is never in it, a bullet can be. That is a new game assumption, so it needs your yes.

   Answered (2026-11-08): yes for now, to be checked again later. It is [decided assumption
   22](behaviour-assumptions.md#22-searches-of-the-moving-list), and covers every search that walks only the moving
   list, not just the teeter-totter's.

   Checked in the game's own run (2026-11-08): all 160 Even More and 87 TIM 1 puzzles, 500 steps each, never have a
   part of a fixed type on the moving list; only bullets, pinballs and rope ends join it during a run. The run also
   found explosions, which aren't of a fixed type, on the fixed list, which matters for the alligator (question 5).

4. **Which machines first?** I'd start with machines that don't need falling and bouncing: a motor turning a gear
   train, a belt from a motor to a conveyor belt, a rope over a pulley pulling a teeter-totter, and a switch that
   starts a fan. Do you have levels in mind that show these well, or shall I pick shipped levels with the fewest
   parts that use them?

   Answered (2026-11-08): pick them myself.

5. **Can a part of a type that isn't fixed be on the fixed list?** The alligator's search walks only the fixed list
   (it passes `0x2000`). The game puts a dropped part there only when its type is fixed, and no shipped level stores
   one of another type among its fixed parts (apart from type 55 in each Even More title level, which its constructor
   makes fixed). If you agree that it never happens, the alligator's search would find only fixed parts, like the
   electric switch, and never a ball. Until then the analysis lets it find any part.

   Found (2026-11-08): it does happen. The two routines that make an explosion link it into the fixed list, and the
   game's own runs of the shipped puzzles show explosions there (7 puzzles in Even More, 4 in TIM 1). So "never" is
   wrong; the question becomes whether the alligator's search finds only parts of a fixed type and explosions.

   Answered (2026-11-08) by tests in the game, with no assumption needed: the snap flips a switch above the mouth,
   leaves a ball hanging there alone, and does nothing to an explosion. That is what the code gives, since the snap
   does something only to six named types of a fixed type (see "What the user saw of the alligator" in
   `docs/behaviour.md`).

   The run also showed that the explosion was given touch lines it can't have, being on the fixed list. The user: an
   explosion only happens after another part's action, so a level never stores one. That is [decided assumption
   23](behaviour-assumptions.md#23-explosions): an explosion is never on the moving list. Even More 9 and TIM 1 5 pairs
   are ruled out.

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

## Where it stands

After the lists a search walks and decided assumption 23 (2026-11-08), from `list-other-part-pairs` on all eleven
builds (each game's builds agree):

|                                   | Even More (start) | Even More (now) | TIM 1 (start) | TIM 1 (now) |
| --------------------------------- | ----------------: | --------------: | ------------: | ----------: |
| Pairs of parts the code lets meet |             1,090 |           1,090 |           621 |         621 |
| Described                         |               227 |             390 |           135 |         215 |
| Partly described                  |                46 |              31 |            17 |          18 |
| Ruled out (they can never meet)   |               570 |             657 |           345 |         383 |
| Missing                           |               247 |              12 |           124 |           5 |

Every missing pair names why. In Even More:

- Mel or the bullet need a walk, and the walk has nothing to follow: a velocity kept within the part's speed limit (the
  fan, bellows, teapot), one whose direction depends on where both parts are (the explosion, the pinball
  bumper), a contact response after the touch (the conveyor belt), or the contact search the teeter-totter runs on
  Mel.
- The explosion's split of a wall makes a new part; the jack-in-the-box's push of a teeter-totter grew past the size
  budget.

Recordings stay 648/648 and 552/552, and the 270 listed assumptions are unchanged.

## A. What parts do to each other, where it depends on where they are

- [x] **A1. Tables picked by angle or distance.** The word they read was the found part's speed limit, not a table
      of their own. The push itself is a formula now: the analysis reads the compiler's 32-bit multiply and division,
      and names the overlap the search stores. The fan adds ±16 × (256 − |overlapX|) ÷ mass to velocityX, the bellows
      ±8, the teapot pushes by 1536 or 1024; all kept within the part's speed limit. Missing pairs: Even More 247 → 145,
      TIM 1 124 → 59. See "The fan, the bellows and the teapot push what they find".
- [x] **A2. Where a part must be for the vacuum cleaner and the teeter-totter.** Their searches test a box around the
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
      The place tests, read per type for the balloon: the vacuum cleaner tests that the part's positionY is 44 or 47
      below the vacuum's (`M.20 > part.20 + 0x2c`, `>= part.20 + 0x2f`) and that the part's centre X lies within 4
      pixels of the vacuum's centre X; when it does, it adds a local (`stack.-6`, not yet read) halved to velocityX.
      The teeter-totter tests the part's centre X against its own centre with a frame-dependent width, and the ends
      `(positionX + 74) - part.positionX` and `positionX - part.positionX` in the ranges C3 already names.
      The vacuum cleaner is read (2026-11-07, see "The vacuum cleaner pulls what lies under its nozzle"): place tests
      that compare two places, ways open only at the stored overlap, a helper's type record reads per type, the
      search's flag test, and the part's own speed limit in tests and values. The per-type step is its own
      (`readBehaviourInSteps`), which the Lab takes after the walks, and reads only the loops whose values outgrew the
      analysis because of a type record word: the vacuum cleaner's (24 seconds a build). Even More 145 → 84 missing
      pairs, TIM 1 59. The teeter-totter's test (the part's centre X against its positionX plus half the width of its
      new frame) and the jack-in-the-box's (the part's positionX against its centre X) read as place tests too. What
      keeps their pairs missing now is A3 and A4 (the teeter-totter), A5 (the jack-in-the-box's electric switch: its
      search's flag tests aren't read), and for ten vacuum cleaner pairs A4: their test reads the pull left from the
      part before.
      Done (2026-11-08): on all eleven builds no pair is missing for a test of where the part is. What is left of the
      vacuum cleaner and the teeter-totter is partly described, and none of it is a place test. The teeter-totter's
      21 pairs stop at the contact search it runs on a part it launches. The vacuum cleaner's 5 (the bullet, the
      candle, the cat, Mel Schlemming and the mouse) have two reasons. For a part already rising at -1024 or faster it
      moves velocityX by half the pull still in its local from an earlier part, or whatever the stack held when no
      earlier part had one, which only the run knows; the pair check names that now instead of the general reason
      for a test that reads more than the two parts. On the other ways it keeps velocityX within the part's speed
      limit and then adds the pull, which the pair check doesn't yet see as a velocity kept within the speed limit,
      so it gives its last reason. That belongs with A5's speed limit pairs.
- [x] **A3. The paths that aren't read.** Read the teeter-totter's and the vacuum cleaner's list paths, the fan's and
      the cat's: each one is either read, or says which instruction stops it and why.
      Done (2026-11-07): the vacuum cleaner's, the fan's and the cat's are read since A1 and A2. The teeter-totter's
      ways stop at two calls the pair check now names: its rope pull before the loop (`0x1d638`, a connection query:
      the part at the other end of each rope answers), and the contact search it runs on each part it launches
      (`0x4fd`, swept from 16 pixels above and below it). No pair is left with "a test or value on it isn't read". Missing pairs are
      unchanged (Even More 84, TIM 1 59). See "Where the teeter-totter's launch stops being known".
- [x] **A4. The values the analysis doesn't know.** The teeter-totter's launch speed, the explosion's split of a wall,
      the fan's and the jack-in-the-box's last ones. Name each one, like the run values in the last plan, or give its
      formula from the source's fields.
      The teeter-totter's launch speed (2026-11-07): read past the rope pull and the contact search, so its pairs are
      partly described with the speed by the part's mass as lines (Even More 84 → 23 missing, TIM 1 59 → 9). See
      "Where the teeter-totter's launch stops being known". The fan has none left (its last are A5's tests). Left: the
      explosion's split of a wall (`0x1a8ae`: a hole from 32 pixels left of the explosion's centre to 24 right, on a
      16-pixel grid, with a copy of the wall for the far piece), and the jack-in-the-box's push of a teeter-totter
      (`0x1badd`: it tilts the plank by which side of its positionX + 36, 40 or 44 the jack-in-the-box's centre X is,
      by the plank's frame; the analysis stops at its size budget there).
      Done (2026-11-07): both are read from the code and given in "Two values the pair check names", and the pair check
      names them instead of "isn't known": a helper's effect the loop doesn't carry (the wall split, which also makes a
      new part), and a value past the size budget (the push). Read out, both would be values from the source's place,
      which A5 is about. No pair says "isn't known to the analysis" now.
- [x] **A5. The few left.** The alligator's and jack-in-the-box's values from their own place, the explosion's and
      pinball bumper's direction, the conveyor belt's contact response.
      Walks read place tests of a search's own list now (2026-11-07, see "Walks within reach of the source"): the
      electric switch from the jack-in-the-box and the alligator is described, and the vacuum cleaner's candle, cat
      and mouse are partly described. Missing: Even More 23 → 18, TIM 1 9 → 8.
      Touch lines take the part's own speed limit (the trampoline's launch, the alligator's snap): described Even More
      389 → 430, TIM 1 200 → 215. Pairs whose rules read a velocity kept within the speed limit (Mel and the bullet)
      name that as their reason.
      Values that pick by the source's place are split into their cases (see "Values that pick by where the source
      is"): the jack-in-the-box's and alligator's pushes of the bellows, scissors and teeter-totter are walks now.
      Missing: Even More 18 → 13, TIM 1 8 → 6.
      Walks read past the rope pull, the stored overlap and the type record (the fan's windmill is described). Found:
      the teeter-totter's search `0x437d` walks only the list its flags argument picks (the moving list for 0x1000),
      which the analysis doesn't read yet, so it still allows the teeter-totter to reach fixed parts and gives them
      lines. Next: read a search's list from the flags its call passes.
      Done (2026-11-08): the analysis reads the lists each search's call walks from the masks it passes (see "The lists
      a search walks"). With decided assumption 22, a search of the moving list only finds no part of a fixed type:
      Even More 78 pairs and TIM 1 33 pairs are ruled out, most of them launch lines the game can't give. The
      teeter-totter's search tests no flags, so the bullet's walk is described. Missing: Even More 13 → 12, TIM 1
      6 → 5.
      What is left falls in three groups: the speed limit (the bullet and Mel Schlemming, whose rules read the velocity
      a push keeps within it), the direction by where the parts are (the explosion and the pinball bumper), and the
      contact response after a bounce (the conveyor belt and the gear).
      The bullet's speed limit (2026-11-08): the analysis reads the routine that works out every type's limit, which
      gives the bullet 12288 in every level (see "The bullet's speed limit"). The fan's, the trampoline's and the
      alligator's pushes of the bullet are described. Missing: Even More 12 → 11, TIM 1 5 → 4.
      Mel's speed limit (2026-11-08): with decided assumption 24 (a level's air pressure is one the control panel can
      set, 0 to 128) every other type's limit lies from 7680 to 9728, which Mel's rules can't tell apart (see "Mel
      Schlemming's speed limit"). The fan's, the bellows' and the teapot's pushes of Mel are described. Missing: Even
      More 11 → 8.
      The direction by where the parts are (2026-11-08): the explosion's and the pinball bumper's pushes are split
      into the directions the part's rules tell apart, said as how far from level the line between the centres is
      (see "Pushes along the line between the centres"). Mel gets two walks from each, the bullet one from the bumper.
      Missing: Even More 8 → 5.
      Done (2026-11-08), the contact response: after the conveyor belt's and the gear's bounces the game always runs a
      contact response that works the speed out again from the angle the parts touch at, so their lines now name the
      speed the bullet's and Mel's rules read and say the response decides the next frame; the user chose to count
      these as described (see "The contact response after a bounce"). Missing: Even More 5 → 4, TIM 1 4 → 3. What is
      left is what the user chose to leave: the explosion's split of a wall, the jack-in-the-box's push of a
      teeter-totter and the teeter-totter's launch of Mel.
      The explosion's split of a wall (2026-11-08, after A5, on the user's ask): the wall's values reach the explosion's
      loop as one value each (see "The wall split in the explosion's loop"), and lines say values and tests of where
      the explosion is (see "Lines of where the source is"). Both walls are described in both games. Missing: Even
      More 4 → 2, TIM 1 3 → 1.
- [x] **A6. The Behaviour tab.** "From other parts" shows the place a part must be in and the table values, readable
      at a glance. Checked in a browser on the fan, the vacuum cleaner and the teeter-totter.
      Done (2026-11-07): checked headless on the balloon in Even More, which gets lines from all three. The
      teeter-totter's half width reads "centre X (positionX + frameWidth / 2)", the fan's and bellows' push a sum,
      the vacuum cleaner's pull without masks, long conditions as lines under the row, and a "then contact search"
      chip on the launch. See "Words for the Behaviour tab".

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
      Started (2026-11-08, branch `feature/behaviour-machine`): an 8086 processor that runs `TIM.EXE`'s own code,
      checked against DOSBox on about 1,500 instruction cases, and a recorder that starts the game, loads a puzzle with
      the game's puzzle loader and runs the run button's run loop, saving every part record each step. Works for Even
      More, English floppy (puzzles 1, 2, 17, 45, 60 and 80 tried) and TIM 1 French (puzzles 1, 2, 17, 40, 60 and 80);
      runs don't depend on the timer apart from pointers and the redraw links.
      See [the level recorder](machine-recorder.md). Next: the machine in B to compare with.
- [ ] **C2. Machines without motion first.** Compare B3 with the recordings of the levels from question 3.
- [ ] **C3. Then with motion.** Compare B4 and B5, level by level, and keep a list of where they part and why.

## D. Close

- [ ] **D1. Docs, numbers and PR text**, shown to you before the PR is opened.
