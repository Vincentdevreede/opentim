# Part behaviour: the last 10%

Each step has a number that shows it is done. The numbers come from the recording comparison on Even More (English
floppy) and TIM 1 (French), measured on 2cda1a2. A step that needs a decision from you says so; I collect those and ask
them together.

Starting point:

|                                                                       |  Even More |      TIM 1 |
| --------------------------------------------------------------------- | ---------: | ---------: |
| Rules that write a value the analysis can't name                      | 365 of 925 | 324 of 764 |
| Effect lines that say "isn't established" (once per part and wording) |         23 |         14 |
| Parts whose reset the report calls unresolved                         |   41 of 67 |         36 |
| Parts without a documented resting frame                              |         33 |         28 |
| Recordings that stop early                                            |  52 of 648 |  48 of 552 |
| Parts without any recording                                           |         28 |         22 |

## A. Make the score honest

- [x] **A1. One scoreboard.** Add the counts above to the measured metrics, so each later step shows its effect in one
      run. Done when the comparison prints them.
- [x] **A2. Resets that keep the saved frame.** 41 parts are reported as "unresolved" because their reset keeps the
      frame the level saved. That is the game's real behaviour, not a gap: report it as "keeps the saved frame" with the
      frames it can be. Done when "unresolved" only remains where the reset itself can't be read.
- [x] **A3. Resting frames.** 33 parts show "Unknown" resting frames while their walks end. Take them from where the
      walks come to rest. Done when every part whose walks all end lists its resting frames.
- [x] **A4. The two vague start notes.** "The seed does not establish the state" (34 parts) and "the unknown
      condition selects different next fields" (15). Check each one and either resolve it or replace it with the condition
      in plain words. Done when neither note is left without a named reason.
- [x] **A5. Input cases past 64.** The jack-in-the-box and monkey bike keep only 64 input cases in the description.
      Show all of them or prove the rest repeat the first 64.
- [x] **A6. The gear's frame 65535.** One gear note talks about frame 65535 (that is -1). Find out whether a gear can
      really reach it or whether it is a reading error.

## B. Name the values that are only known while the game runs

These can never become a number, but each one can become a plain value like "the part its search found" or "the
touching part's speed, reversed". A rule then counts as named, not unknown.

- [x] **B0. Values that differ by path.** When two rules lead to the same frame and differ only in one test, they are
      merged into one rule. A field the two set differently then becomes unknown ("Field 0x12 differs on complementary
      paths"), although both values are known. This is the largest group: about 40 fields in most parts. Keep both values
      with the test that picks them. Done when no write is unknown only because of this merge.
      Done: the field keeps both values, `(test) * a + (opposite) * b`, for every comparison. Rules that write a value
      the analysis can't name went from 365 to 247 of 925 in Even More and from 324 to 223 of 764 in TIM 1. Every walk
      still ends, and the recordings stay at 596 complete, 52 prefix, 0 different (Even More) and 504, 48, 0 (TIM 1).
      In 4 teeter-totter rules per build both values are known but a query's answer picks one: that belongs to B1.
- [ ] **B1. Search results (found list `0x78`, `0x7a`, `0x7c`).** About 160 rules, most of them the cat (108), then the
      teeter-totter, jack-in-the-box, mouse, teapot, candle, rocket, fan, bellows, vacuum cleaner, magnifying glass, Mel's
      house, solar panel and explosion. Name the list links and the found part's fields.
- [ ] **B2. The touching part's speed.** The gear (48), alligator, trampoline, conveyor belt, pinball bumper, bullet,
      thumb tack and electric switch write the touching part's speed and position. Write each as a formula of the touching
      part's own fields.
- [ ] **B3. Parts reached through ropes and belts (`0x14`, `0x5a`, `0x5c`).** Short in many parts (one or two rules
      each). Name them through the relay that is already proved.
- [x] **B4. Objects a part creates.** The balloon, cannon, gun and dynamite plunger fill in a new object. Find which
      part type each one creates and give its starting fields. Done: they make a rope end, a pinball, a bullet and an
      explosion; each way through the routine is one effect line with the new part's place, speed and other fields.
      Its speed limit and list links stay unnamed, and the merged rules wait for B0.
- [ ] **B5. A part's own fields.** What is left per part: the cat (`0x1e`), teeter-totter (`0x08`), Mel (`0x16`, `0x18`,
      `0x1e`, `0x36`), mouse (`0x16`, `0x18`), gear (connected parts at `0x0c`, `0x12`), monkey bike and light bulb (`0x6a`,
      `0x6b`), dynamite (`0x08`, `0x72`, `0x73`), mouse motor (`0x12`, `0x96`), electric switch (`0x12`). Prove each one or
      name what it depends on.
