type WaitUntilContext = Pick<ExecutionContext, "waitUntil">;

export class LazyRefresh<T> {
  private cached: Promise<T>;
  private hasCachedValue = false;
  private nextRefreshTimestampSeconds = 0;
  private refreshInFlight: Promise<T> | null = null;
  private readonly fetcher: () => Promise<T>;
  private readonly ttlSeconds: number;
  private readonly ctx: WaitUntilContext;

  constructor(fetcher: () => Promise<T>, ttlSeconds: number, ctx: WaitUntilContext) {
    this.fetcher = fetcher;
    this.ttlSeconds = ttlSeconds;
    this.ctx = ctx;
    this.cached = this.startRefresh({ replaceCachedWhilePending: true });
  }

  /**
   * Returns the current value immediately, even if stale, and refreshes stale values in the background.
   */
  value(): Promise<T> {
    if (this.shouldRefresh()) {
      this.startRefresh({ replaceCachedWhilePending: !this.hasCachedValue });
    }
    return this.cached;
  }

  private shouldRefresh(): boolean {
    return this.refreshInFlight === null && this.nowSeconds() >= this.nextRefreshTimestampSeconds;
  }

  private startRefresh(options: { replaceCachedWhilePending: boolean }): Promise<T> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refresh = Promise.resolve()
      .then(() => this.fetcher())
      .then((value) => {
        this.cached = Promise.resolve(value);
        this.hasCachedValue = true;
        this.nextRefreshTimestampSeconds = this.nowSeconds() + this.ttlSeconds;
        return value;
      })
      .catch((error: unknown) => {
        if (!this.hasCachedValue) {
          this.nextRefreshTimestampSeconds = this.nowSeconds();
          throw error;
        }

        this.nextRefreshTimestampSeconds = this.nowSeconds() + this.ttlSeconds;
        console.error("lazy refresh failed", { error });
        return this.cached;
      })
      .finally(() => {
        // We are sure `this.refreshInFlight` is "this" refresh variable because we immediately assigns `refresh` to `this.refreshInFlight`
        // after defining `refresh` variable.
        this.refreshInFlight = null;
      });

    this.refreshInFlight = refresh;
    if (options.replaceCachedWhilePending) {
      this.cached = refresh;
    }

    this.ctx.waitUntil(
      refresh.then(
        () => undefined,
        (error: unknown) => {
          console.error("lazy refresh failed", { error });
        },
      ),
    );
    return refresh;
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
