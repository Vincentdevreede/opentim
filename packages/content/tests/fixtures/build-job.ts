/** A script for the build runner test: answers late for the first build, and fails for a folder named "broken". */
import { setTimeout } from "node:timers/promises";
import type { BuildFolder } from "../../scripts/builds.ts";

export async function inBuild(build: BuildFolder, given: string) {
  if (build.folder.endsWith("broken")) throw new Error("this build can't be read");
  if (build.index === 0 && build.game === "tim1") await setTimeout(200);
  return {
    name: build.folder.split("/").pop(),
    game: build.game,
    given,
    sizes: new Map([[build.index, new Set([1])]]),
  };
}
