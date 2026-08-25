/**
 * Retrying a POD upload on a connection that keeps dropping (TRK-033).
 *
 * Warehouse connectivity fails mid-transfer, and the worst outcome is a
 * failed upload the driver believes succeeded, because nobody chases it. So
 * the retrying happens here rather than in the driver's hands.
 *
 * This retries the whole upload, not a byte range. The UploadThing client
 * exposes `signal`, `concurrency`, and `onUploadProgress` and no way to
 * resume a partial transfer, so a genuinely chunked upload is not available
 * behind this adapter. Re-sending an 8 MB photograph over 3G is a real cost;
 * it is still better than a POD that never arrives, and the idempotency key
 * means the retry lands on the same submission rather than beside it.
 */

/** Attempts in total, including the first. */
export const MAX_UPLOAD_ATTEMPTS = 4;

/**
 * Backoff between attempts, in milliseconds.
 *
 * Starts at two seconds because a dropped 3G connection rarely returns
 * sooner, and caps at sixteen so a driver watching the screen sees it try
 * again within a plausible attention span. Exponential rather than fixed: a
 * warehouse dead spot lasts either two seconds or two minutes, and a fixed
 * interval serves neither.
 */
export function backoffDelayMs(attempt: number): number {
  if (attempt < 1) {
    return 0;
  }

  return Math.min(2_000 * 2 ** (attempt - 1), 16_000);
}

/** Whether another attempt is worth making. */
export function shouldRetry(attempt: number): boolean {
  return attempt < MAX_UPLOAD_ATTEMPTS;
}

/**
 * Waits out the backoff, returning early the moment the browser reports it is
 * back online.
 *
 * The wait is a ceiling, not a schedule. A driver who walks out of a dead spot
 * should not stand there for the remaining twelve seconds of a backoff that
 * has already been answered.
 */
export async function waitBeforeRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (typeof window !== "undefined") {
        window.removeEventListener("online", finish);
      }

      signal?.removeEventListener("abort", finish);
      resolve();
    };

    const timer = setTimeout(finish, delayMs);

    if (typeof window !== "undefined") {
      window.addEventListener("online", finish, { once: true });
    }

    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Whether the browser currently believes it has a connection.
 *
 * `navigator.onLine` is famously optimistic — it reports a connected wifi
 * radio, not a working route to the internet. It is used only to skip a
 * pointless attempt, never to decide that an upload failed.
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
