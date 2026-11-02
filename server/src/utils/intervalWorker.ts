export interface IntervalWorker {
  start(): void;
  stop(): Promise<void>;
}

export function createIntervalWorker(
  task: () => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void,
): IntervalWorker {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('Interval worker interval must be a positive number');
  }

  let timer: NodeJS.Timeout | undefined;
  let activeRun: Promise<void> | undefined;
  let stopped = false;

  const run = (): Promise<void> => {
    if (stopped || activeRun) return activeRun ?? Promise.resolve();

    const execution = (async () => {
      try {
        await task();
      } catch (error) {
        try {
          onError(error);
        } catch (reportingError) {
          process.emitWarning(
            `Interval worker error handler failed: ${String(reportingError)}`,
          );
        }
      }
    })();
    activeRun = execution.finally(() => {
      activeRun = undefined;
    });
    return activeRun;
  };

  return {
    start(): void {
      if (stopped || timer) return;
      timer = setInterval(() => {
        void run();
      }, intervalMs);
      timer.unref();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await activeRun;
    },
  };
}
