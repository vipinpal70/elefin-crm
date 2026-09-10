export { ElefinApi } from "./endpoints";
export {
  ElefinClient,
  ElefinApiError,
  type ElefinClientOptions,
  type ElefinErrorCode,
  type RequestLog,
  type RequestOpts,
} from "./client";
export { RateLimiter } from "./rate-limiter";
export * from "./types";

import { ElefinApi } from "./endpoints";
import type { ElefinClientOptions } from "./client";

/** Convenience factory reading credentials from the environment. */
export function createElefinApi(opts?: ElefinClientOptions): ElefinApi {
  return new ElefinApi(opts);
}
