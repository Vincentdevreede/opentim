import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readBehaviourInBackground,
  readingPerType,
  walksAfterPerType,
  type BehaviourMessage,
} from "../src/behaviour.ts";
import { program } from "../src/library.ts";

/** A worker that never answers by itself, so a test decides what it says and sees when it ends. */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: (e: { data: BehaviourMessage }) => void;
  onerror?: (e: { message: string }) => void;
  ended = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage() {}
  terminate() {
    this.ended = true;
  }
}

const parts = {} as Parameters<typeof readBehaviourInBackground>[1];

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  program.value = undefined;
  vi.unstubAllGlobals();
});

it("stops the read of a program when another program replaces it, and reads it again when asked", async () => {
  const old = new Uint8Array([1]);
  program.value = { name: "TIM.EXE", data: old };
  const reading = readBehaviourInBackground(old, parts);
  expect(FakeWorker.all).toHaveLength(1);

  program.value = { name: "TIM.EXE", data: new Uint8Array([2]) };

  expect(FakeWorker.all[0]!.ended).toBe(true);
  await expect(reading.result).resolves.toEqual({ status: "error", message: "The program was replaced." });
  await expect(reading.walks).resolves.toEqual({ status: "error", message: "The program was replaced." });
  expect(readBehaviourInBackground(old, parts)).not.toBe(reading);
  expect(FakeWorker.all).toHaveLength(2);
});

it("stops the read when the files are unloaded", () => {
  const data = new Uint8Array([3]);
  program.value = { name: "TIM.EXE", data };
  readBehaviourInBackground(data, parts);

  program.value = undefined;

  expect(FakeWorker.all[0]!.ended).toBe(true);
});

it("leaves a finished read alone when its program is replaced, and keeps the read of the new one", async () => {
  const done = new Uint8Array([4]);
  program.value = { name: "TIM.EXE", data: done };
  const reading = readBehaviourInBackground(done, parts);
  const walks = { status: "done", walks: {}, effects: {}, rests: {}, doings: {}, seconds: 1, perType: false } as const;
  FakeWorker.all[0]!.onmessage!({ data: { kind: "walks", result: walks } });
  // The read goes on with the loops per type, and ends when they come.
  expect(FakeWorker.all[0]!.ended).toBe(false);
  const perType = { ...walks, perType: true } as const;
  FakeWorker.all[0]!.onmessage!({ data: { kind: "per type", result: perType } });
  expect(FakeWorker.all[0]!.ended).toBe(true);
  const next = new Uint8Array([5]);

  program.value = { name: "TIM.EXE", data: next };
  readBehaviourInBackground(next, parts);
  program.value = { name: "TIM.EXE", data: next };

  await expect(reading.walks).resolves.toBe(walks);
  await expect(reading.perType).resolves.toBe(perType);
  expect(readBehaviourInBackground(done, parts)).toBe(reading);
  expect(FakeWorker.all[1]!.ended).toBe(false);
});

it("ends the read with an error when its worker can't start, and tries again later", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("No workers here.");
      }
    },
  );
  const data = new Uint8Array([6]);
  const reading = readBehaviourInBackground(data, parts);

  await expect(reading.result).resolves.toEqual({ status: "error", message: "No workers here." });
  await expect(reading.walks).resolves.toEqual({ status: "error", message: "No workers here." });
  expect(readBehaviourInBackground(data, parts)).not.toBe(reading);
});

it("keeps the walks when the program is replaced while the loops are still read per type", async () => {
  const data = new Uint8Array([7]);
  program.value = { name: "TIM.EXE", data };
  const reading = readBehaviourInBackground(data, parts);
  const walks = { status: "done", walks: {}, effects: {}, rests: {}, doings: {}, seconds: 1, perType: false } as const;
  FakeWorker.all[0]!.onmessage!({ data: { kind: "walks", result: walks } });

  program.value = { name: "TIM.EXE", data: new Uint8Array([8]) };

  expect(FakeWorker.all[0]!.ended).toBe(true);
  await expect(reading.walks).resolves.toBe(walks);
  await expect(reading.perType).resolves.toEqual({ status: "error", message: "The program was replaced." });
});

it("keeps the first walks when the loops per type can't be read, and stops showing them as still being read", () => {
  const walks = { status: "done", walks: {}, effects: {}, rests: {}, doings: {}, seconds: 1, perType: false } as const;
  expect(readingPerType(walks)).toBe(true);

  const after = walksAfterPerType(walks, { status: "error", message: "Out of memory." });

  expect(after).toEqual({ ...walks, perTypeError: "Out of memory." });
  expect(readingPerType(after)).toBe(false);
  // When the loops per type are read, their walks replace the first ones.
  const perType = { ...walks, perType: true } as const;
  expect(walksAfterPerType(walks, perType)).toBe(perType);
  expect(readingPerType(perType)).toBe(false);
  // When the first walks failed too, their error stays.
  const failed = { status: "error", message: "The program was replaced." } as const;
  expect(walksAfterPerType(failed, { status: "error", message: "Out of memory." })).toBe(failed);
});
