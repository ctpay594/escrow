export interface AnalyticsVolumeBucket {
  in_amount: number;
  in_count: number;
  out_success_amount: number;
  out_success_count: number;
  out_failed_amount: number;
  out_failed_count: number;
  out_pending_amount: number;
  out_pending_count: number;
}

export interface AnalyticsMerchantRow {
  user_id: string;
  merchant_name: string;
  username: string;
  available_balance: number;
  pending_balance: number;
  account_status: string;
  lifetime: AnalyticsVolumeBucket;
  period: AnalyticsVolumeBucket;
}

export interface AnalyticsDailyRow {
  date: string;
  in_amount: number;
  in_count: number;
  out_success_amount: number;
  out_success_count: number;
}

export interface AdminAnalyticsResponse {
  summary: AnalyticsVolumeBucket & {
    available_balance: number;
    pending_balance: number;
    merchant_count: number;
    company_out_success_amount: number;
    company_out_success_count: number;
  };
  merchants: AnalyticsMerchantRow[];
  daily: AnalyticsDailyRow[];
  period: {
    from: string;
    to: string;
    scope: 'all_time' | 'range';
  };
  generated_at: string;
}
