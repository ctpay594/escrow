import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EscrowStackService } from '../escrowstack';
import type { BankStatementRow } from '../escrowstack/escrowstack.types';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import {
  BANK_STATEMENT_WATERMARK_KEY,
  type BankSyncRunResult,
  type BankSyncStatus,
} from './bank-sync.types';

const IST = 'Asia/Kolkata';
const SKIP_CREDIT_PATTERNS = [
  /charge/i,
  /lien/i,
  /gst/i,
  /interest/i,
  /forex/i,
  /sweep/i,
  /reversal of reversal/i,
];

@Injectable()
export class BankSyncService {
  private readonly logger = new Logger(BankSyncService.name);
  private running = false;
  private lastDailyRunYmd: string | null = null;

  constructor(
    private readonly escrowStackService: EscrowStackService,
    private readonly merchantsService: MerchantsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  getIsRunning(): boolean {
    return this.running;
  }

  async getStatus(): Promise<BankSyncStatus> {
    const watermark = await this.getLastSyncedDate();
    const { data: lastRun } = await this.supabaseService
      .getAdminClient()
      .from('bank_statement_syncs')
      .select('started_at, status')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count } = await this.supabaseService
      .getAdminClient()
      .from('admin_notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    return {
      last_synced_date: watermark,
      last_run_at: (lastRun?.started_at as string | undefined) ?? null,
      last_run_status: (lastRun?.status as string | undefined) ?? null,
      unread_notifications: count ?? 0,
      is_running: this.running,
    };
  }

