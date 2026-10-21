export interface Pacer {
  /** Runs `fn` once a slot is free and at least `intervalMs` has passed since the previous start. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export interface PacerOptions {
  intervalMs: number;
  concurrency: number;
  now?: () => number;
}

/** FIFO limiter: starts are spaced by `intervalMs`, and at most `concurrency` calls are in flight. */
export function createPacer({ intervalMs, concurrency, now = Date.now }: PacerOptions): Pacer {
  const queue: Array<() => void> = [];
  let active = 0;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump(): void {
    if (timer) return;
    while (queue.length > 0 && active < concurrency) {
      const wait = lastStart + intervalMs - now();
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null;
          pump();
        }, wait);
        return;
      }
      const start = queue.shift()!;
      active++;
      lastStart = now();
      start();
    }
  }

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          fn().then(resolve, reject).finally(() => {
            active--;
            pump();
          });
        });
        pump();
      });
    },
  };
}
