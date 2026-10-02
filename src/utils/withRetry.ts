export interface RetryOptions {
    attempts: number;
    baseDelayMs: number;
    onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls fn up to `attempts` times with exponential backoff
 * (baseDelayMs, 2*baseDelayMs, 4*baseDelayMs, ...). Rethrows the last error.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= opts.attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === opts.attempts) break;
            const delayMs = opts.baseDelayMs * 2 ** (attempt - 1);
            opts.onRetry?.(err, attempt, delayMs);
            await sleep(delayMs);
        }
    }
    throw lastErr;
}