  async listRecentRuns(limit = 10) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('bank_statement_syncs')
      .select(
        'id, sync_date, trigger_type, status, credit_lines, deposits_added, deposits_skipped, unmatched_credits, started_at, completed_at, error_message, details',
      )
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerErrorException(
        error.message ?? 'Failed to load bank sync runs',
      );
    }

    return data ?? [];
  }

  async listNotifications(limit = 20) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('admin_notifications')
      .select('id, kind, title, body, payload, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (this.isMissingTable(error)) {
        return [];
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to load notifications',
      );
    }

    return data ?? [];
  }

  async markNotificationsRead(ids?: string[]) {
    const client = this.supabaseService.getAdminClient();
    const now = new Date().toISOString();

    let query = client
      .from('admin_notifications')
      .update({ read_at: now })
      .is('read_at', null);

    if (ids?.length) {
      query = query.in('id', ids);
    }

    const { error } = await query;

    if (error && !this.isMissingTable(error)) {
      throw new InternalServerErrorException(
        error.message ?? 'Failed to mark notifications read',
      );
    }

    return { message: 'Notifications updated' };
  }

  async runManualSync(): Promise<BankSyncRunResult[]> {
    return this.runSync('manual');
  }

  async runCronSync(): Promise<BankSyncRunResult[]> {
    return this.runSync('cron');
  }

  maybeRunDailyCron(): void {
    const { ymd, hour, minute } = this.istNowParts();

    if (hour !== 0 || minute > 14) {
      return;
    }

    if (this.lastDailyRunYmd === ymd) {
      return;
    }

    this.lastDailyRunYmd = ymd;
    void this.runCronSync().catch((error) => {
      this.logger.error(
        `Nightly bank sync failed: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  private async runSync(
    trigger: 'cron' | 'manual',
  ): Promise<BankSyncRunResult[]> {
    if (this.running) {
      throw new InternalServerErrorException(
        'Bank sync is already running. Try again in a few minutes.',
      );
    }

    this.running = true;
    const results: BankSyncRunResult[] = [];

    try {
      const dates = await this.resolveDatesToSync(trigger);

      if (dates.length === 0) {
        return results;
      }

      for (const syncDate of dates) {
        if (trigger === 'cron' && (await this.isDateAlreadySynced(syncDate))) {
          continue;
        }

        const result = await this.syncSingleDate(syncDate, trigger);
        results.push(result);

        if (result.status === 'completed') {
          await this.setLastSyncedDate(syncDate);
        }
      }

      return results;
    } finally {
      this.running = false;
    }
  }

  private async resolveDatesToSync(
    trigger: 'cron' | 'manual',
  ): Promise<string[]> {
    const today = this.todayYmdIst();
    const yesterday = this.shiftYmd(today, -1);
    const lastSynced = await this.getLastSyncedDate();

    if (trigger === 'cron') {
      const target = yesterday;

      if (lastSynced && lastSynced >= target) {
        return [];
      }

      if (!lastSynced) {
        return [target];
      }

      return [this.shiftYmd(lastSynced, 1)].filter((d) => d <= target);
    }

    const end = today;
    const start = lastSynced ? this.shiftYmd(lastSynced, 1) : today;

    const dates: string[] = [];
    let cursor = start;

    while (cursor <= end) {
      dates.push(cursor);
      cursor = this.shiftYmd(cursor, 1);
    }

    return dates.length > 0 ? dates : [today];
  }

  private async syncSingleDate(
    syncDate: string,
    trigger: 'cron' | 'manual',
  ): Promise<BankSyncRunResult> {
    const runId = await this.insertRun(syncDate, trigger);
    const added: BankSyncRunResult['added'] = [];
    const unmatched: BankSyncRunResult['unmatched'] = [];
    let creditLines = 0;
    let depositsAdded = 0;
    let depositsSkipped = 0;
    let unmatchedCredits = 0;

    try {
      const rows = await this.fetchStatementForDate(syncDate);
      const credits = rows.filter((row) => this.isMerchantDepositCredit(row));
      creditLines = credits.length;

      const existingUtrs = await this.loadExistingUtrs(
        credits
          .map((row) => this.normalizeUtr(row.ReferenceNo))
          .filter((utr): utr is string => !!utr),
      );

      for (const row of credits) {
        const utr = this.normalizeUtr(row.ReferenceNo);
        const amount = Number(row.TransactionAmount ?? 0);

        if (!Number.isFinite(amount) || amount <= 0) {
          continue;
        }

        if (utr && existingUtrs.has(utr)) {
          depositsSkipped += 1;
          continue;
        }

        const vaHint = this.extractVirtualAccountHint(
          row.TransactionDescription ?? '',
        );

        if (!vaHint) {
          unmatchedCredits += 1;
          unmatched.push({
            utr,
            amount,
            description: row.TransactionDescription ?? '',
            reason: 'Could not parse merchant virtual account from bank line',
          });
          continue;
        }

        const merchant =
          await this.merchantsService.findMerchantByVirtualAccountHint(vaHint);

        if (!merchant) {
          unmatchedCredits += 1;
          unmatched.push({
            utr,
            amount,
            description: row.TransactionDescription ?? '',
            reason: `No merchant for VA hint ${vaHint}`,
          });
          continue;
        }

        const dedupeKey = utr
          ? `bank_sync:${utr}`
          : `bank_sync:${syncDate}:${row.ReferenceNo ?? 'noref'}:${amount}`;

        const credited = await this.merchantsService.creditCollectDeposit({
          virtualAccount: merchant.virtualAccountNo,
          amount,
          dedupeKey,
          utr,
          remitterName: this.parseRemitterName(row.TransactionDescription ?? ''),
          remitterAccount: null,
          callbackId: null,
        });

        if (
          credited.outcome === 'credited' ||
          credited.outcome === 'already_credited'
        ) {
          if (credited.outcome === 'credited') {
            depositsAdded += 1;
            if (utr) {
              existingUtrs.add(utr);
            }

            const item = {
              utr,
              amount,
              merchant_name: merchant.merchantName,
              virtual_account: merchant.virtualAccountNo,
              description: row.TransactionDescription ?? '',
            };
            added.push(item);

            await this.createNotification({
              kind: 'bank_sync_missed_deposit',
              title: `Missed deposit credited · ${merchant.merchantName}`,
              body: `${this.formatInr(amount)}${utr ? ` · UTR ${utr}` : ''} added from HDFC statement (${syncDate}).`,
              payload: { sync_date: syncDate, ...item },
            });
          } else {
            depositsSkipped += 1;
          }
        }
      }

      const result: BankSyncRunResult = {
        sync_date: syncDate,
        trigger_type: trigger,
        status: 'completed',
        credit_lines: creditLines,
        deposits_added: depositsAdded,
        deposits_skipped: depositsSkipped,
        unmatched_credits: unmatchedCredits,
        added,
        unmatched,
      };

      await this.completeRun(runId, result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Bank sync failed';

      const failed: BankSyncRunResult = {
        sync_date: syncDate,
        trigger_type: trigger,
        status: 'failed',
        credit_lines: creditLines,
        deposits_added: depositsAdded,
        deposits_skipped: depositsSkipped,
        unmatched_credits: unmatchedCredits,
        added,
        unmatched,
        error_message: message,
      };

      await this.failRun(runId, failed, message);
      await this.createNotification({
        kind: 'bank_sync_failed',
        title: `HDFC statement sync failed · ${syncDate}`,
        body: message,
        payload: { sync_date: syncDate, trigger },
      });

      return failed;
    }
  }

  private async fetchStatementForDate(syncDate: string): Promise<BankStatementRow[]> {
    const { apiKey } = this.merchantsService.getPlatformCredentials();

    const generated = await this.escrowStackService.inspectPost(
      apiKey,
      '/v1/pt/hdfc/generate_statement',
      { start_timestamp: syncDate, end_timestamp: syncDate },
    );

    if (generated.httpStatus < 200 || generated.httpStatus >= 300) {
      throw new InternalServerErrorException(
        this.errorMessage(generated.body) ?? 'generate_statement failed',
      );
    }

    const ref = this.extractStatementRef(generated.body);

    if (!ref) {
      throw new InternalServerErrorException(
        'generate_statement did not return ref id',
      );
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (attempt > 0) {
        await this.delay(10_000);
      }

      const status = await this.escrowStackService.inspectPost(
        apiKey,
        '/v1/pt/hdfc/check_statement_generation_status',
        { ref_user_no: ref },
      );

      const cod = this.extractCodStatus(status.body);

      if (cod === 'C') {
        break;
      }

      if (cod === 'F' || cod === 'E') {
        throw new InternalServerErrorException(
          'HDFC statement generation failed',
        );
      }

      if (attempt === 23) {
        throw new InternalServerErrorException(
          'Timed out waiting for HDFC statement (codStatus still I)',
        );
      }
    }

    const downloaded = await this.escrowStackService.inspectPost(
      apiKey,
      '/v1/pt/hdfc/download_bank_statement',
      { ref_user_no: ref },
      120_000,
    );

    if (downloaded.httpStatus < 200 || downloaded.httpStatus >= 300) {
      throw new InternalServerErrorException(
        this.errorMessage(downloaded.body) ?? 'download_bank_statement failed',
      );
    }

    return this.extractStatementRows(downloaded.body);
  }

  private isMerchantDepositCredit(row: BankStatementRow): boolean {
    if (row.Debit_Credit !== 'C') {
      return false;
    }

    const description = row.TransactionDescription ?? '';

    if (SKIP_CREDIT_PATTERNS.some((pattern) => pattern.test(description))) {
      return false;
    }

    return (
      /ECMS/i.test(description) ||
      /CHAK\d+/i.test(description) ||
      !!this.extractVirtualAccountHint(description)
    );
  }

  private extractVirtualAccountHint(description: string): string | null {
    const match = description.toUpperCase().match(/CHAK[A-Z0-9]+/);

    return match?.[0] ?? null;
  }

  private parseRemitterName(description: string): string {
    const parts = description.split('-').map((part) => part.trim());

    if (parts.length >= 4) {
      return parts[parts.length - 2] || 'BANK_SYNC';
    }

    return 'BANK_SYNC';
  }

  private async loadExistingUtrs(utrs: string[]): Promise<Set<string>> {
    if (utrs.length === 0) {
      return new Set();
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('deposits')
      .select('utr')
      .in('utr', utrs);

    if (error) {
      throw new InternalServerErrorException(
        error.message ?? 'Failed to load deposit UTRs',
      );
    }

    return new Set(
      (data ?? [])
        .map((row) => this.normalizeUtr(row.utr as string | null))
        .filter((utr): utr is string => !!utr),
    );
  }

  private async insertRun(
    syncDate: string,
    trigger: 'cron' | 'manual',
  ): Promise<string> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('bank_statement_syncs')
      .insert({
        sync_date: syncDate,
        trigger_type: trigger,
        status: 'running',
      })
      .select('id')
      .single();

    if (error) {
      if (this.isMissingTable(error)) {
        throw new InternalServerErrorException(
          'bank_statement_syncs table missing — run updated 001_schema.sql in Supabase',
        );
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to start bank sync run',
      );
    }

    return data.id as string;
  }

  private async completeRun(runId: string, result: BankSyncRunResult) {
    await this.supabaseService
      .getAdminClient()
      .from('bank_statement_syncs')
      .update({
        status: 'completed',
        credit_lines: result.credit_lines,
        deposits_added: result.deposits_added,
        deposits_skipped: result.deposits_skipped,
        unmatched_credits: result.unmatched_credits,
        details: { added: result.added, unmatched: result.unmatched },
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (result.deposits_added > 0) {
      await this.createNotification({
        kind: 'bank_sync_summary',
        title: `HDFC sync · ${result.sync_date}`,
        body: `${result.deposits_added} missed deposit(s) credited. ${result.unmatched_credits} unmatched credit line(s).`,
        payload: result,
      });
    }
  }

  private async failRun(
    runId: string,
    result: BankSyncRunResult,
    message: string,
  ) {
    await this.supabaseService
      .getAdminClient()
      .from('bank_statement_syncs')
      .update({
        status: 'failed',
        credit_lines: result.credit_lines,
        deposits_added: result.deposits_added,
        deposits_skipped: result.deposits_skipped,
        unmatched_credits: result.unmatched_credits,
        details: { added: result.added, unmatched: result.unmatched },
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
  }

  private async createNotification(input: {
    kind: string;
    title: string;
    body: string;
    payload?: unknown;
  }) {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('admin_notifications')
      .insert({
        kind: input.kind,
        title: input.title,
        body: input.body,
        payload: input.payload ?? null,
      });

    if (error && !this.isMissingTable(error)) {
      this.logger.warn(`Notification insert failed: ${error.message}`);
    }
  }

  private async isDateAlreadySynced(syncDate: string): Promise<boolean> {
    const last = await this.getLastSyncedDate();

    return !!last && last >= syncDate;
  }

  private async getLastSyncedDate(): Promise<string | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('system_watermarks')
      .select('meta')
      .eq('key', BANK_STATEMENT_WATERMARK_KEY)
      .maybeSingle();

    if (error) {
      return null;
    }

    const meta = data?.meta as { last_synced_ymd?: string } | null;

    return meta?.last_synced_ymd ?? null;
  }

  private async setLastSyncedDate(ymd: string) {
    const current = await this.getLastSyncedDate();

    if (current && current >= ymd) {
      return;
    }

    await this.supabaseService
      .getAdminClient()
      .from('system_watermarks')
      .upsert(
        {
          key: BANK_STATEMENT_WATERMARK_KEY,
          checked_at: new Date(`${ymd}T23:59:59+05:30`).toISOString(),
          meta: { last_synced_ymd: ymd },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
  }

  private extractStatementRef(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    const data = record.data;

    if (typeof data === 'string' && data.length > 8) {
      return data;
    }

    return null;
  }

  private extractCodStatus(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const data = (body as Record<string, unknown>).data;

    if (!data || typeof data !== 'object') {
      return null;
    }

    const dto = (data as Record<string, unknown>).inquireRptDetailsDTO;

    if (!Array.isArray(dto) || dto.length === 0) {
      return null;
    }

    const status = (dto[0] as Record<string, unknown>).codStatus;

    return typeof status === 'string' ? status.trim() : null;
  }

  private extractStatementRows(body: unknown): BankStatementRow[] {
    if (!body || typeof body !== 'object') {
      return [];
    }

    const data = (body as Record<string, unknown>).data;

    if (!Array.isArray(data)) {
      return [];
    }

    return data.filter(
      (row): row is BankStatementRow =>
        typeof row === 'object' && row !== null,
    );
  }

  private errorMessage(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;

    if (typeof record.message === 'string') {
      return record.message;
    }

    const data = record.data;

    if (typeof data === 'object' && data !== null) {
      const message = (data as Record<string, unknown>).message;

      if (typeof message === 'string') {
        return message;
      }
    }

    return null;
  }

  private normalizeUtr(value: string | null | undefined): string | null {
    const trimmed = value?.trim();

    return trimmed ? trimmed : null;
  }

  private isMissingTable(error: { code?: string; message?: string }): boolean {
    return (
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      (error.message?.toLowerCase().includes('does not exist') ?? false)
    );
  }

  private todayYmdIst() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: IST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private shiftYmd(ymd: string, days: number) {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days))
      .toISOString()
      .slice(0, 10);
  }

  private istNowParts() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: IST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    return {
      ymd: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')),
      minute: Number(get('minute')),
    };
  }

  private formatInr(amount: number) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  }

  private delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
