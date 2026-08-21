import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { TransfersService } from './transfers.service';

/** Short follow-ups after approve only — periodic cron stays single-pass + watermark. */
const POST_APPROVE_DELAYS_MS = [10_000, 20_000, 30_000];
const PERIODIC_RECONCILE_MS = 15 * 60 * 1000;
/** Hard stop so a stuck EscrowStack never owns the process for minutes. */
const MAX_LOOP_MS = 90_000;

@Injectable()
export class TransferReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferReconcileService.name);
  private debounceTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private activeLoop = false;
  private shouldRunAgain = false;

  constructor(
    @Inject(forwardRef(() => TransfersService))
    private readonly transfersService: TransfersService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      void this.runLoop({ maxAttempts: 1, incremental: true });
    }, 15_000);
    this.intervalTimer = setInterval(() => {
      void this.runLoop({ maxAttempts: 1, incremental: true });
    }, PERIODIC_RECONCILE_MS);
  }

  /** After approve — check open PROCESSING; does not advance the global watermark. */
  scheduleReconcile(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runLoop({
        maxAttempts: POST_APPROVE_DELAYS_MS.length + 1,
        incremental: false,
      });
    }, 2000);
  }

  private async runLoop(options?: {
    maxAttempts?: number;
    incremental?: boolean;
  }): Promise<void> {
    if (this.activeLoop) {
      this.shouldRunAgain = true;
      return;
    }

    this.activeLoop = true;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 1);
    const incremental = options?.incremental === true;
    const startedAt = Date.now();

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (Date.now() - startedAt > MAX_LOOP_MS) {
          this.logger.warn(
            `Reconcile loop stopped after ${MAX_LOOP_MS}ms wall clock`,
          );
          break;
        }

        const result = await this.transfersService.reconcileAllProcessingTransfers(
          { incremental },
        );

        this.logger.log(
          `Reconcile attempt ${attempt + 1}/${maxAttempts} incremental=${incremental}: checked=${result.checked} updated=${result.updated} stillProcessing=${result.stillProcessing} since=${result.since ?? '-'} watermark=${result.watermarkAdvancedTo ?? '-'}`,
        );

        if (result.stillProcessing === 0) {
          break;
        }

        if (attempt + 1 >= maxAttempts) {
          break;
        }

        const delay =
          POST_APPROVE_DELAYS_MS[
            Math.min(attempt, POST_APPROVE_DELAYS_MS.length - 1)
          ] ?? 10_000;
        await this.sleep(delay);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Reconcile loop failed';
      this.logger.error(message);
    } finally {
      this.activeLoop = false;

      if (this.shouldRunAgain) {
        this.shouldRunAgain = false;
        void this.runLoop({ maxAttempts: 1, incremental: true });
      }
    }
  }

  onModuleDestroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
    }

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
