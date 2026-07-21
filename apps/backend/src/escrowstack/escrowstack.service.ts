import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getIndianPayoutTimestamp, signPayoutPayload } from './payout-signing';
import type {
  EscrowAccountDetailsResult,
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
    this.baseUrl = this.configService
      .get<string>('ESCROWSTACK_BASE_URL', 'https://casesdf.escrowstack.io')
      .replace(/\/$/, '');
    this.payoutUrl = this.configService
      .get<string>(
        'ESCROWSTACK_PAYOUT_URL',
        'https://payoutesfc.escrowstack.io/payout/v1/prod',
      )
      .replace(/\/$/, '');
  }

  async fetchTransactionBalance(apiKey: string): Promise<EscrowBalanceResult> {
    const response = await this.post(
      apiKey,
      '/v1/escrow/fetch_transaction_account_balance',
      {},
    );
    const balance = this.extractBalance(response);

    return {
      balance,
      raw: response,
    };
  }

  async fetchLoadAccountDetails(
    apiKey: string,
  ): Promise<EscrowAccountDetailsResult> {
    const response = await this.post(
      apiKey,
      '/v1/account/fetch_load_account_details',
      {},
    );

    return {
      merchantName: this.pickString(response, [
        'data.merchant_name',
        'data.account_name',
        'data.name',
        'merchant_name',
        'account_name',
        'name',
      ]),
      userRef: this.pickString(response, [
        'data.user_ref',
        'data.userRef',
        'user_ref',
      ]),
      virtualAccountNo: this.pickString(response, [
        'data.AC_NO',
        'data.ac_no',
        'data.virtual_account_no',
        'data.virtual_account_number',
        'data.account_no',
        'data.va_number',
        'virtual_account_no',
        'account_no',
      ]),
      escrowIfsc: this.pickString(response, [
        'data.IFSC',
        'data.ifsc',
        'data.escrow_ifsc',
        'data.ifsc_code',
        'ifsc',
        'escrow_ifsc',
      ]),
      loadInstructions: this.extractLoadInstructions(response),
      raw: response,
    };
  }

  private extractLoadInstructions(
    response: Record<string, unknown>,
  ): Record<string, string[]> | undefined {
    const data = response.data;

    if (typeof data !== 'object' || data === null) {
      return undefined;
    }

    const instructions = (data as { Instructions?: unknown }).Instructions;

    if (typeof instructions !== 'object' || instructions === null) {
      return undefined;
    }

    const parsed: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(
      instructions as Record<string, unknown>,
    )) {
      if (Array.isArray(value)) {
        parsed[key.trim()] = value.filter(
          (item): item is string => typeof item === 'string',
        );
      }
    }

    return Object.keys(parsed).length > 0 ? parsed : undefined;
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
    const data = response.data;

    if (typeof data === 'object' && data !== null && 'balance' in data) {
      const balance = Number(data.balance);

      if (!Number.isNaN(balance)) {
        return balance;
      }
    }

    if ('balance' in response) {
      const balance = Number(response.balance);

      if (!Number.isNaN(balance)) {
        return balance;
      }
    }

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
