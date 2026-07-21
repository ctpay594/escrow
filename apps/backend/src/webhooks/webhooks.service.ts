import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import { TransfersService } from '../transfers';

type WebhookEventType = 'payout' | 'deposit' | 'unknown';

export interface WebhookRequestMeta {
  remoteIp: string | null;
  userAgent: string | null;
  requestHeaders: Record<string, string | string[]>;
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
    payload: Record<string, unknown>,
    meta: WebhookRequestMeta,
  ): Promise<{
    ok: true;
    status: 'received' | 'duplicate';
    message: string;
    service: 'escrowstack';
    event_type?: WebhookEventType;
    outcome?: string;
  }> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException({
        ok: false,
        status: 'error',
        message: 'Invalid webhook payload. Send a JSON object via POST.',
        service: 'escrowstack',
      });
    }

    if (Object.keys(payload).length === 0) {
      throw new BadRequestException({
        ok: false,
        status: 'error',
        message: 'Empty webhook body. EscrowStack should POST JSON callback data.',
        service: 'escrowstack',
      });
    }

    this.logger.log(
      `Webhook received from ${meta.remoteIp ?? 'unknown'} — keys: ${Object.keys(payload).join(', ')}`,
    );

    const eventType = this.classifyEventType(payload);
    const dedupeKey = this.buildDedupeKey(payload);
    const payoutRef = this.pickString(payload, 'payout_ref');

    const saved = await this.saveWebhookEvent({
      payload,
      eventType,
      dedupeKey,
      payoutRef,
      meta,
      processed: false,
    });

    if (saved.duplicate) {
      return {
        ok: true,
        status: 'duplicate',
        message:
          'Callback already received earlier. Duplicate ignored — no action taken.',
        service: 'escrowstack',
        event_type: eventType,
        outcome: 'duplicate_ignored',
      };
    }

    let outcome = 'stored_only';

    try {
      if (eventType === 'payout') {
        const result =
          await this.transfersService.handleEscrowPayoutWebhook(payload);
        outcome = result.outcome;
      } else if (eventType === 'deposit') {
        const result =
          await this.merchantsService.creditDepositFromWebhook(payload);
        outcome = result.outcome;
        if (result.merchantId && saved.eventId) {
          await this.attachMerchantToEvent(saved.eventId, result.merchantId);
        }
      } else {
        outcome = 'unrecognized_event_type';
      }

      await this.markWebhookProcessed(saved.eventId, outcome);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Webhook processing failed';
      this.logger.error(`Webhook processing failed: ${message}`);
      await this.markWebhookProcessed(saved.eventId, `error:${message}`);
      outcome = `error:${message}`;
    }

    return {
      ok: true,
      status: 'received',
      message: this.buildSuccessMessage(eventType, outcome),
      service: 'escrowstack',
      event_type: eventType,
      outcome,
    };
  }

  private buildSuccessMessage(
    eventType: WebhookEventType,
    outcome: string,
  ): string {
    if (outcome.startsWith('error:')) {
      return 'Callback received and saved. Processing failed — check webhook_events in Supabase.';
    }

    if (eventType === 'payout') {
      if (outcome === 'updated') {
        return 'Payout callback received. Transfer status updated.';
      }

      if (outcome === 'already_final') {
        return 'Payout callback received. Transfer was already completed.';
      }

      if (outcome === 'transfer_not_found') {
        return 'Payout callback received and saved. No matching transfer found yet.';
      }

      return 'Payout callback received and saved.';
    }

    if (eventType === 'deposit') {
      if (outcome === 'credited') {
        return 'Deposit callback received. Merchant balance credited.';
      }

      if (outcome === 'merchant_not_found') {
        return 'Deposit callback received and saved. Merchant account not matched yet.';
      }

      return 'Deposit callback received and saved.';
    }

    return 'Callback received and saved. Payload logged for review.';
  }

  private classifyEventType(
    payload: Record<string, unknown>,
  ): WebhookEventType {
    if (this.pickString(payload, 'payout_ref')) {
      return 'payout';
    }

    const amount = this.pickAmount(payload);
    const merchantKey =
      this.pickString(payload, 'virtual_account_no') ??
      this.pickString(payload, 'virtual_account_number') ??
      this.pickString(payload, 'ac_no') ??
      this.pickString(payload, 'account_no') ??
      this.pickString(payload, 'user_ref');

    if (amount !== null && amount > 0 && merchantKey) {
      return 'deposit';
    }

    return 'unknown';
  }

  private buildDedupeKey(payload: Record<string, unknown>): string {
    const code = (this.pickString(payload, 'code') ?? 'unknown').toLowerCase();
    const payoutRef = this.pickString(payload, 'payout_ref');
    const bankRef =
      this.pickString(payload, 'bankref') ??
      this.pickString(payload, 'utr') ??
      this.pickString(payload, 'txn_ref') ??
      '';

    if (payoutRef) {
      return `payout:${code}:${payoutRef}:${bankRef}`;
    }

    const amount = this.pickAmount(payload);
    const account =
      this.pickString(payload, 'virtual_account_no') ??
      this.pickString(payload, 'virtual_account_number') ??
      this.pickString(payload, 'ac_no') ??
      this.pickString(payload, 'account_no') ??
      this.pickString(payload, 'user_ref') ??
      '';

    if (amount !== null && account) {
      return `deposit:${code}:${account}:${amount}:${bankRef}`;
    }

    const hash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
      .slice(0, 32);

    return `unknown:${code}:${hash}`;
  }

  private async saveWebhookEvent(input: {
    payload: Record<string, unknown>;
    eventType: WebhookEventType;
    dedupeKey: string;
    payoutRef: string | null;
    meta: WebhookRequestMeta;
    processed: boolean;
    processResult?: string;
  }): Promise<{ eventId: string; duplicate: boolean }> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('webhook_events')
      .insert({
        source: 'escrowstack',
        event_type: input.eventType,
        dedupe_key: input.dedupeKey,
        payout_ref: input.payoutRef,
        payload: input.payload,
        remote_ip: input.meta.remoteIp,
        user_agent: input.meta.userAgent,
        request_headers: input.meta.requestHeaders,
        processed: input.processed,
        process_result: input.processResult ?? null,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      if (this.isDuplicateKeyError(error.message)) {
        return { eventId: '', duplicate: true };
      }

      if (this.isMissingWebhookTableError(error.message)) {
        this.logger.error(
          'webhook_events table missing — run migration 012_webhook_events.sql in Supabase',
        );
        throw new InternalServerErrorException(
          'Webhook storage not configured',
        );
      }

      throw new InternalServerErrorException('Failed to store webhook event');
    }

    return { eventId: (data?.id as string) ?? '', duplicate: false };
  }

  private async markWebhookProcessed(
    eventId: string,
    processResult: string,
  ): Promise<void> {
    if (!eventId) {
      return;
    }

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('webhook_events')
      .update({
        processed: true,
        process_result: processResult,
      })
      .eq('id', eventId);

    if (error) {
      this.logger.warn(`Failed to mark webhook processed: ${error.message}`);
    }
  }

  private async attachMerchantToEvent(
    eventId: string,
    merchantId: string,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('webhook_events')
      .update({ merchant_id: merchantId })
      .eq('id', eventId);

    if (error) {
      this.logger.warn(
        `Failed to attach merchant to webhook: ${error.message}`,
      );
    }
  }

  private pickString(
    payload: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = payload[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }

  private pickAmount(payload: Record<string, unknown>): number | null {
    for (const key of ['amount', 'credit_amount', 'txn_amount', 'value']) {
      const raw = payload[key];

      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }

      if (typeof raw === 'string' && raw.trim()) {
        const parsed = Number(raw);

        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }

  private isDuplicateKeyError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes('duplicate key') ||
      normalized.includes('unique constraint') ||
      normalized.includes('webhook_events_dedupe_key')
    );
  }

  private isMissingWebhookTableError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes('webhook_events') &&
      (normalized.includes('does not exist') ||
        normalized.includes('could not find'))
    );
  }
}
