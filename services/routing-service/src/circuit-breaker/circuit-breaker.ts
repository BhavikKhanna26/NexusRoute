import { logger } from '../logger';
import { appConfig } from '../config';

// Circuit breaker state machine:
//
//   CLOSED ──(5 consecutive failures)──► OPEN
//     ▲                                    │
//     │                              (30s elapsed)
//     │                                    ▼
//     └──────(next call succeeds)────── HALF_OPEN
//                                          │
//                                   (next call fails)
//                                          │
//                                          ▼
//                                        OPEN
//
// CLOSED   — all calls go through normally
// OPEN     — calls are rejected immediately (fast-fail) without hitting ML Serving
// HALF_OPEN — one probe call is allowed through to test if ML Serving has recovered

type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CBState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureAt: number | null = null;

  constructor(
    private readonly failureThreshold: number,
    private readonly recoveryTimeoutMs: number,
    private readonly callTimeoutMs: number,
  ) {}

  get currentState(): CBState { return this.state; }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.lastFailureAt ?? 0);
      if (elapsed >= this.recoveryTimeoutMs) {
        this.transition('HALF_OPEN');
      } else {
        const retryInSec = Math.ceil((this.recoveryTimeoutMs - elapsed) / 1000);
        throw new Error(`Circuit breaker OPEN — ML Serving unavailable, retry in ${retryInSec}s`);
      }
    }

    try {
      // Race the actual call against a hard timeout.
      // Promise.race does not cancel the losing promise — the fetch will still run in the background
      // until the underlying TCP connection closes. That is acceptable here: the timeout
      // guarantees the CALLER unblocks within callTimeoutMs, even if the network is slow.
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`ML Serving call timed out after ${this.callTimeoutMs}ms`)), this.callTimeoutMs)
        ),
      ]);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private onSuccess(): void {
    const prev = this.state;
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    if (prev !== 'CLOSED') {
      logger.info({ from: prev }, 'Circuit breaker → CLOSED');
    }
  }

  private onFailure(reason: string): void {
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.transition('OPEN');
    } else {
      logger.warn(
        { failures: this.consecutiveFailures, threshold: this.failureThreshold, reason },
        'Circuit breaker failure recorded'
      );
    }
  }

  private transition(to: CBState): void {
    logger.warn({ from: this.state, to }, 'Circuit breaker state transition');
    this.state = to;
  }
}

// Singleton — one circuit breaker per process, shared across all Kafka consumer calls.
// Config is read from env vars so it can be tuned without a code change.
export const mlServingBreaker = new CircuitBreaker(
  appConfig.ML_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  appConfig.ML_CIRCUIT_BREAKER_RECOVERY_SECONDS * 1000,
  appConfig.ML_SERVING_TIMEOUT_MS,
);
