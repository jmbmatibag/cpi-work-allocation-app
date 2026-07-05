/**
 * Throttled batch processor.
 *
 * Runs an async `worker` over `items` in small fixed-size chunks, waiting for
 * each chunk to settle before starting the next, with an optional pause
 * between chunks. This deliberately caps how many `worker` calls are ever
 * in-flight at once.
 *
 * The motivating case is bulk email: Office 365 / Outlook SMTP rejects a
 * flood of simultaneous connections with `432 4.3.2 Concurrent connections
 * limit exceeded`. Sending in chunks of 3–5 with a ~1–2s gap keeps us under
 * that ceiling while still being far faster than a strict one-at-a-time loop.
 *
 * Never rejects: like `Promise.allSettled`, every item resolves to a result
 * object carrying either its `value` or its `reason`, so one failure can't
 * abort the run or lose the successes.
 */

export interface BatchOptions {
  /**
   * Max concurrent `worker` calls per chunk. Keep small (3–5) for SMTP.
   * Values < 1 are clamped to 1. Defaults to 4.
   */
  batchSize?: number;
  /**
   * Pause between chunks, in milliseconds. Not applied after the final
   * chunk. Defaults to 1000ms. Set to 0 to disable.
   */
  delayMs?: number;
  /**
   * Optional hook fired after each chunk settles — useful for streaming
   * progress. Receives the running count of processed items and the total.
   */
  onChunk?: (processed: number, total: number) => void;
}

export interface BatchItemResult<T, R> {
  item: T;
  status: 'fulfilled' | 'rejected';
  /** Present when `status === 'fulfilled'`. */
  value?: R;
  /** Present when `status === 'rejected'`. */
  reason?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processInBatches<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {},
): Promise<BatchItemResult<T, R>[]> {
  const batchSize = Math.max(1, options.batchSize ?? 4);
  const delayMs = options.delayMs ?? 1000;
  const results: BatchItemResult<T, R>[] = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const chunk = items.slice(start, start + batchSize);
    const settled = await Promise.allSettled(
      chunk.map((item, i) => worker(item, start + i)),
    );

    settled.forEach((s, i) => {
      const item = chunk[i];
      if (s.status === 'fulfilled') {
        results.push({ item, status: 'fulfilled', value: s.value });
      } else {
        results.push({ item, status: 'rejected', reason: s.reason });
      }
    });

    options.onChunk?.(results.length, items.length);

    // Pause before the next chunk — skip the wait after the last one.
    const hasMore = start + batchSize < items.length;
    if (hasMore && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return results;
}
