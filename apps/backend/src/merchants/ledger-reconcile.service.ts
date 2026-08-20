import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseService } from '../supabase';
import { MerchantsService } from './merchants.service';

const PENDING_CHECK_MS = 20 * 60 * 1000;
const DEEP_CHECK_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 25_000;

const WATERMARK_PENDING = 'ledger_pending_check';
const WATERMARK_DEEP = 'ledger_deep_check';

@Injectable()
export class LedgerReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerReconcileService.name);
  private pendingTimer: NodeJS.Timeout | null = null;
  private deepTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private pendingRunning = false;
  private deepRunning = false;

  constructor(
    private readonly merchantsService: MerchantsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  onModuleInit(): void {
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runPendingCheck('startup');
    }, STARTUP_DELAY_MS);

    this.pendingTimer = setInterval(() => {
      void this.runPendingCheck('interval');
    }, PENDING_CHECK_MS);

    this.deepTimer = setInterval(() => {
      void this.runDeepCheck('interval');
    }, DEEP_CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
    }
    if (this.pendingTimer) {
      clearInterval(this.pendingTimer);
    }
    if (this.deepTimer) {
      clearInterval(this.deepTimer);
    }
  }

  /** Every ~20 min: pending vs open transfers; auto-heal stuck ghost pending. */
  async runPendingCheck(source: string): Promise<void> {
    if (this.pendingRunning) {
      return;
    }

    this.pendingRunning = true;
    const startedAt = new Date().toISOString();

    try {
      const merchants = await this.merchantsService.listMerchantLedgerSnapshots();
      let healed = 0;
      let mismatches = 0;

      for (const merchant of merchants) {
        if (merchant.pendingBalance <= 0) {
          continue;
        }

        const result = await this.merchantsService.healStuckPendingBalance(
          merchant.userId,
        );

        if (result.healed) {
          healed += 1;
          this.logger.warn(
            `Pending heal (${source}) ${merchant.merchantName}: pending ${result.pendingBefore}→0 real ${result.realBefore}→${result.realAfter}`,
          );
          continue;
        }

        if (result.reason.startsWith('pending_mismatch_open:')) {
          mismatches += 1;
          this.logger.warn(
            `Pending mismatch (${source}) ${merchant.merchantName}: pending=${result.pendingBefore} ${result.reason}`,
          );
        }
      }

      await this.setWatermark(WATERMARK_PENDING, startedAt, {
        source,
        merchants: merchants.length,
        healed,
        mismatches,
      });

      this.logger.log(
        `Pending check (${source}): merchants=${merchants.length} healed=${healed} mismatches=${mismatches}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Pending check failed';
      this.logger.error(message);
    } finally {
      this.pendingRunning = false;
    }
  }

  /**
   * Every ~6h: only scan transfers/deposits since last watermark.
   * Verifies SUCCESS rows have payout_success ledger lines; advances stamp.
   */
  async runDeepCheck(source: string): Promise<void> {
    if (this.deepRunning) {
      return;
    }

    this.deepRunning = true;
    const startedAt = new Date().toISOString();

    try {
      const since =
        (await this.getWatermark(WATERMARK_DEEP)) ??
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const client = this.supabaseService.getAdminClient();
      const { data: successes, error } = await client
        .from('transfers')
        .select('id, amount, user_id, status, created_at')
        .eq('status', 'SUCCESS')
        .gt('created_at', since)
        .not('user_id', 'is', null)
        .limit(2000);

      if (error) {
        throw new Error(error.message);
      }

      let missingLedger = 0;

      for (const transfer of successes ?? []) {
        const { data: led, error: ledError } = await client
          .from('ledger_entries')
          .select('id')
          .eq('reason', 'payout_success')
          .eq('ref_id', transfer.id as string)
          .maybeSingle();

        if (ledError) {
          if (
            ledError.message.toLowerCase().includes('ledger_entries') &&
            ledError.message.toLowerCase().includes('does not exist')
          ) {
            break;
          }
          throw new Error(ledError.message);
        }

        if (!led) {
          missingLedger += 1;
          this.logger.warn(
            `Deep check missing payout_success ledger for transfer ${transfer.id} amount=${transfer.amount}`,
          );
        }
      }

      // Also run pending heal in deep pass
      await this.runPendingCheck(`deep:${source}`);

      await this.setWatermark(WATERMARK_DEEP, startedAt, {
        source,
        since,
        successRows: (successes ?? []).length,
        missingLedger,
      });

      this.logger.log(
        `Deep check (${source}): since=${since} successRows=${(successes ?? []).length} missingLedger=${missingLedger}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Deep check failed';
      this.logger.error(message);
    } finally {
      this.deepRunning = false;
    }
  }

  private async getWatermark(key: string): Promise<string | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('system_watermarks')
      .select('checked_at')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message.toLowerCase().includes('system_watermarks')
      ) {
        return null;
      }

      this.logger.warn(`Watermark read failed: ${error.message}`);
      return null;
    }

    return (data?.checked_at as string | undefined) ?? null;
  }

  private async setWatermark(
    key: string,
    checkedAt: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('system_watermarks')
      .upsert(
        {
          key,
          checked_at: checkedAt,
          meta,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message.toLowerCase().includes('system_watermarks')
      ) {
        this.logger.warn(
          'system_watermarks table missing — run 001_schema.sql watermark section',
        );
        return;
      }

      this.logger.warn(`Watermark write failed: ${error.message}`);
    }
  }
}
