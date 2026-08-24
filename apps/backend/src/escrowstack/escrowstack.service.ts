import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getIndianPayoutTimestamp, signPayoutPayload } from './payout-signing';
import type {
  EscrowBalanceResult,
  PayoutItem,
  PayoutStatusEntry,
  PayoutStatusQuery,
  PayoutStatusResult,
  PayoutSubmitResult,
} from './escrowstack.types';

@Injectable()
export class EscrowStackService {
  private readonly logger = new Logger(EscrowStackService.name);
  private readonly baseUrl: string;
  private readonly payoutUrl: string;

  constructor(private readonly configService: ConfigService) {
    // Live collection: cashdfcpt + /v1/pt/hdfc/*
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
    const breakdown = this.extractBalanceBreakdown(response);
    // HDFC: clear/balance = spendable; avaliable_balance = clear + hold (total).
    const clear =
      breakdown.clear ??
      this.extractClearBalance(response) ??
      this.extractBalance(response);
    const total = breakdown.total ?? clear;
    const accountNo = this.pickString(response, [
      'data.account_no',
      'data.AC_NO',
      'account_no',
      'AC_NO',
    ]);
    const customerId =
      this.pickString(response, [
        'data.customer_id',
        'data.customerId',
        'customer_id',
        'customerId',
      ]) ?? this.pickNumericString(response, ['data.customer_id']);

    this.logger.log(
      `Account balance fetched: remaining=${clear} total=${total}` +
        (breakdown.hold != null ? ` lien=${breakdown.hold}` : '') +
        (accountNo ? ` account_no=${accountNo}` : ''),
    );

    return {
      balance: clear,
      totalBalance: total,
      availableBalance: clear,
      holdAmount: breakdown.hold,
      lienAmount: breakdown.lien ?? breakdown.hold,
      unclearAmount: breakdown.unclear,
      ledgerBalance: breakdown.ledger,
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
      payouts: payouts.map((payout) => this.toLivePayoutItem(payout)),
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

    if (!response.ok || this.isJsonErrorStatus(data)) {
      const message =
        this.extractErrorMessage(data) ??
        `EscrowStack payout failed (${response.status})`;
      this.logger.error(`EscrowStack payout failed: ${message}`);
      throw new BadGatewayException(message);
    }

    const code = typeof data.code === 'string' ? data.code.trim() : '';

    if (code && code !== 'EL_PS') {
      const message =
        this.extractErrorMessage(data) ?? `EscrowStack payout rejected (${code})`;
      this.logger.error(message);
      throw new BadGatewayException(message);
    }

    return { raw: data };
  }

  async getPayoutStatus(
    apiKey: string,
    queries: PayoutStatusQuery[],
  ): Promise<PayoutStatusResult> {
    const seen = new Set<string>();
    const unique = queries.filter((query) => {
      const payoutRef = query.payoutRef?.trim();

      if (!payoutRef) {
        return false;
      }

      const key = `${payoutRef}|${query.txnDate}|${query.mode}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    if (unique.length === 0) {
      return { entries: [], raw: {} };
    }

    const entries: PayoutStatusEntry[] = [];
    const rawByRef: Record<string, unknown> = {};

    for (const query of unique) {
      try {
        const response = await this.post(
          apiKey,
          '/v1/pt/hdfc/get_payout_status',
          {
            payout_ref: query.payoutRef,
            txn_date: query.txnDate,
            mode: query.mode,
          },
        );
        rawByRef[query.payoutRef] = response;
        const parsed = this.parsePayoutStatusEntries(response, [
          query.payoutRef,
        ]);

        if (parsed[0]) {
          this.logger.log(
            `get_payout_status ${query.payoutRef} date=${query.txnDate} mode=${query.mode} txn=${parsed[0].status} utr=${parsed[0].utr ?? '-'}`,
          );
          this.upsertStatusEntry(entries, parsed[0]);
        } else {
          this.logger.warn(
            `Unrecognized get_payout_status shape for ${query.payoutRef} date=${query.txnDate}: ${JSON.stringify(response).slice(0, 400)}`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Status lookup failed';
        this.logger.warn(
          `get_payout_status failed for ${query.payoutRef}: ${message}`,
        );
      }
    }

    return { entries, raw: rawByRef };
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
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.postOnce(apiKey, path, body);
      } catch (error) {
        lastError = error;

        if (error instanceof BadGatewayException) {
          throw error;
        }

        if (!this.isRetryableNetworkError(error) || attempt === 3) {
          break;
        }

        this.logger.warn(
          `EscrowStack ${path} attempt ${attempt} failed (${this.networkErrorMessage(error)}); retrying`,
        );
        await this.delay(250 * attempt);
      }
    }

    const message = this.networkErrorMessage(lastError);
    this.logger.error(`EscrowStack ${path} failed: ${message}`);
    throw new BadGatewayException(message);
  }

  private async postOnce(
    apiKey: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Live collection: POST {{live}}/v1/pt/hdfc/* with header `apikey` only
    // (do not also send ApiKey). Get Account Balance body is {}.
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

    if (!response.ok || this.isJsonErrorStatus(data)) {
      const message =
        this.extractErrorMessage(data) ??
        `EscrowStack request failed (${response.status})`;
      this.logger.error(`EscrowStack ${path} failed: ${message}`);
      throw new BadGatewayException(message);
    }

    return data;
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (error instanceof BadGatewayException) {
      return false;
    }

    const message = this.networkErrorMessage(error).toLowerCase();

    return (
      message.includes('fetch failed') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('socket') ||
      message.includes('ssl') ||
      message.includes('tls')
    );
  }

  private networkErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const cause =
        error.cause instanceof Error ? ` (${error.cause.message})` : '';
      return `${error.message}${cause}`;
    }

    return 'EscrowStack request failed';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private extractBalance(response: Record<string, unknown>): number {
    const candidates = [
      this.readPath(response, 'data.balance'),
      this.readPath(response, 'data.avaliable_balance'),
      this.readPath(response, 'data.available_balance'),
      this.readPath(response, 'data.clear_balance'),
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

  private extractClearBalance(
    response: Record<string, unknown>,
  ): number | undefined {
    const candidates = [
      this.readPath(response, 'data.clear_balance'),
      this.readPath(response, 'data.balance'),
      this.readPath(response, 'clear_balance'),
      this.readPath(response, 'balance'),
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

    return undefined;
  }

  private extractBalanceBreakdown(response: Record<string, unknown>): {
    /** HDFC avaliable_balance = clear + hold */
    total?: number;
    /** Spendable clear balance */
    clear?: number;
    hold?: number;
    lien?: number;
    unclear?: number;
    ledger?: number;
  } {
    const amounts = this.collectNumericFields(response);
    const pickExact = (...needles: string[]) => {
      for (const needle of needles) {
        for (const [key, value] of amounts) {
          if (key === needle || key.endsWith(`.${needle}`)) {
            return value;
          }
        }
      }

      return undefined;
    };
    const pickIncludes = (...needles: string[]) => {
      for (const [key, value] of amounts) {
        if (needles.some((needle) => key.includes(needle))) {
          return value;
        }
      }

      return undefined;
    };

    return {
      total: pickExact(
        'avaliable_balance',
        'available_balance',
        'data.avaliable_balance',
        'data.available_balance',
      ),
      clear: pickExact(
        'clear_balance',
        'data.clear_balance',
        'balance',
        'data.balance',
      ),
      hold: pickIncludes('hold_amount', 'holdamt', 'hold_amt', 'achold'),
      lien: pickIncludes('lien_amount', 'lienamt', 'lien_amt', 'aclien'),
      unclear: pickIncludes('unclear', 'float'),
      ledger: pickIncludes('ledger_balance', 'acledger'),
    };
  }

  private collectNumericFields(
    value: unknown,
    prefix = '',
    into: Array<[string, number]> = [],
  ): Array<[string, number]> {
    if (typeof value === 'number' && Number.isFinite(value)) {
      into.push([prefix, value]);
      return into;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed) && prefix) {
        into.push([prefix, parsed]);
      }
      return into;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        this.collectNumericFields(item, `${prefix}[${index}]`, into);
      });
      return into;
    }

    if (typeof value === 'object' && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        const next = `${prefix}${prefix ? '.' : ''}${key}`.toLowerCase();
        this.collectNumericFields(nested, next, into);
      }
    }

    return into;
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
        'PAYMENTREFNO',
        'payout_ref',
        'payoutRef',
        'ref',
        'REFERENCE_NO',
      ]);

      if (!payoutRef) {
        continue;
      }

      const status =
        this.pickString(item, [
          'TXN_STATUS',
          'txn_status',
          'status',
          'payout_status',
          'state',
        ]) ??
        this.pickString(item, ['OD_STATUS', 'code']) ??
        'unknown';
      const utr = this.pickString(item, ['UTR_NO', 'utr_no', 'UTR']);
      const bankRef = this.pickString(item, [
        'TXN_REFERENCE_NO',
        'REFERENCE_NO',
        'BATCHREFNO',
        'bankref',
        'bank_ref',
        'bankRef',
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
      .map((ref) => {
        const exact = byRef.get(ref);

        if (exact) {
          return exact;
        }

        if (byRef.size === 1) {
          const only = [...byRef.values()][0];
          return { ...only, payout_ref: ref };
        }

        return undefined;
      })
      .filter((entry): entry is PayoutStatusEntry => !!entry);
  }

  private collectPayoutStatusItems(
    response: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const candidates: unknown[] = [
      this.readPath(response, 'data.ALL_RECORDS'),
      this.readPath(response, 'data.all_records'),
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
          'ALL_RECORDS',
          'all_records',
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
          'PAYMENTREFNO' in nested ||
          'payout_ref' in nested ||
          'payoutRef' in nested ||
          'TXN_STATUS' in nested ||
          'OD_STATUS' in nested
        ) {
          return [nested];
        }
      }
    }

    return [];
  }

  private pickNumericString(
    source: Record<string, unknown>,
    paths: string[],
  ): string | undefined {
    for (const path of paths) {
      const value = this.readPath(source, path);

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return undefined;
  }

  private isJsonErrorStatus(response: Record<string, unknown>): boolean {
    return typeof response.status === 'number' && response.status >= 400;
  }

  private toLivePayoutItem(payout: PayoutItem): Record<string, unknown> {
    const beneficiary =
      payout.payout_mode === 'UPI'
        ? {
            account_name: payout.beneficiary.account_name,
            vpa: payout.beneficiary.vpa ?? '',
          }
        : {
            account_name: payout.beneficiary.account_name,
            account_no: payout.beneficiary.account_no ?? '',
            ifsc: payout.beneficiary.ifsc ?? '',
          };

    return {
      payout_ref: payout.payout_ref,
      amount: payout.amount,
      payout_mode: payout.payout_mode,
      transaction_note: payout.transaction_note?.trim() || 'payout',
      payee: {
        user_ref: payout.payee.user_ref,
        user_name: payout.payee.user_name ?? '',
      },
      beneficiary,
    };
  }

  private upsertStatusEntry(
    entries: PayoutStatusEntry[],
    incoming: PayoutStatusEntry,
  ): void {
    const existingIndex = entries.findIndex(
      (entry) => entry.payout_ref === incoming.payout_ref,
    );

    if (existingIndex < 0) {
      entries.push(incoming);
      return;
    }

    const existing = entries[existingIndex];
    const incomingRank = this.statusFinality(incoming.status);
    const existingRank = this.statusFinality(existing.status);

    if (
      incomingRank > existingRank ||
      (incomingRank === existingRank && incoming.utr && !existing.utr)
    ) {
      entries[existingIndex] = incoming;
    }
  }

  private statusFinality(status: string): number {
    const normalized = status.trim().toLowerCase();

    if (
      normalized === 'completed' ||
      normalized === 'processed' ||
      normalized === 'success' ||
      normalized === 'txsett' ||
      normalized.includes('fail') ||
      normalized.includes('reject') ||
      normalized.includes('return')
    ) {
      return 2;
    }

    return 1;
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
