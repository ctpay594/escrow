import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import { TransfersService } from '../transfers';
import { parseCollectAlerts } from './collect-alerts';

export interface WebhookRequestMeta {
  remoteIp: string | null;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly transfersService: TransfersService,
    private readonly merchantsService: MerchantsService,
  ) {}

  async handleEscrowStackWebhook(
    payload: unknown,
    meta: WebhookRequestMeta,
  ): Promise<{
    ok: true;
    message: string;
    saved_id: string | null;
  }> {
    const body = this.normalizeBody(payload);

    this.logger.log(
      `Callback received from ${meta.remoteIp ?? 'unknown'}: ${JSON.stringify(body).slice(0, 400)}`,
    );

    const savedId = await this.saveCallback(body, meta.remoteIp);

    this.applyInBackground(body, savedId).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Callback apply failed';
      this.logger.warn(message);
    });

    return {
      ok: true,
      message: 'Callback saved. Check Supabase table: callbacks',
      saved_id: savedId,
    };
  }

  async replayStoredCollects(): Promise<void> {
    await this.replayUnprocessedCallbacks(null);
  }

  private normalizeBody(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;

      if (Object.keys(record).length > 0) {
        return record;
      }

      return { _note: 'empty json object' };
    }

    if (Array.isArray(payload)) {
      return { _array: payload };
    }

    if (payload === undefined || payload === null || payload === '') {
      return { _note: 'empty body' };
    }

    return { _raw: payload };
  }

  private async saveCallback(
    body: Record<string, unknown>,
    fromIp: string | null,
  ): Promise<string | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('callbacks')
      .insert({
        from_ip: fromIp,
        body,
        processed: false,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to save callback: ${error.message}`);
      throw new InternalServerErrorException('Failed to save callback');
    }

    return (data?.id as string) ?? null;
  }

  private async applyInBackground(
    body: Record<string, unknown>,
    callbackId: string | null,
  ): Promise<void> {
    const result = await this.applyBody(body, callbackId);

    if (callbackId) {
      await this.markCallback(callbackId, result);
    }

    await this.replayUnprocessedCallbacks(callbackId);
  }

  private async applyBody(
    body: Record<string, unknown>,
    callbackId: string | null,
  ): Promise<string> {
    const payoutBodies = this.extractPayoutWebhookBodies(body);

    if (payoutBodies.length > 0) {
      const outcomes: string[] = [];

      for (const payoutBody of payoutBodies) {
        const result =
          await this.transfersService.handleEscrowPayoutWebhook(payoutBody);
        outcomes.push(result.outcome);
      }

      return `payout_webhook:${outcomes.join(',')}`;
    }

    const alerts = parseCollectAlerts(body);

    if (alerts.length > 0) {
      const outcomes: string[] = [];

      for (const alert of alerts) {
        const credited = await this.merchantsService.creditCollectDeposit({
          virtualAccount: alert.virtualAccount,
          amount: alert.amount,
          dedupeKey: alert.dedupeKey,
          utr: alert.utr,
          remitterName: alert.remitterName,
          remitterAccount: alert.remitterAccount,
          callbackId,
        });

        outcomes.push(
          `${alert.virtualAccount}:${credited.outcome}:${alert.amount}`,
        );
      }

      return outcomes.join('; ');
    }

    return 'ignored_not_collect_or_payout';
  }

  private extractPayoutWebhookBodies(
    body: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    const data = body.data;

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const allRecords = (data as { ALL_RECORDS?: unknown }).ALL_RECORDS;
      if (Array.isArray(allRecords)) {
        for (const item of allRecords) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            records.push(item as Record<string, unknown>);
          }
        }
      }
    }

    if (
      typeof body.payout_ref === 'string' ||
      typeof body.PAYMENTREFNO === 'string'
    ) {
      records.push(body);
    }

    return records;
  }

  private async markCallback(
    callbackId: string,
    processResult: string,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('callbacks')
      .update({
        processed: true,
        process_result: processResult.slice(0, 500),
      })
      .eq('id', callbackId);

    if (error) {
      this.logger.warn(`Could not mark callback processed: ${error.message}`);
    }
  }

  private async replayUnprocessedCallbacks(
    skipId: string | null,
  ): Promise<void> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('callbacks')
      .select('id, body')
      .eq('processed', false)
      .order('received_at', { ascending: true })
      .limit(50);

    if (error || !data) {
      return;
    }

    for (const row of data) {
      const id = row.id as string;

      if (skipId && id === skipId) {
        continue;
      }

      const body =
        row.body && typeof row.body === 'object' && !Array.isArray(row.body)
          ? (row.body as Record<string, unknown>)
          : null;

      if (!body) {
        await this.markCallback(id, 'ignored_invalid_body');
        continue;
      }

      const result = await this.applyBody(body, id);
      await this.markCallback(id, result);
    }
  }
}
