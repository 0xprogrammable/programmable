import { describe, expect, it } from "vitest";
import { moduleLaunchRequestPromise } from "@/lib/module-mode/launch-workspace";

describe("React Flight module availability", () => {
  it("makes a non-chainable fulfilled thenable safe for availability observers", async () => {
    const value = { release: "reviewed", catalog: [] };
    const flight = { then(resolve: (result: typeof value) => void) { resolve(value); } };
    expect(flight.then(() => {})).toBeUndefined();
    const observed = moduleLaunchRequestPromise(flight as unknown as PromiseLike<typeof value>)
      .then(result => result.release)
      .catch(() => "unavailable");
    expect(await observed).toBe("reviewed");
  });

  it("routes a rejected Flight thenable through the existing unavailable handler", async () => {
    const failure = new Error("Source stream unavailable");
    const flight = { then(_resolve: unknown, reject: (error: Error) => void) { reject(failure); } };
    const observed = moduleLaunchRequestPromise(flight as unknown as PromiseLike<never>)
      .then(() => "available")
      .catch(error => error);
    expect(await observed).toBe(failure);
  });
});