- [ ] **B6. The 23 "isn't established" effect lines** (14 in TIM 1). Most are the teeter-totter's and the vacuum
      cleaner's, then the gear, trampoline and balloon, and one each for the cat, alligator, boxing glove, Mel's house and
      explosion. Each line gets a meaning or a precise reason why the code can't give one.

Done when the first row of the scoreboard counts only rules whose value comes from outside the game (the player or
the level), and every one of those is listed by name.

## C. What other parts do to a part

- [ ] **C1. Touch effects that aren't walked yet.** The vacuum cleaner, the teeter-totter, the electric switch on a
      bullet and the trampoline's effects on Mel. Done when each one is a line or a walk in "From other parts".
- [ ] **C2. Check the list is complete.** Go over every part type's bounce, hit and search code and list which types
      it can affect. Done when every pair the code allows appears in some part's "From other parts", or is listed as not
      possible with the reason.

## D. Recordings that stop early

- [ ] **D1. Mouse motor restart, cat, mouse and Mel's house** (20 in Even More). They wait for a search to find
      another part. Decided: prove the part stays alone (no part in the recording creates another part, and the recording
      shows nothing else on the bench) and close only the recordings where both hold. No new assumption.
      Stopped at the second check: a v25 clip saves only the recorded part's own fields, its input and the engine calls
      it skipped, no other part and no position, so it can't show the bench. It does show that the recorder skipped
      the very searches these parts wait for (see "Recordings that wait for a search" in `docs/behaviour.md`). All 20
      stay open.
- [ ] **D2. Monkey bike** (32 per build). It checks the belt link on its pedalling frames, which the recording doesn't
      save. Still open. Check what you saw in the game against the code:
  - it starts biking when the shade is pulled down;
  - a belt on it works like the mouse motor's wheel while it bikes;
  - when hit, it pauses and shows stars, then bikes on;
  - if the shade isn't pulled down again, it doesn't start again.

  - a belt from the bike can drive another part, like a jack-in-the-box: check that what the bike writes into the
    belt is what the jack reads.

  Whether the recorded bikes had a belt attached is unknown (the bike works with or without one), so the 32
  recordings stay open.

## E. Parts without a recording

- [ ] **E1. Check them against the shipped levels.** 28 parts have no recording (walls, balls, ropes, pulley, belt,
      electric switch, solar panel, magnifying glass, rope end and the holiday parts). Compare their starting frames and
      resting frames with every shipped level. Done when no level disagrees.
- [ ] **E2. A short list for you to try in the game.** Decided: yes. For the parts where code alone leaves room, a
      few things to try, each with what the analysis expects.

## F. All builds

- [ ] **F1. Measure all eleven builds**, not only the two above. Done when every build's numbers are in the report
      and none has a recording that differs.
- [ ] **F2. Recheck the decided assumptions** over all builds and the shipped levels after A to E.

## G. Close

- [ ] **G1. Docs and lab.** Every new proof has a section in `docs/behaviour.md`; the Behaviour tab shows the named
      values from B in plain words.
- [ ] **G2. PR text and final numbers**, shown to you before it is posted.

## Not in this plan

Several parts working together (a gear train, a belt and two motors, a rope over pulleys) is the next kind of work: it
needs a model of the whole machine, not one part at a time. Section C is where this plan stops on that side.
