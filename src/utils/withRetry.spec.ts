import { withRetry } from './withRetry';

describe('withRetry', () => {
    it('returns the result on first success without retrying', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after failures and resolves once the call succeeds', async () => {
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error('a'))
            .mockRejectedValueOnce(new Error('b'))
            .mockResolvedValue('ok');
        const onRetry = jest.fn();
        await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0, onRetry })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('throws the last error after exhausting attempts', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('down'));
        await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('down');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('waits with exponential backoff between attempts', async () => {
        jest.useFakeTimers();
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error('a'))
            .mockRejectedValueOnce(new Error('b'))
            .mockResolvedValue('ok');
        const p = withRetry(fn, { attempts: 3, baseDelayMs: 1000 });
        await Promise.resolve();
        expect(fn).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1000);
        expect(fn).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1999);
        expect(fn).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        expect(fn).toHaveBeenCalledTimes(3);
        await expect(p).resolves.toBe('ok');
        jest.useRealTimers();
    });
});
