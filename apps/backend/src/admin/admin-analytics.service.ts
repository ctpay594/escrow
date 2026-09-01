import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import type {
  AdminAnalyticsResponse,
  AnalyticsDailyRow,
  AnalyticsMerchantRow,
  AnalyticsVolumeBucket,
} from './admin-analytics.types';

const IST = 'Asia/Kolkata';

function emptyBucket(): AnalyticsVolumeBucket {
  return {
    in_amount: 0,
    in_count: 0,
    out_success_amount: 0,
    out_success_count: 0,
    out_failed_amount: 0,
    out_failed_count: 0,
    out_pending_amount: 0,
    out_pending_count: 0,
  };
}

function todayYmdIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function istYmd(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function inYmdRange(ymd: string, from: string, to: string) {
  return ymd >= from && ymd <= to;
}

interface DepositRow {
  user_id: string | null;
  amount: number;
  created_at: string;
}

interface TransferRow {
  user_id: string | null;
  amount: number;
  status: string;
  source: string;
  created_at: string;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly merchantsService: MerchantsService,
  ) {}

  async getAnalytics(options: {
    userId?: string;
    from?: string;
    to?: string;
  }): Promise<AdminAnalyticsResponse> {
    const today = todayYmdIst();
    const scopeAllTime = !options.from && !options.to;
    const periodFrom = options.from ?? shiftYmd(today, -29);
    const periodTo = options.to ?? today;
    const dailyFrom = scopeAllTime ? shiftYmd(today, -29) : periodFrom;
    const dailyTo = periodTo;

    const [merchants, deposits, transfers] = await Promise.all([
      this.merchantsService.findAllForAdmin(),
      this.fetchAllDeposits(),
      this.fetchAllTransfers(),
    ]);

    const merchantRows = new Map<string, AnalyticsMerchantRow>();
    for (const merchant of merchants) {
      if (options.userId && merchant.id !== options.userId) {
        continue;
      }

      merchantRows.set(merchant.id, {
        user_id: merchant.id,
        merchant_name: merchant.merchant_name,
        username: merchant.username,
        available_balance: Number(merchant.available_balance ?? 0),
        pending_balance: Number(merchant.pending_balance ?? 0),
        account_status: merchant.account_status ?? 'active',
        lifetime: emptyBucket(),
        period: emptyBucket(),
      });
    }

    const summary = {
      ...emptyBucket(),
      available_balance: 0,
      pending_balance: 0,
      merchant_count: merchantRows.size,
      company_out_success_amount: 0,
      company_out_success_count: 0,
    };

    for (const row of merchantRows.values()) {
      summary.available_balance += row.available_balance;
      summary.pending_balance += row.pending_balance;
    }

    const dailyMap = new Map<string, AnalyticsDailyRow>();

    const ensureDaily = (date: string) => {
      let row = dailyMap.get(date);
      if (!row) {
        row = {
          date,
          in_amount: 0,
          in_count: 0,
          out_success_amount: 0,
          out_success_count: 0,
        };
        dailyMap.set(date, row);
      }
      return row;
    };

    for (const deposit of deposits) {
      if (!deposit.user_id || !merchantRows.has(deposit.user_id)) {
        continue;
      }

      const amount = Number(deposit.amount ?? 0);
      const ymd = istYmd(deposit.created_at);
      const merchant = merchantRows.get(deposit.user_id)!;

      merchant.lifetime.in_amount += amount;
      merchant.lifetime.in_count += 1;

      if (scopeAllTime || inYmdRange(ymd, periodFrom, periodTo)) {
        merchant.period.in_amount += amount;
        merchant.period.in_count += 1;
        summary.in_amount += amount;
        summary.in_count += 1;
      }

      if (inYmdRange(ymd, dailyFrom, dailyTo)) {
        const day = ensureDaily(ymd);
        day.in_amount += amount;
        day.in_count += 1;
      }
    }

    for (const transfer of transfers) {
      const amount = Number(transfer.amount ?? 0);
      const ymd = istYmd(transfer.created_at);
      const isCompany = transfer.source === 'company';

      if (isCompany) {
        if (transfer.status === 'SUCCESS') {
          if (scopeAllTime || inYmdRange(ymd, periodFrom, periodTo)) {
            summary.company_out_success_amount += amount;
            summary.company_out_success_count += 1;
          }
        }
        continue;
      }

      if (!transfer.user_id || !merchantRows.has(transfer.user_id)) {
        continue;
      }

      const merchant = merchantRows.get(transfer.user_id)!;
      const bucketKey =
        transfer.status === 'SUCCESS'
          ? 'success'
          : transfer.status === 'FAILED' || transfer.status === 'REJECTED'
            ? 'failed'
            : 'pending';

      const applyToBucket = (bucket: AnalyticsVolumeBucket) => {
        if (bucketKey === 'success') {
          bucket.out_success_amount += amount;
          bucket.out_success_count += 1;
        } else if (bucketKey === 'failed') {
          bucket.out_failed_amount += amount;
          bucket.out_failed_count += 1;
        } else {
          bucket.out_pending_amount += amount;
          bucket.out_pending_count += 1;
        }
      };

      applyToBucket(merchant.lifetime);

      if (scopeAllTime || inYmdRange(ymd, periodFrom, periodTo)) {
        applyToBucket(merchant.period);
        applyToBucket(summary);
      }

      if (
        bucketKey === 'success' &&
        inYmdRange(ymd, dailyFrom, dailyTo)
      ) {
        const day = ensureDaily(ymd);
        day.out_success_amount += amount;
        day.out_success_count += 1;
      }
    }

    const daily = [...dailyMap.values()].sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    const merchantList = [...merchantRows.values()].sort(
      (a, b) => b.lifetime.in_amount - a.lifetime.in_amount,
    );

    return {
      summary,
      merchants: merchantList,
      daily,
      period: {
        from: scopeAllTime ? dailyFrom : periodFrom,
        to: periodTo,
        scope: scopeAllTime ? 'all_time' : 'range',
      },
      generated_at: new Date().toISOString(),
    };
  }

  private async fetchAllDeposits(): Promise<DepositRow[]> {
    return this.fetchPaged((from, to) =>
      this.supabaseService
        .getAdminClient()
        .from('deposits')
        .select('user_id, amount, created_at')
        .order('created_at', { ascending: false })
        .range(from, to),
    );
  }

  private async fetchAllTransfers(): Promise<TransferRow[]> {
    return this.fetchPaged((from, to) =>
      this.supabaseService
        .getAdminClient()
        .from('transfers')
        .select('user_id, amount, status, source, created_at')
        .order('created_at', { ascending: false })
        .range(from, to),
    );
  }

  private async fetchPaged<T>(
    query: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  ): Promise<T[]> {
    const pageSize = 1000;
    let offset = 0;
    const rows: T[] = [];

    for (;;) {
      const { data, error } = await query(offset, offset + pageSize - 1);

      if (error) {
        throw new InternalServerErrorException(
          error.message ?? 'Failed to load analytics data',
        );
      }

      const batch = data ?? [];
      rows.push(...batch);

      if (batch.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return rows;
  }
}
