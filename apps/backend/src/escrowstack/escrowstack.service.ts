import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getIndianPayoutTimestamp, signPayoutPayload } from './payout-signing';
import type {
  EscrowBalanceResult,
  PayoutItem,
  PayoutStatusEntry,
  PayoutStatusResult,
  PayoutSubmitResult,
} from './escrowstack.types';

@Injectable()
export class EscrowStackService {
  private readonly logger = new Logger(EscrowStackService.name);
  private readonly baseUrl: string;
  private readonly payoutUrl: string;

  constructor(private readonly configService: ConfigService) {
    // Live Chakatalwar passthrough (05 collection): cashdfcpt + /v1/pt/hdfc/*
    this.baseUrl = this.configService
      .get<string>('ESCROWSTACK_BASE_URL', 'https://cashdfcpt.escrowstack.io')
      .replace(/\/$/, '');
    this.payoutUrl = this.configService
      .get<string>(
        'ESCROWSTACK_PAYOUT_URL',
        'https://cashdfcpt.escrowstack.io/v1/pt/hdfc/payout',
      )
      .replace(/\/$/, '');
  }

  async fetchTransactionBalance(apiKey: string): Promise<EscrowBalanceResult> {
    const response = await this.post(
      apiKey,
      '/v1/pt/hdfc/get_account_balance',
      {},
    );
    const balance = this.extractBalance(response);
    const accountNo = this.pickString(response, [
      'data.account_no',
      'data.AC_NO',
      'account_no',
      'AC_NO',
    ]);
    const customerId = this.pickString(response, [
      'data.customer_id',
      'data.customerId',
      'customer_id',
      'customerId',
    ]);

    this.logger.log(
      `Account balance fetched: ${balance}` +
        (accountNo ? ` account_no=${accountNo}` : '') +
        (customerId ? ` customer_id=${customerId}` : ''),
    );

    return {
      balance,
      accountNo,
      customerId,
      raw: response,
    };
  }

  async submitPayout(
    apiKey: string,
    privateKey: string,
    payouts: PayoutItem[],
  ): Promise<PayoutSubmitResult> {
    const timestamp = getIndianPayoutTimestamp();
    const unsignedPayload = {
      payouts,
      timestamp,
    };

    let signature: string;

    try {
      signature = signPayoutPayload(unsignedPayload, privateKey);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to sign payout payload';
      this.logger.error('Payout signing failed', message);
      throw new BadGatewayException(message);
    }

    const signedPayload = {
      ...unsignedPayload,
      signature,
    };

    const response = await fetch(this.payoutUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(signedPayload),
      signal: AbortSignal.timeout(30000),
    });

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      this.logger.error('EscrowStack payout failed', data);
      throw new BadGatewayException(
        this.extractErrorMessage(data) ??
          `EscrowStack payout failed (${response.status})`,
      );
    }

    return { raw: data };
  }

  async getPayoutStatus(
    apiKey: string,
    payoutRefs: string[],
  ): Promise<PayoutStatusResult> {
    const uniqueRefs = [...new Set(payoutRefs.filter(Boolean))];

    if (uniqueRefs.length === 0) {
      return { entries: [], raw: {} };
    }

    const response = await this.post(apiKey, '/v1/escrow/get_payout_status', {
      payout_ref_arr: uniqueRefs,
    });

    return {
      entries: this.parsePayoutStatusEntries(response, uniqueRefs),
      raw: response,
    };
  }

  decodeMerchantNameFromApiKey(apiKey: string): string | null {
    try {
      const [, payloadSegment] = apiKey.split('.');

      if (!payloadSegment) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(
          payloadSegment.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf8'),
      ) as { name?: string };

      return payload.name ?? null;
    } catch {
      return null;
    }
  }

  private async post(
    apiKey: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      this.logger.error(`EscrowStack ${path} failed`, data);
      throw new BadGatewayException(
        this.extractErrorMessage(data) ??
          `EscrowStack request failed (${response.status})`,
      );
    }

    return data;
  }

  private extractBalance(response: Record<string, unknown>): number {
    const candidates = [
      this.readPath(response, 'data.balance'),
      this.readPath(response, 'data.avaliable_balance'),
      this.readPath(response, 'data.available_balance'),
      this.readPath(response, 'data.account_balance'),
      this.readPath(response, 'data.amount'),
      this.readPath(response, 'balance'),
      this.readPath(response, 'avaliable_balance'),
      this.readPath(response, 'available_balance'),
      this.readPath(response, 'account_balance'),
      this.readPath(response, 'amount'),
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }

      if (typeof candidate === 'string' && candidate.trim()) {
        const parsed = Number(candidate.replace(/,/g, ''));

        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    this.logger.warn(
      `Could not parse balance from EscrowStack response: ${JSON.stringify(response).slice(0, 500)}`,
    );

    return 0;
  }

  private extractErrorMessage(
    response: Record<string, unknown>,
  ): string | null {
    const data = response.data;

    if (typeof data === 'object' && data !== null) {
      const message = (data as { message?: unknown; cause?: unknown }).message;
      const cause = (data as { cause?: unknown }).cause;

      if (typeof message === 'string' && typeof cause === 'string') {
        return `${message}: ${cause}`;
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    if (typeof response.message === 'string') {
      return response.message;
    }

    return null;
  }

  private pickString(
    source: Record<string, unknown>,
    paths: string[],
  ): string | undefined {
    for (const path of paths) {
      const value = this.readPath(source, path);

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  private parsePayoutStatusEntries(
    response: Record<string, unknown>,
    requestedRefs: string[],
  ): PayoutStatusEntry[] {
    const items = this.collectPayoutStatusItems(response);
    const byRef = new Map<string, PayoutStatusEntry>();

    for (const item of items) {
      const payoutRef = this.pickString(item, [
        'payout_ref',
        'payoutRef',
        'ref',
      ]);

      if (!payoutRef) {
        continue;
      }

      const status =
        this.pickString(item, ['status', 'payout_status', 'state', 'code']) ??
        'unknown';
      const utr = this.pickString(item, ['utr', 'UTR']);
      const bankRef = this.pickString(item, [
        'bankref',
        'bank_ref',
        'bankRef',
        'crn',
        'CRN',
      ]);

      byRef.set(payoutRef, {
        payout_ref: payoutRef,
        status,
        utr,
        bank_ref: bankRef,
        raw: item,
      });
    }

    return requestedRefs
      .map((ref) => byRef.get(ref))
      .filter((entry): entry is PayoutStatusEntry => !!entry);
  }

  private collectPayoutStatusItems(
    response: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const candidates: unknown[] = [
      response.data,
      response.payouts,
      response.payout_status,
      response.results,
      response,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        );
      }

      if (typeof candidate === 'object' && candidate !== null) {
        const nested = candidate as Record<string, unknown>;

        for (const key of [
          'payouts',
          'payout_status',
          'results',
          'items',
          'data',
        ]) {
          const value = nested[key];

          if (Array.isArray(value)) {
            return value.filter(
              (item): item is Record<string, unknown> =>
                typeof item === 'object' && item !== null,
            );
          }
        }

        if (
          'payout_ref' in nested ||
          'payoutRef' in nested ||
          'status' in nested
        ) {
          return [nested];
        }
      }
    }

    return [];
  }

  private readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, source);
  }
}
