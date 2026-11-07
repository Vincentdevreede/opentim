import { describe, expect, it } from "vitest";
import { buildFolders, inEachBuild, jobsOption } from "../scripts/builds.ts";

const job = new URL("./fixtures/build-job.ts", import.meta.url);

describe("reading builds side by side", () => {
  it("gives each build's answer in the builds' order, even when a later build is read first", async () => {
    const seen: unknown[] = [];
    await inEachBuild(job, buildFolders({ tim1: ["/a", "/b"], evenmore: ["/c"] }), (answer) => seen.push(answer), {
      jobs: 3,
      given: "out",
    });
    expect(seen).toEqual([
      { name: "a", game: "tim1", given: "out", sizes: new Map([[0, new Set([1])]]) },
      { name: "b", game: "tim1", given: "out", sizes: new Map([[1, new Set([1])]]) },
      { name: "c", game: "evenmore", given: "out", sizes: new Map([[0, new Set([1])]]) },
    ]);
  });

  it("fails with the folder of the build that couldn't be read", async () => {
    await expect(inEachBuild(job, buildFolders({ evenmore: ["/broken"] }), () => {}, { jobs: 1 })).rejects.toThrow(
      "/broken: this build can't be read",
    );
  });

  it("takes --jobs only as a positive whole number", () => {
    expect(jobsOption("4")).toBe(4);
    expect(jobsOption(undefined)).toBeGreaterThanOrEqual(1);
    expect(() => jobsOption("0")).toThrow("--jobs");
    expect(() => jobsOption("two")).toThrow("--jobs");
  });
});
