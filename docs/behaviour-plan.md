# Part behaviour: the last 10%

Each step has a number that shows it is done. The numbers come from the recording comparison on Even More (English
floppy) and TIM 1 (French). The starting point was measured on 2cda1a2; "now" comes from the done notes below and,
for resets and resting frames, from the description on 41e8ba5. A step that needs a decision from you says so; I
collect those and ask them together. Each done note is short: the details are in `docs/behaviour.md` under the
section it names.

|                                                                       | Even More, start | now | TIM 1, start | now |
| --------------------------------------------------------------------- | ---------------: | --: | -----------: | --: |
| Rules that write a value the analysis can't name                      |       365 of 925 |   0 |   324 of 764 |   0 |
| Effect lines that say "isn't established" (once per part and wording) |               23 |   0 |           14 |   0 |
| Parts whose reset the report calls unresolved                         |         41 of 67 |   0 |           36 |   0 |
| Parts without a documented resting frame                              |               33 |   4 |           28 |   3 |
| Recordings that stop early                                            |        52 of 648 |   0 |    48 of 552 |   0 |
| Parts without any recording                                           |               28 |  28 |           22 |  22 |

The parts without a recording are checked against the shipped levels instead (E1). The parts left without a resting frame (Even More 6, 8, 58 and 61, TIM 1 6, 8 and 10) have walks that all end, but
in a loop or by keeping the frame they are given, so no walk rests on one frame. Since decided assumption 21 the wood
incline rests on frames -1 to 3.

## A. Make the score honest

- [x] **A1. One scoreboard.** The comparison prints the counts above.
- [x] **A2. Resets that keep the saved frame.** Reported as "keeps the saved frame" with the frames it can be, or as
      set from the plugs for the parts with sockets. No reset stays unresolved.
- [x] **A3. Resting frames.** Taken from where the walks come to rest, with how many walks end on each.
- [x] **A4. The two vague start notes.** Each one is resolved or says its condition in plain words.
- [x] **A5. Input cases past 64.** The jack-in-the-box (156) and the monkey bike (154) keep all their input cases.
- [x] **A6. The gear's frame 65535.** A gear never reaches frame -1: its run and the gears it moves wrap -1 to 3. See
      "The gear's frame -1".

## B. Name the values that are only known while the game runs

These can never become a number, but each one can become a plain value like "the part its search found". A rule then
counts as named, not unknown.

- [x] **B0. Values that differ by path.** Merged rules keep both values with the test that picks them. Unknown
      writes 365 to 247 of 925 (Even More), 324 to 223 of 764 (TIM 1).
- [x] **B1. Search results (`0x78`, `0x7a`, `0x7c`).** The found list, the next found part and the values a query
      writes to a found part are named, and counted apart as named run values.
- [x] **B2. The touching part's speed.** The speed limit keeps a speed within the limit from the type record; the
      speed setter's velocity is a formula, and the pinball bumper's angle is the named centre angle answer.
- [x] **B3. Parts reached through ropes and belts.** Named through the relay: its byte is exact on the owner and on
      every part it reaches. Unknown writes 242 to 33 (Even More), 218 to 28 (TIM 1). You settled the two questions
      left (decided assumptions 19 and 20), so a flip callback's part keeps its rope ends and links after the relay.
      See "The owner's rope fields after the relay".
- [x] **B4. Objects a part creates.** The balloon, cannon, gun and dynamite plunger make a rope end, a cannonball, a
      bullet and an explosion, each with its place, speed and other fields.
- [x] **B5. A part's own fields.** Every field is known or a named run value. Unknown writes 0 of 925 and 0 of 764;
      named run values 234 and 214.
- [x] **B6. The "isn't established" effect lines.** 0 in both builds: the out-of-play flag, the ran-this-step mark,
      the goal marks, the contact flag and the fine position say what the code does with them. See "Effect lines with a
      proved meaning".

## C. What other parts do to a part

- [x] **C1. Touch effects that aren't walked yet.** The vacuum cleaner, the teeter-totter, the electric switch on a
      bullet and the trampoline on Mel are lines or walks in "From other parts". See "Touch effects of four more parts".
- [x] **C2. Check the list is complete.** `list-other-part-pairs` gives every pair the code allows as described,
      partly described, ruled out or missing, each with its reason. Even More: 1,084 pairs, 221 described, 46 partly,
      570 ruled out, 247 missing; TIM 1: 615, 129, 17, 345, 124. See "Which parts can affect which".
- [x] **C3. What a teeter-totter's end does to the part lying there.** The helper its ends hand their lists to is read
      path by path, with each call's numbers put in. The bellows, scissors, dynamite plunger and flashlight get 4 walks
      each, named with where the part must lie ("when its positionX is 0 to 8 pixels left of the teeter totter's
      positionX + 74"); the mouse motor and fish bowl join their walks. Pairs: Even More 1,090 and 227 described, TIM 1
      621 and 135, the six all described. See "What a teeter-totter's end does to the part lying there".
- [ ] **C4. The missing pairs that depend on where parts are.** 247 pairs in Even More and 124 in TIM 1 (sweeps,
      explosion splits, thrown directions) belong with several parts working together; this plan only lists them.

## D. Recordings that stop early

- [x] **D1. Mouse motor restart, cat, mouse and Mel's house.** Closed under decided bases of their own: a skipped
      search compared with "found nothing", what the recorder writes between runs, and walks only from a start the
      recorder seeded. See "Recordings that wait for a search" and the sections after it.
- [x] **D2. Monkey bike.** All five things you saw agree with the code; the 32 recordings per build close under the
      recorder's own basis, and you confirmed it stops only when the machine stops. See "The monkey bike against what
      the user saw".

Now 648 of 648 complete in Even More and 552 of 552 in TIM 1, none different.

## E. Parts without a recording

- [x] **E1. Check them against the shipped levels.** No level disagrees, in all eleven builds (1,281 level files).
      The wood incline starts on the frame its width gives, -1 to 3 (decided assumption 21). See "Starting frames in
      the shipped levels".
- [x] **E2. A short list for you to try in the game.** 25 items in `docs/behaviour-game-checks.md`.

## F. All builds

- [x] **F1. Measure all eleven builds.** Every build has the numbers of the recorded build of its game, and every
      walk ends (Even More 1,338, TIM 1 1,154). No recording differs; 16 (Even More CD and demo) and 12 (TIM 1 English)
      stop as prefixes because they need a search the recorder skipped. See "All eleven builds".
- [x] **F2. Recheck the decided assumptions** over all builds and the shipped levels after A to E. All 21 hold in
      all eleven builds and 1,281 level files, and every one is still stated by the findings that use it. One earlier
      note was corrected: two belts in L21 have width 40, off the 16 grid, on the frame that width gives. See "Recheck
      of the decided assumptions" in `docs/behaviour-assumptions.md`.

## G. Close

- [x] **G1. Docs and lab.** Every new proof has a section in `docs/behaviour.md`; the Behaviour tab shows the named
      values from B in plain words. Done: the tab shows the rest and the resting frames, the parts a part creates,
      what it does to other parts and to its own flags, other parts' settings by their proved meaning and run values
      by name, and folds a trigger's many walks by where they start. See "The Behaviour tab".
- [ ] **G2. PR text and final numbers**, shown to you before it is posted.

## Not in this plan

Several parts working together (a gear train, a belt and two motors, a rope over pulleys) is the next kind of work: it
needs a model of the whole machine, not one part at a time. Section C is where this plan stops on that side.
