const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serialises outbound calls so we stay under the key's requests/minute.
 *
 * The docs recommend ~1 request / 1.1s for bulk work; we derive the spacing from
 * the allowed rate and add a small safety margin. `penalise()` is called with a
 * `Retry-After` value on a 429 so the next `acquire()` waits the full cooldown.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(requestsPerMinute: number, safetyMarginMs = 100) {
    const rpm = Number.isFinite(requestsPerMinute) && requestsPerMinute > 0
      ? requestsPerMinute
      : 60;
    this.minIntervalMs = Math.ceil(60_000 / rpm) + safetyMarginMs;
  }

  /** Resolves when it is safe to make the next request. */
  acquire(): Promise<void> {
    const run = this.chain.then(async () => {
      const now = Date.now();
      const waitFor = Math.max(0, this.nextAllowedAt - now);
      if (waitFor > 0) await sleep(waitFor);
      this.nextAllowedAt = Math.max(Date.now(), this.nextAllowedAt) + this.minIntervalMs;
    });
    // Keep the chain from rejecting the queue if one caller throws downstream.
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Push the next allowed time out by `seconds` (from a 429 Retry-After). */
  penalise(seconds: number): void {
    const ms = Math.max(0, seconds) * 1000;
    this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + ms);
  }
}
