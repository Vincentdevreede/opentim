# Things to try in the game

Step E2 of the finished behaviour plan. The analysis reads TIM.EXE without running it. For the parts below, no
recording shows what they do, or what they do depends on another part, so the code alone leaves room. Each item says
what to build, and what the analysis expects to see. If the game does something else, the analysis is wrong there, so
the items that would show that most clearly come first.

Play them in Even More (the English floppy build is the one the evidence comes from). TIM 1 has most of these parts
with the same code at other addresses, but that isn't checked item by item. The evidence in brackets after each item is
for reading the code again; it isn't needed to play the item. Tick the box when done and write what you saw under it.

## Electric switch

- [ ] **1. The switch gives power when its lever has moved, not by where the lever is.** Plug a fan into a switch and
      start the machine with the lever on one side. Expect: the fan stays still. Let a ball flip the lever: the fan starts. Flip
      it back: the fan stops. Then do the same with the lever set to the other side in the editor: again the fan stays
      still at the start and only runs while the lever is away from where the level started it. [The switch's bounce
      sets its control value to 1 when its frame differs from the saved frame and to 0 when it matches
      (`0x1a624` to `0x1a634`); its run copies that value to the parts in both sockets every step (`0x1a6bf`); the fan
      only runs while its control value isn't 0 (`0x1ab5c`). Shipped levels save every control value as 0.]

      Saw:

- [ ] **2. Only a hit from the other side flips the lever.** Roll a ball into the switch from one side, then from the
      other. Expect: a hit from one side moves the lever over, a hit from the side it already leans to does nothing.
      [`0x1a5f3` to `0x1a60f`: below frame 4 only a contact angle in one half turns it to the other position, from frame
      4 on only an angle in the opposite half turns it back. Which half is which side of the screen isn't proved.]

      Saw:

- [ ] **3. A bullet that hits the switch stops flying.** Fire a gun at a switch. Expect: the lever flips (if the bullet
      comes from the right side, see item 2), and the bullet changes from its flying picture to its hit pictures
      instead of flying on. [The switch's bounce takes 1 from a bullet's horizontal speed (`0x1a639`); the bullet keeps
      its flying frame only at exactly 12288 or -12288 (`0x199f3`), so it goes to frame 1 and rests on frame 2.]

      Saw:

## Magnifying glass

- [ ] **4. A light through the glass lights a candle on the other side.** Put a burning candle on one side of the
      glass, close to it, and an unlit candle on the other side, with its wick about level with the glass and close
      too. Expect: after a short wait (21 steps of the machine) the second candle lights. The same with dynamite, a
      rocket or a cannon on the far side: their fuse lights. A burning candle, a lit lamp or a flashlight that is on
      all work as the light. [Glass run `0x1c0ac`: a light is a lamp, flashlight or candle on any frame but 0 (a lamp
      not on frame 2); each step the glass adds 1 to its target's heat counter (`0x1c217`); a candle, dynamite, rocket
      and cannon light when that counter passes 20 (`0x19a75`, `0x1a3d9`, `0x1c6fe`, `0x19b50`).]

      Saw:

- [ ] **5. The light must shine through the glass.** Repeat item 4 with both candles on the same side, and with a
      flashlight on the light side that faces away from the glass. Expect: nothing lights. A flashlight only works when
      it faces the same way as the glass. [`0x1c100` to `0x1c135`: the light must be on the side the glass's facing
      gives, and a flashlight's facing must match the glass's; the target must be on the opposite side (`0x1c170` to
      `0x1c187`). Which side counts as which comes from the overlap query's side value, which isn't proved.]

      Saw:

- [ ] **6. Only the nearest target in the focus heats up.** Put two unlit candles on the far side, one nearer than the
      other. Expect: only the nearer one lights, and the glass keeps heating the one it started on. A target lights only
      when its wick is less than about 48 pixels across from the glass's far edge and no farther above or below than it
      is across, so a candle well above or below the glass's middle never lights. [Search box 32 pixels to each side
      at the glass's own height (`0x1c0b7`); focus test `0x1c255` and `0x1c19e` to `0x1c1aa`; nearest by box distance and
      the kept target in the glass's first socket (`0x1c1b7` to `0x1c1e2`).]

      Saw:

## Solar panel

- [ ] **7. A light right next to the panel powers it.** Plug a fan into a solar panel and put a burning candle right
      against the panel (within about 26 pixels). Expect: the fan runs. With an unlit candle it doesn't. A lit lamp works
      too, and so does a flashlight that is on and points at the panel. [Panel run `0x1ce68`: a search 26 pixels
      round the panel for a lamp, candle or explosion whose control value isn't 0, or a flashlight that faces the panel
      (`0x1cea9` to `0x1cee1`); the run copies the result to both sockets (`0x1ceed`).]

      Saw:

- [ ] **8. A flashlight pointing away does nothing.** Put a flashlight that is on next to the panel, facing away from
      it. Expect: the fan stays still. Turn it round: the fan runs. [`0x1cec3` to `0x1cedf`; as in item 5, which side the
      query calls which isn't proved, so this also shows that.]

      Saw:

- [ ] **9. The panel reacts a little late.** In item 7, blow the candle out with a fan or bellows. Expect: the plugged
      fan stops, but up to 8 steps later than the flame goes out; likewise it starts up to 8 steps after the light
      arrives. [The panel looks for light only when the step counter's low three bits are 4 (`0x1ce77`), and keeps its
      answer in between.]

      Saw:

## Flashlight and lamp

- [ ] **10. A part dropped on the flashlight turns it on for good.** Drop a ball onto the flashlight. Expect: it turns
      on and stays on for the rest of the run, even when nothing powers it. A ball bumping it from the side doesn't
      turn it on. [Flashlight bounce `0x1add4` sets its control value to 1 only at contact angle 0; its run only goes
      from frame 0 to 1 (`0x1ae43`), and nothing turns it back.]

      Saw:

- [ ] **11. The lamp's pull chain works once.** Tie a lamp's rope to a teeter-totter and tip the teeter-totter so it
      pulls the rope. Expect: the lamp switches on and stays on. Tipping it the way that would slacken the rope is
      refused (the teeter-totter stays put), and once the lamp is on it refuses every pull. [Lamp rope callback
      `0x1bc9d`: it answers no for one pull kind always and for the other when already on, and on the real pull turns
      itself on (`0x1bcf8`); its run only goes from frame 0 to 1 or 2 to 3 (`0x1bc1d`). Which pull kind is which rope
      direction isn't proved.]

      Saw:

## Electric motor and generator

- [ ] **12. The motor turns its belt by its own facing.** Power an electric motor from a generator and belt the motor
      to a conveyor belt. Turn the generator the other way (flip what drives it). Expect: the conveyor belt runs the
      same way both times. Flip the motor: it runs the other way. [Motor run `0x1a4d1`: it only checks that its power
      isn't 0, and gives the part on its belt 1 when mirrored and -1 otherwise (`0x1a4fa` to `0x1a508`); without power it
      gives 0, which stops that part. A part with flag `0x0800` in its drawing flags is left alone (`0x1a4e6`); what that
      flag means isn't proved.]

      Saw:

- [ ] **13. A generator driven by a gear stops when the gear stops.** Belt a generator to a gear that a motor turns,
      plug a fan into the generator, then stop the gear (block it or switch its motor off). Expect: the generator stops
      turning and the fan stops. [Generator run `0x1af14`: when the part on its belt is a gear whose last two frames are
      the same, it sets its own power to 0 (`0x1af32` to `0x1af40`), then copies its power to both sockets.]

      Saw:

## Explosion and pinball bumper

- [ ] **14. An explosion pushes by the kind of part, not by distance.** Put a tennis ball and a bowling ball the same
      distance from dynamite, and another tennis ball farther away but still within reach. Expect: the tennis balls fly
      off at the same speed whatever their distance, about twice as fast as the bowling ball, and straight away from the
      middle of the explosion. A heart flies like a tennis ball and a shamrock a little slower than the bowling ball. A
      Christmas tree and anything just outside the reach (20 pixels to the side of the explosion, 24 above or below)
      don't move. [Explosion run: speed classes by the type record's weight (`0x1a836`: tennis ball and heart 5632,
      bowling ball 3072, shamrock 2560); the speed replaces the old one (`0x7d97`), pointing away from the centre within
      0.23 degrees; only parts on the moving list are pushed, and the Christmas tree's type is on the fixed list.]

      Saw:

- [ ] **15. The pinball bumper always throws at one speed.** Drop a ball on a bumper from low, then from high up, and
      roll a heavy ball into it. Expect: every ball leaves at the same speed, straight away from the bumper's middle,
      faster than any explosion push. [Bumper bounce: speed 7168 from the centre angle, and it returns 0 so no other
      bounce follows; see "Effects of parts that touch" in [behaviour.md](../research/behaviour.md).]

      Saw:

## Bucket and thumb tack

- [ ] **16. A falling ball drops into the bucket; on the rim it bounces.** Drop a ball straight into the middle of a
      bucket's opening, then one onto its rim. Expect: the first falls inside, the second bounces off. A ball thrown up
      into the bucket from below bounces off too. [Bucket bounce `0x19847`: it skips the bounce only while the ball moves
      down and its middle is between 4 and 32 pixels from the bucket's left edge.]

      Saw:

- [ ] **17. The tack pops a balloon only with its point.** Let a balloon rise against the side or flat end of a thumb
      tack, then onto its point. Expect: it pops only on the point. [Tack bounce `0x1e2ce`: a balloon pops only at three
      exact contact angles.]

      Saw:

## Fan, vacuum cleaner and candle

- [ ] **18. The fan blows forward at its own height.** Put a tennis ball and a bowling ball in front of a running fan,
      a lit candle in front of it, a windmill in front of it and a ball behind it. Expect: the tennis ball is blown away
      faster than the bowling ball, nearer parts more than farther ones, the candle goes out, the windmill starts
      turning if it is less than about 200 pixels away, and nothing behind the fan moves. Nothing more than about 256
      pixels in front is touched. [Fan run `0x1ab51`: search 256 pixels in front, 10 above (`0x1ab8b` to `0x1abcf`); a
      windmill within 200 gets control value 1 (`0x1abea` to `0x1abff`); the push is `256 - distance` scaled and divided
      by the type record's weight (`0x1ac09` to `0x1ac5f`); a candle gets control value 0 (`0x1ac69`).]

      Saw:

- [ ] **19. A running vacuum cleaner pops balloons and swallows parts at its nozzle.** Let a balloon, then a tennis
      ball, touch the nozzle of a vacuum cleaner that is on, and then of one that is off. Expect: when on, the balloon
      pops and the ball disappears (it no longer takes part in the machine); when off, both just bump it. [Vacuum bounce
      `0x1e5af`: control value not 0, and contact at edge 5 or angle `0x8000`; see "Touch effects of four more parts" in
      [behaviour.md](../research/behaviour.md).]

      Saw:

- [ ] **20. What a candle flame does.** Put a lit candle under a balloon, under a teapot, next to a resting cat, and
      with an unlit candle's wick at its flame. Expect: the balloon pops, the teapot starts, the cat starts its reaction,
      and the other candle lights. Parts only a little away from the flame aren't affected. [Candle run `0x19a67`: its
      first search lights parts marked lightable whose point is in the flame box (`0x19ab2`); every other frame its
      second search pops a balloon, starts a teapot and sends a cat on frame 0 to frame 1 (`0x19aed` to `0x19b31`).]

      Saw:

## Balloon, scissors and rope ends

- [ ] **21. A popped balloon leaves its rope on the part below.** Tie a balloon to a ball and pop it. Expect: the rope
      stays tied to the ball, now with a loose end where the balloon was, and the ball falls with the rope. [The balloon
      makes a rope end (`0x192d3`) at its end of the rope and gives it the balloon's rope links; see "Parts a part makes"
      in [behaviour.md](../research/behaviour.md).]

      Saw:

- [ ] **22. Scissors cut a rope into two pieces with loose ends.** Let scissors close on a rope between two parts.
      Expect: two ropes, each still tied to one of the parts, each with a loose end at the cut; the scissors themselves
      look the same as without a rope. [Rope cut: a new rope and two rope ends from the part factory, and no write to the
      scissors' frame; see "The scissors' rope cut" in [behaviour.md](../research/behaviour.md).]

      Saw:

## Mel Schlemming

- [ ] **23. Mel landing near a trampoline's edge doesn't bounce like a ball.** Drop Mel onto a trampoline well away
      from its middle, then right on the middle. Expect: more than 14 pixels from the middle he stops falling there and
      changes to his landing picture; what follows isn't predicted. [Trampoline bounce `0x1cf17`: vertical speed 0, frame
      6, 7 or 8 to frame 9, and it returns 1, so a contact response may still change his speed.]

      Saw:

## Birdcage, bucket and heart on a rope

- [ ] **24. A birdcage tied to a teeter-totter jumps.** Tie a birdcage by rope to a teeter-totter and tip it so the rope
      pulls the cage. Expect: the cage jumps up by about 20 pixels at once rather than being lifted smoothly, unless it
      outweighs what tips the teeter-totter, in which case the teeter-totter doesn't tip. A bucket or a heart on that
      rope can also hold the teeter-totter still, but never jumps. [Birdcage rope callback `0x1a0f5`: it answers no
      when its rope weight beats the asking part's, and on one pull kind moves itself up 20 and adds 1 to its control
      value (`0x1a150` to `0x1a15a`); the bucket's (`0x198e2`) and heart's (`0x1b76e`) callbacks only answer. What the
      compared weights are, and which pull kind is which direction, isn't proved.]

      Saw:

- [ ] **25. Holiday parts are plain balls.** Drop a heart, a shamrock and a jack-o-lantern on an incline and a
      conveyor belt. Expect: they roll and are carried like balls, and none of them does anything on its own. The
      Christmas tree stays where it is placed. [Their run is the shared empty run (`0x29f`); their reset only sets their
      outline; the Christmas tree's type is on the fixed list.]

      Saw:
