import { expect, it } from "vitest";
import { interactionPairs, kindOf } from "../src/interactions.ts";
import type { Doing, OtherEffect } from "../src/behaviour.ts";

const effect = (sourceType: number, sets: OtherEffect["sets"], touch = false) =>
  ({ sourceType, source: `part ${sourceType}`, sets, ...(touch ? { touch: true } : {}) }) as unknown as OtherEffect;
const made = (description: string) => ({ on: "created", description }) as unknown as Doing;

it("names what a setting does", () => {
  expect(kindOf({ what: "velocityX", value: "1536" })).toBe("push");
  expect(kindOf({ what: "", value: "up and to the left" })).toBe("push");
  expect(kindOf({ what: "fine Y", value: "positionY × 512" })).toBe("push");
  expect(kindOf({ what: "out-of-play flag", value: "set" })).toBe("remove");
  expect(kindOf({ what: "goal mark", value: "set", mark: 0x100 })).toBe("mark");
  expect(kindOf({ what: "contact flag", value: "cleared" })).toBe("touch");
  expect(kindOf({ what: "frameWidth", value: "32" })).toBe("change");
});

it("joins the rows of one source on one target into a pair, with how it reaches it and the parts it makes", () => {
  const pairs = interactionPairs(
    {
      9: [
        effect(51, [
          { what: "out-of-play flag", value: "set" },
          { what: "goal mark", value: "set", mark: 0x100 },
        ]),
        effect(51, [{ what: "velocityX", value: "-512" }], true),
        effect(24, [{ what: "velocityX", value: "256" }]),
      ],
    },
    { 18: [made("Creates a cannonball (type 43, which starts on frame 0) at …")] },
  );
  const vacuum = pairs.find((p) => p.source === 51 && p.target === 9)!;
  expect(vacuum).toMatchObject({ kinds: ["remove", "mark", "push"], how: "both" });
  expect(vacuum.effects).toHaveLength(2);
  expect(pairs.find((p) => p.source === 24)).toMatchObject({ kinds: ["push"], how: "reach" });
  expect(pairs.find((p) => p.source === 18)).toMatchObject({ target: 43, kinds: ["make"], how: "reach" });
});

it("keeps a part made of a type without a name", () => {
  const pairs = interactionPairs({}, { 18: [made("Creates a part of type 70, which starts on frame 0, at …")] });
  expect(pairs.find((p) => p.source === 18)).toMatchObject({ target: 70, kinds: ["make"] });
});

it("leaves a part's own bounce out, so a type doesn't act on itself", () => {
  const own = { ...effect(9, [{ what: "velocityX", value: "0" }], true), own: true } as OtherEffect;
  expect(interactionPairs({ 9: [own, effect(24, [{ what: "velocityX", value: "256" }])] })).toMatchObject([
    { source: 24, target: 9 },
  ]);
});
