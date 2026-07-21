import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CryptoService } from '../crypto';
import { SupabaseService } from '../supabase';
import type {
  AdminMerchantListItem,
  CreateMerchantInput,
  MerchantAccountStatus,
  MerchantProfileRow,
  MerchantRecord,
  PublicMerchantProfile,
} from './merchants.types';

const MERCHANT_PROFILE_SELECT =
  'merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, escrow_account_details';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(input: CreateMerchantInput): Promise<PublicMerchantProfile> {
    const basePayload = {
      user_id: input.userId,
      merchant_name: input.merchantName,
      user_ref: input.userRef ?? null,
      virtual_account_no: input.virtualAccountNo ?? null,
      escrow_ifsc: input.escrowIfsc ?? null,
      encrypted_api_key: this.cryptoService.encrypt(input.apiKey),
      encrypted_private_key: this.cryptoService.encrypt(input.privateKey),
      available_balance: input.demoBalance,
      pending_balance: 0,
      escrow_account_details: input.escrowAccountDetails,
    };

    const fullPayload = {
      ...basePayload,
      real_balance: input.realBalance,
      demo_balance: input.demoBalance,
    };

    let { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .insert(fullPayload)
      .select(MERCHANT_PROFILE_SELECT)
      .single();

    if (error && this.isMissingBalanceColumnError(error.message)) {
      ({ data, error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .insert(basePayload)
        .select(MERCHANT_PROFILE_SELECT)
        .single());
    }

    if (error || !data) {
      throw new InternalServerErrorException(
        error && this.isMissingBalanceColumnError(error.message)
          ? this.migrationRequiredMessage()
          : 'Failed to create merchant profile',
      );
    }

    return this.toPublicProfile(data);
  }

  async findPublicProfileByUserId(
    userId: string,
  ): Promise<PublicMerchantProfile | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select(MERCHANT_PROFILE_SELECT)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(error.message)
          ? this.migrationRequiredMessage()
          : 'Failed to load merchant profile',
      );
    }

    if (!data || this.isSupabaseErrorRow(data)) {
      return null;
    }

    const profile = this.toPublicProfile(data);
    const balanceMap = await this.loadBalanceMapByUserIds([userId]);
    const balances = balanceMap.get(userId);

    if (balances) {
      profile.available_balance = this.resolveAvailableBalance(
        balances.real_balance,
        balances.demo_balance,
        profile.pending_balance,
        balances.balance_mode,
      );
      profile.account_status = balances.account_status;
    } else {
      profile.account_status = 'active';
    }

    return profile;
  }

  async assertCanTransfer(userId: string): Promise<void> {
    const balanceMap = await this.loadBalanceMapByUserIds([userId]);
    const status = balanceMap.get(userId)?.account_status ?? 'active';

    if (status === 'on_hold') {
      throw new BadRequestException(
        'Your account is on hold. Transfers are disabled.',
      );
    }

    if (status === 'terminated') {
      throw new BadRequestException(
        'Your account has been terminated. Transfers are disabled.',
      );
    }
  }

  private resolveAvailableBalance(
    realBalance: number,
    demoBalance: number,
    pendingBalance: number,
    balanceMode: 'real' | 'demo',
  ): number {
    if (balanceMode === 'real') {
      return Number(Math.max(realBalance - pendingBalance, 0).toFixed(2));
    }

    return demoBalance;
  }

  async findAllForAdmin(): Promise<AdminMerchantListItem[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .select(
        `
        id,
        username,
        password,
        created_at,
        updated_at,
        merchants (
          merchant_name,
          user_ref,
          virtual_account_no,
          escrow_ifsc,
          available_balance,
          pending_balance
        )
      `,
      )
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException('Failed to list merchants');
    }

    const userIds = (data ?? []).map((row) => row.id as string);
    const balanceMap = await this.loadBalanceMapByUserIds(userIds);

    return (data ?? []).map((row) => {
      const merchant = Array.isArray(row.merchants)
        ? row.merchants[0]
        : row.merchants;
      const balances = balanceMap.get(row.id as string);

      return {
        id: row.id as string,
        username: row.username as string,
        password: row.password as string,
        merchant_name: (merchant?.merchant_name as string) ?? '—',
        user_ref: (merchant?.user_ref as string | null) ?? null,
        virtual_account_no:
          (merchant?.virtual_account_no as string | null) ?? null,
        escrow_ifsc: (merchant?.escrow_ifsc as string | null) ?? null,
        available_balance: this.resolveAvailableBalance(
          balances?.real_balance ?? Number(merchant?.available_balance ?? 0),
          balances?.demo_balance ?? Number(merchant?.available_balance ?? 0),
          Number(merchant?.pending_balance ?? 0),
          balances?.balance_mode ?? 'demo',
        ),
        real_balance:
          balances?.real_balance ?? Number(merchant?.available_balance ?? 0),
        demo_balance:
          balances?.demo_balance ?? Number(merchant?.available_balance ?? 0),
        pending_balance: Number(merchant?.pending_balance ?? 0),
        balance_mode: balances?.balance_mode ?? 'demo',
        account_status: balances?.account_status ?? 'active',
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      };
    });
  }

  private async loadBalanceMapByUserIds(userIds: string[]): Promise<
    Map<
      string,
      {
        real_balance: number;
        demo_balance: number;
        balance_mode: 'real' | 'demo';
        account_status: MerchantAccountStatus;
      }
    >
  > {
    const balanceMap = new Map<
      string,
      {
        real_balance: number;
        demo_balance: number;
        balance_mode: 'real' | 'demo';
        account_status: MerchantAccountStatus;
      }
    >();

    if (userIds.length === 0) {
      return balanceMap;
    }

    const selectCandidates = [
      'user_id, available_balance, real_balance, demo_balance, balance_mode, account_status, pending_balance, escrow_account_details',
      'user_id, available_balance, real_balance, demo_balance, balance_mode, pending_balance, escrow_account_details',
      'user_id, available_balance, pending_balance, escrow_account_details',
    ];

    for (const select of selectCandidates) {
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .select(select)
        .in('user_id', userIds);

      if (!error) {
        for (const row of (data ?? []) as unknown as Record<
          string,
          unknown
        >[]) {
          const availableBalance = Number(row.available_balance ?? 0);
          const cachedBank = this.readCachedBankBalance(
            row.escrow_account_details,
          );
          const realBalance =
            row.real_balance !== undefined && row.real_balance !== null
              ? Number(row.real_balance)
              : (cachedBank ?? availableBalance);
          const demoBalance =
            row.demo_balance !== undefined && row.demo_balance !== null
              ? Number(row.demo_balance)
              : availableBalance;

          balanceMap.set(String(row.user_id), {
            real_balance: realBalance,
            demo_balance: demoBalance,
            balance_mode: this.readBalanceMode(row),
            account_status: this.readAccountStatus(row),
          });
        }

        return balanceMap;
      }

      if (!this.isMissingBalanceColumnError(error.message)) {
        throw new InternalServerErrorException(
          'Failed to load merchant balances',
        );
      }
    }

    throw new InternalServerErrorException('Failed to load merchant balances');
  }

  private readCachedBankBalance(details: unknown): number | null {
    if (typeof details !== 'object' || details === null) {
      return null;
    }

    const record = details as Record<string, unknown>;
    const direct = record.bank_balance;

    if (typeof direct === 'number' && Number.isFinite(direct)) {
      return direct;
    }

    if (typeof direct === 'string') {
      const parsed = Number(direct);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const balancePayload = record.balance;

    if (typeof balancePayload === 'object' && balancePayload !== null) {
      const nested = balancePayload as Record<string, unknown>;
      const data = nested.data;

      if (typeof data === 'object' && data !== null && 'balance' in data) {
        const parsed = Number(data.balance);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      if ('balance' in nested) {
        const parsed = Number(nested.balance);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }

  private isSupabaseErrorRow(value: unknown): value is { error: true } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      (value as { error?: unknown }).error === true
    );
  }

  private isMissingBalanceColumnError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes('real_balance') ||
      normalized.includes('demo_balance') ||
      normalized.includes('balance_mode') ||
      normalized.includes('account_status')
    );
  }

  private migrationRequiredMessage(): string {
    return 'Run migrations 005, 008, and 010 in Supabase SQL Editor';
  }

  private readAccountStatus(row: {
    account_status?: unknown;
    escrow_account_details?: unknown;
  }): MerchantAccountStatus {
    if (
      row.account_status === 'on_hold' ||
      row.account_status === 'terminated'
    ) {
      return row.account_status;
    }

    if (row.account_status === 'active') {
      return 'active';
    }

    if (
      typeof row.escrow_account_details === 'object' &&
      row.escrow_account_details !== null
    ) {
      const status = (
        row.escrow_account_details as { account_status?: unknown }
      ).account_status;

      if (status === 'on_hold' || status === 'terminated') {
        return status;
      }
    }

    return 'active';
  }

  private mergeAccountStatusIntoDetails(
    details: unknown,
    accountStatus: MerchantAccountStatus,
  ): Record<string, unknown> {
    const base =
      typeof details === 'object' && details !== null
        ? { ...(details as Record<string, unknown>) }
        : {};

    return {
      ...base,
      account_status: accountStatus,
    };
  }

  private readBalanceMode(row: {
    balance_mode?: unknown;
    escrow_account_details?: unknown;
  }): 'real' | 'demo' {
    if (row.balance_mode === 'real') {
      return 'real';
    }

    if (
      typeof row.escrow_account_details === 'object' &&
      row.escrow_account_details !== null &&
      (row.escrow_account_details as { balance_mode?: unknown })
        .balance_mode === 'real'
    ) {
      return 'real';
    }

    return 'demo';
  }

  private mergeBalanceModeIntoDetails(
    details: unknown,
    balanceMode: 'real' | 'demo',
  ): Record<string, unknown> {
    const base =
      typeof details === 'object' && details !== null
        ? { ...(details as Record<string, unknown>) }
        : {};

    return {
      ...base,
      balance_mode: balanceMode,
    };
  }

  private async loadMerchantBalanceRow(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const fullSelect =
      'real_balance, demo_balance, pending_balance, available_balance, balance_mode, account_status, escrow_account_details';
    const fallbackSelect =
      'pending_balance, available_balance, escrow_account_details';

    let { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select(fullSelect)
      .eq('user_id', userId)
      .maybeSingle();

    if (error && this.isMissingBalanceColumnError(error.message)) {
      ({ data, error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .select(fallbackSelect)
        .eq('user_id', userId)
        .maybeSingle());
    }

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load merchant balances',
      );
    }

    return data ?? null;
  }

  async updateDemoBalanceByUserId(
    userId: string,
    demoBalance: number,
  ): Promise<void> {
    const balanceMap = await this.loadBalanceMapByUserIds([userId]);
    const balances = balanceMap.get(userId);
    const balanceMode = balances?.balance_mode ?? 'demo';

    const payload: Record<string, number> = {
      demo_balance: demoBalance,
    };

    if (balanceMode === 'demo') {
      payload.available_balance = demoBalance;
    }

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update(payload)
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(error.message)
          ? this.migrationRequiredMessage()
          : 'Failed to update demo balance',
      );
    }
  }

  async updateBalanceModeByUserId(
    userId: string,
    balanceMode: 'real' | 'demo',
  ): Promise<{ balanceMode: 'real' | 'demo'; availableBalance: number }> {
    const data = await this.loadMerchantBalanceRow(userId);

    if (!data) {
      throw new InternalServerErrorException(
        'Failed to load merchant balances',
      );
    }

    const realBalance = Number(
      data.real_balance ?? data.available_balance ?? 0,
    );
    const demoBalance = Number(
      data.demo_balance ?? data.available_balance ?? 0,
    );
    const pendingBalance = Number(data.pending_balance ?? 0);
    const availableBalance = this.resolveAvailableBalance(
      realBalance,
      demoBalance,
      pendingBalance,
      balanceMode,
    );

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        balance_mode: balanceMode,
        available_balance: availableBalance,
      })
      .eq('user_id', userId);

    if (
      updateError &&
      updateError.message.toLowerCase().includes('balance_mode')
    ) {
      const { error: fallbackError } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          available_balance: availableBalance,
          escrow_account_details: this.mergeBalanceModeIntoDetails(
            data.escrow_account_details,
            balanceMode,
          ),
        })
        .eq('user_id', userId);

      if (fallbackError) {
        throw new InternalServerErrorException('Failed to update balance mode');
      }

      return {
        balanceMode,
        availableBalance,
      };
    }

    if (updateError) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(updateError.message)
          ? this.migrationRequiredMessage()
          : 'Failed to update balance mode',
      );
    }

    return {
      balanceMode,
      availableBalance,
    };
  }

  async updateAccountStatusByUserId(
    userId: string,
    accountStatus: MerchantAccountStatus,
  ): Promise<{ accountStatus: MerchantAccountStatus }> {
    const data = await this.loadMerchantBalanceRow(userId);

    if (!data) {
      throw new NotFoundException('Merchant not found');
    }

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({ account_status: accountStatus })
      .eq('user_id', userId);

    if (
      updateError &&
      updateError.message.toLowerCase().includes('account_status')
    ) {
      const { error: fallbackError } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          escrow_account_details: this.mergeAccountStatusIntoDetails(
            data.escrow_account_details,
            accountStatus,
          ),
        })
        .eq('user_id', userId);

      if (fallbackError) {
        throw new InternalServerErrorException(
          'Failed to update account status',
        );
      }

      return { accountStatus };
    }

    if (updateError) {
      throw new InternalServerErrorException('Failed to update account status');
    }

    return { accountStatus };
  }

  async getLedgerByUserId(userId: string): Promise<{
    merchantId: string;
    merchantName: string;
    userRef: string | null;
    demoBalance: number;
    pendingBalance: number;
  } | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select(
        'id, merchant_name, user_ref, available_balance, demo_balance, pending_balance',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to load merchant ledger');
    }

    if (!data) {
      return null;
    }

    const availableBalance = Number(data.available_balance ?? 0);

    return {
      merchantId: data.id as string,
      merchantName: data.merchant_name as string,
      userRef: (data.user_ref as string | null) ?? null,
      demoBalance: Number(data.demo_balance ?? availableBalance),
      pendingBalance: Number(data.pending_balance ?? 0),
    };
  }

  async holdFundsForTransfer(
    userId: string,
    amount: number,
    ledgerSnapshot?: {
      demoBalance: number;
      pendingBalance: number;
    },
  ): Promise<void> {
    const ledger = ledgerSnapshot ?? (await this.getLedgerByUserId(userId));

    if (!ledger) {
      throw new NotFoundException('Merchant profile not found');
    }

    if (ledger.demoBalance < amount) {
      throw new BadRequestException('Insufficient available balance');
    }

    const nextDemoBalance = Number((ledger.demoBalance - amount).toFixed(2));
    const nextPendingBalance = Number(
      (ledger.pendingBalance + amount).toFixed(2),
    );

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        demo_balance: nextDemoBalance,
        available_balance: nextDemoBalance,
        pending_balance: nextPendingBalance,
      })
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to reserve transfer funds',
      );
    }
  }

  async clearPendingForSuccessfulTransfer(
    userId: string,
    amount: number,
  ): Promise<void> {
    const ledger = await this.getLedgerByUserId(userId);

    if (!ledger) {
      return;
    }

    const nextPendingBalance = Number(
      Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
    );

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({ pending_balance: nextPendingBalance })
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to finalize successful transfer balance',
      );
    }
  }

  async releaseHeldFunds(userId: string, amount: number): Promise<void> {
    const ledger = await this.getLedgerByUserId(userId);

    if (!ledger) {
      return;
    }

    const nextDemoBalance = Number((ledger.demoBalance + amount).toFixed(2));
    const nextPendingBalance = Number(
      Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
    );

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        demo_balance: nextDemoBalance,
        available_balance: nextDemoBalance,
        pending_balance: nextPendingBalance,
      })
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException('Failed to release held funds');
    }
  }

  async updateRealBalanceByUserId(
    userId: string,
    realBalance: number,
  ): Promise<void> {
    const balanceMap = await this.loadBalanceMapByUserIds([userId]);
    const balances = balanceMap.get(userId);
    const balanceMode = balances?.balance_mode ?? 'demo';

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('demo_balance, pending_balance, escrow_account_details')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      throw new InternalServerErrorException(
        'Failed to load merchant balances',
      );
    }

    const existingDetails =
      typeof data.escrow_account_details === 'object' &&
      data.escrow_account_details !== null
        ? { ...(data.escrow_account_details as Record<string, unknown>) }
        : {};

    const payload: Record<string, unknown> = {
      real_balance: realBalance,
      escrow_account_details: {
        ...existingDetails,
        bank_balance: realBalance,
        bank_balance_synced_at: new Date().toISOString(),
      },
    };

    if (balanceMode === 'real') {
      payload.available_balance = this.resolveAvailableBalance(
        realBalance,
        Number(data.demo_balance ?? 0),
        Number(data.pending_balance ?? 0),
        'real',
      );
    }

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update(payload)
      .eq('user_id', userId);

    if (updateError) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(updateError.message)
          ? this.migrationRequiredMessage()
          : 'Failed to update real balance',
      );
    }
  }

  async creditDepositFromWebhook(
    payload: Record<string, unknown>,
  ): Promise<{ outcome: string; merchantId?: string }> {
    const amount = this.pickWebhookAmount(payload);

    if (amount === null || amount <= 0) {
      return { outcome: 'ignored_invalid_amount' };
    }

    const virtualAccount =
      this.pickWebhookString(payload, 'virtual_account_no') ??
      this.pickWebhookString(payload, 'virtual_account_number') ??
      this.pickWebhookString(payload, 'ac_no') ??
      this.pickWebhookString(payload, 'account_no');
    const userRef = this.pickWebhookString(payload, 'user_ref');

    const merchant = virtualAccount
      ? await this.findMerchantByVirtualAccount(virtualAccount)
      : userRef
        ? await this.findMerchantByUserRef(userRef)
        : null;

    if (!merchant) {
      return { outcome: 'merchant_not_found' };
    }

    const balanceMap = await this.loadBalanceMapByUserIds([merchant.userId]);
    const balances = balanceMap.get(merchant.userId);
    const currentReal = balances?.real_balance ?? 0;
    const nextReal = Number((currentReal + amount).toFixed(2));

    await this.updateRealBalanceByUserId(merchant.userId, nextReal);

    return {
      outcome: 'credited',
      merchantId: merchant.merchantId,
    };
  }

  private async findMerchantByVirtualAccount(
    virtualAccountNo: string,
  ): Promise<{
    userId: string;
    merchantId: string;
  } | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('id, user_id')
      .eq('virtual_account_no', virtualAccountNo)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      userId: data.user_id as string,
      merchantId: data.id as string,
    };
  }

  private async findMerchantByUserRef(userRef: string): Promise<{
    userId: string;
    merchantId: string;
  } | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('id, user_id')
      .eq('user_ref', userRef)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      userId: data.user_id as string,
      merchantId: data.id as string,
    };
  }

  private pickWebhookString(
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

  private pickWebhookAmount(payload: Record<string, unknown>): number | null {
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

  async deleteByUserId(userId: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to delete merchant profile',
      );
    }
  }

  async getApiKeyByUserId(userId: string): Promise<string> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('encrypted_api_key')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Merchant API key not found');
    }

    return this.cryptoService.decrypt(
      (data as Pick<MerchantRecord, 'encrypted_api_key'>).encrypted_api_key,
    );
  }

  async getDecryptedCredentials(userId: string): Promise<{
    apiKey: string;
    privateKey: string;
  }> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('encrypted_api_key, encrypted_private_key')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Merchant credentials not found');
    }

    const record = data as Pick<
      MerchantRecord,
      'encrypted_api_key' | 'encrypted_private_key'
    >;

    return {
      apiKey: this.cryptoService.decrypt(record.encrypted_api_key),
      privateKey: this.cryptoService.decrypt(record.encrypted_private_key),
    };
  }

  private toPublicProfile(data: MerchantProfileRow): PublicMerchantProfile {
    return {
      merchant_name: data.merchant_name,
      user_ref: data.user_ref ?? null,
      virtual_account_no: data.virtual_account_no ?? null,
      escrow_ifsc: data.escrow_ifsc ?? null,
      available_balance: Number(data.available_balance ?? 0),
      pending_balance: Number(data.pending_balance ?? 0),
      load_instructions: this.extractLoadInstructions(
        data.escrow_account_details,
      ),
      account_status: 'active',
    };
  }

  private extractLoadInstructions(
    escrowAccountDetails: unknown,
  ): Record<string, string[]> | null {
    if (
      typeof escrowAccountDetails !== 'object' ||
      escrowAccountDetails === null
    ) {
      return null;
    }

    const account = (escrowAccountDetails as { account?: unknown }).account;

    if (typeof account !== 'object' || account === null) {
      return null;
    }

    const data = (account as { data?: unknown }).data;

    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const instructions = (data as { Instructions?: unknown }).Instructions;

    if (typeof instructions !== 'object' || instructions === null) {
      return null;
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

    return Object.keys(parsed).length > 0 ? parsed : null;
  }
}
