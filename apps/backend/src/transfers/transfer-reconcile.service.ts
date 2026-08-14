import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TransfersService } from './transfers.service';

const RECONCILE_DELAYS_MS = [
  10_000, 10_000, 15_000, 15_000, 20_000, 30_000, 30_000, 45_000, 60_000,
];
const PERIODIC_RECONCILE_MS = 15 * 60 * 1000;

@Injectable()
export class TransferReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferReconcileService.name);
  private debounceTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private activeLoop = false;
  private shouldRunAgain = false;

  constructor(private readonly transfersService: TransfersService) {}

  onModuleInit(): void {
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      void this.runLoop();
    }, 15_000);
    this.intervalTimer = setInterval(() => {
      void this.runLoop();
    }, PERIODIC_RECONCILE_MS);
  }

  scheduleReconcile(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runLoop();
    }, 2000);
  }

  private async runLoop(): Promise<void> {
    if (this.activeLoop) {
      this.shouldRunAgain = true;
      return;
    }

    this.activeLoop = true;

    try {
      for (let attempt = 0; attempt <= RECONCILE_DELAYS_MS.length; attempt++) {
        const result =
          await this.transfersService.reconcileAllProcessingTransfers();

        this.logger.log(
          `Reconcile attempt ${attempt + 1}: checked=${result.checked} updated=${result.updated} stillProcessing=${result.stillProcessing}`,
        );

        if (result.stillProcessing === 0) {
          break;
        }

        if (attempt >= RECONCILE_DELAYS_MS.length) {
          break;
        }

        await this.sleep(RECONCILE_DELAYS_MS[attempt]);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Reconcile loop failed';
      this.logger.error(message);
    } finally {
      this.activeLoop = false;

      if (this.shouldRunAgain) {
        this.shouldRunAgain = false;
        void this.runLoop();
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
