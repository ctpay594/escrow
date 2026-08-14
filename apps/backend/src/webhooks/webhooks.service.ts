import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import { TransfersService } from '../transfers';

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

    this.applyInBackground(body).catch((error: unknown) => {
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
      })
      .select('id')
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to save callback: ${error.message}`);

      if (
        error.message.toLowerCase().includes('callbacks') &&
        (error.message.toLowerCase().includes('does not exist') ||
          error.message.toLowerCase().includes('could not find'))
      ) {
        throw new InternalServerErrorException(
          'Run migration 014_simple_callbacks.sql in Supabase first',
        );
      }

      throw new InternalServerErrorException('Failed to save callback');
    }

    return (data?.id as string) ?? null;
  }

  private async applyInBackground(
    body: Record<string, unknown>,
  ): Promise<void> {
    if (typeof body.payout_ref === 'string' && body.payout_ref.trim()) {
      await this.transfersService.handleEscrowPayoutWebhook(body);
      return;
    }

    await this.merchantsService.creditDepositFromWebhook(body);
  }
}
