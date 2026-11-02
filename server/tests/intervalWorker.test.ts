import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIntervalWorker } from '../src/utils/intervalWorker';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('interval worker lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips scheduled triggers while an earlier run is active', async () => {
    vi.useFakeTimers();
    const activeRun = deferred();
    let runs = 0;
    const worker = createIntervalWorker(
      async () => {
        runs += 1;
        if (runs === 1) await activeRun.promise;
      },
      1000,
      vi.fn(),
    );

    worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runs).toBe(1);

    activeRun.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    await worker.stop();
  });

  it('stops future triggers and waits for an active run during shutdown', async () => {
    vi.useFakeTimers();
    const activeRun = deferred();
    let runs = 0;
    const worker = createIntervalWorker(
      async () => {
        runs += 1;
        await activeRun.promise;
      },
      1000,
      vi.fn(),
    );

    worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    const stopping = worker.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);
    activeRun.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(3000);

    expect(stopped).toBe(true);
    expect(runs).toBe(1);
  });

  it('reports a failed run and continues on the next scheduled trigger', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    let runs = 0;
    const worker = createIntervalWorker(
      async () => {
        runs += 1;
        if (runs === 1) throw new Error('test run failed');
      },
      1000,
      onError,
    );

    worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await worker.stop();

    expect(onError).toHaveBeenCalledOnce();
    expect(runs).toBe(2);
  });
});
