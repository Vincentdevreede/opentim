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

- [ ] **A1. Tables picked by angle or distance.** Read the fan's, the bellows' and the teapot's tables from TIM.EXE
      and say what they give. Found so far: the word they read is not a table of their own but the found part's
      speed limit at +0x0a of its type record, which the game works out per level from air pressure and gravity. The
      push itself went through the compiler's 32-bit multiply and division helpers, which the analysis now reads
      (b46f08e): the fan adds ±16 × (256 − |overlapX|) ÷ the part's mass to its velocityX, and then keeps both
      velocities within the part's speed limit. Its search box is 256 pixels long on the side it blows to, and the
      search writes overlapX (0x7a) as how far the part lies outside the fan's box along X: the gap past the fan's
      right edge, at least 1, or the gap before its left edge, at most -1. Left: name overlapX and overlapY as run
      values, say "kept within its speed limit", and let the pair check count these lines as described.
- [ ] **A2. Where a part must be for the vacuum cleaner and the teeter-totter.** Their searches test a box around the
      source, like the teeter-totter's ends did in the last plan (C3). Say the box in pixels from the source, named
      by what it is where the code shows it ("in front of the nozzle", "above the left end"). Done when no pair is
      missing for a test of where the part is.
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
