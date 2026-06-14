import { afterEach, describe, expect, it, vi } from "vitest";

import { LazyRefresh } from "../worker/utils/auto_update";

class WaitUntilCollector implements Pick<ExecutionContext, "waitUntil"> {
  readonly promises: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.promises.push(promise);
  }

  async flush(): Promise<void> {
    const pending = this.promises.splice(0);
    await Promise.allSettled(pending);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("LazyRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts loading immediately and shares the initial promise", async () => {
    const ctx = new WaitUntilCollector();
    const fetcher = vi.fn(async () => "initial");

    const refresh = new LazyRefresh(fetcher, 10, ctx);

    await expect(refresh.value()).resolves.toBe("initial");
    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("initial");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns stale values while refreshing in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = new WaitUntilCollector();
    const fetcher = vi.fn(async () => (fetcher.mock.calls.length === 1 ? "initial" : "updated"));
    const refresh = new LazyRefresh(fetcher, 10, ctx);

    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("initial");

    vi.setSystemTime(11_000);
    await expect(refresh.value()).resolves.toBe("initial");
    expect(fetcher).toHaveBeenCalledTimes(2);

    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("updated");
  });

  it("keeps one refresh in flight until cleanup completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = new WaitUntilCollector();
    const refreshes: Array<ReturnType<typeof deferred<string>>> = [];
    const fetcher = vi.fn(() => {
      const next = deferred<string>();
      refreshes.push(next);
      return next.promise;
    });
    const refresh = new LazyRefresh(fetcher, 10, ctx);

    await Promise.resolve();
    refreshes[0]?.resolve("initial");
    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("initial");

    vi.setSystemTime(11_000);
    await expect(refresh.value()).resolves.toBe("initial");
    await expect(refresh.value()).resolves.toBe("initial");
    expect(fetcher).toHaveBeenCalledTimes(2);

    await Promise.resolve();
    refreshes[1]?.resolve("updated");
    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("updated");

    vi.setSystemTime(22_000);
    await expect(refresh.value()).resolves.toBe("updated");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good value when a background refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = new WaitUntilCollector();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("initial")
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("recovered");
    const refresh = new LazyRefresh(fetcher, 10, ctx);

    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("initial");

    vi.setSystemTime(11_000);
    await expect(refresh.value()).resolves.toBe("initial");
    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("initial");
    expect(consoleError).toHaveBeenCalledTimes(1);

    vi.setSystemTime(22_000);
    await expect(refresh.value()).resolves.toBe("initial");
    await ctx.flush();
    await expect(refresh.value()).resolves.toBe("recovered");
  });

  it("treats synchronous fetcher throws as refresh failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = new WaitUntilCollector();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<() => Promise<string>>(() => {
      if (fetcher.mock.calls.length === 1) {
        throw new Error("sync failure");
      }
      return Promise.resolve("recovered");
    });
    const refresh = new LazyRefresh(fetcher, 10, ctx);

    await expect(refresh.value()).rejects.toThrow("sync failure");
    await ctx.flush();
    expect(consoleError).toHaveBeenCalledTimes(1);

    await expect(refresh.value()).resolves.toBe("recovered");
  });
});
