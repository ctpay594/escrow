import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase';
import type {
  AdminDepositListItem,
  AdminMerchantListItem,
  CreateMerchantInput,
  MerchantAccountStatus,
  MerchantApprovalMode,
  MerchantProfileRow,
  PublicDeposit,
  PublicMerchantProfile,
} from './merchants.types';

const MERCHANT_PROFILE_SELECT =
  'merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, real_balance, demo_balance, balance_mode, account_status, escrow_account_details';

const MERCHANT_PROFILE_BASIC_SELECT =
  'merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, escrow_account_details';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  getPlatformCredentials(): { apiKey: string; privateKey: string } {
    const apiKey = this.configService.get<string>('ESCROWSTACK_API_KEY')?.trim();
    const privateKeyRaw = this.configService.get<string>(
      'ESCROWSTACK_PRIVATE_KEY',
    );

    if (!apiKey || !privateKeyRaw?.trim()) {
      throw new InternalServerErrorException(
        'Set ESCROWSTACK_API_KEY and ESCROWSTACK_PRIVATE_KEY in backend .env',
      );
    }

    return {
      apiKey,
      privateKey: privateKeyRaw.replace(/\\n/g, '\n').trim(),
    };
  }

  getSharedIfsc(): string {
    return (
      this.configService.get<string>('ESCROWSTACK_IFSC')?.trim() ||
      'HDFC0000060'
    );
  }

  getVaPrefix(): string {
    return (
      this.configService.get<string>('ESCROWSTACK_VA_PREFIX')?.trim() ||
      'CHAK69'
    );
  }

  async allocateVirtualAccount(): Promise<string> {
    const prefix = this.getVaPrefix();
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select('virtual_account_no')
      .like('virtual_account_no', `${prefix}%`);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to allocate virtual account',
      );
    }

    const used = new Set(
      (data ?? [])
        .map((row) => row.virtual_account_no as string | null)
        .filter((value): value is string => !!value),
    );

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(
        6,
        '0',
      );
      const virtualAccountNo = `${prefix}${suffix}`;

      if (!used.has(virtualAccountNo)) {
        return virtualAccountNo;
      }
    }

    throw new InternalServerErrorException(
      'Could not allocate a unique virtual account',
    );
  }

  async create(input: CreateMerchantInput): Promise<PublicMerchantProfile> {
    const payload: Record<string, unknown> = {
      user_id: input.userId,
      merchant_name: input.merchantName,
      user_ref: input.userRef ?? null,
      virtual_account_no: input.virtualAccountNo ?? null,
      escrow_ifsc: input.escrowIfsc ?? null,
      available_balance: input.demoBalance,
      pending_balance: 0,
      real_balance: input.realBalance,
      demo_balance: input.demoBalance,
      escrow_account_details: input.escrowAccountDetails,
    };

    const { data, error } = await this.insertMerchantRow(payload);

    if (error || !data) {
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create merchant profile',
      );
    }

    return this.toPublicProfile(data as MerchantProfileRow);
  }

  private async insertMerchantRow(payload: Record<string, unknown>): Promise<{
    data: MerchantProfileRow | null;
    error: { message?: string } | null;
  }> {
    const client = this.supabaseService.getAdminClient();
    const attempts: Array<{
      row: Record<string, unknown>;
      select: string;
    }> = [
      { row: payload, select: MERCHANT_PROFILE_SELECT },
      {
        row: {
          ...payload,
          encrypted_api_key: 'platform',
          encrypted_private_key: 'platform',
        },
        select: MERCHANT_PROFILE_SELECT,
      },
      { row: payload, select: MERCHANT_PROFILE_BASIC_SELECT },
      {
        row: {
          ...payload,
          encrypted_api_key: 'platform',
          encrypted_private_key: 'platform',
        },
        select: MERCHANT_PROFILE_BASIC_SELECT,
      },
      {
        row: this.withoutOptionalBalanceColumns(payload),
        select: MERCHANT_PROFILE_BASIC_SELECT,
      },
      {
        row: {
          ...this.withoutOptionalBalanceColumns(payload),
          encrypted_api_key: 'platform',
          encrypted_private_key: 'platform',
        },
        select: MERCHANT_PROFILE_BASIC_SELECT,
      },
    ];

    let lastError: { message?: string } | null = null;

    for (const attempt of attempts) {
      const result = await client
        .from('merchants')
        .insert(attempt.row)
        .select(attempt.select)
        .single();

      if (!result.error && result.data) {
        return {
          data: result.data as unknown as MerchantProfileRow,
          error: null,
        };
      }

      lastError = result.error;
      const message = result.error?.message ?? '';

      if (
        !/encrypted_api_key|encrypted_private_key/i.test(message) &&
        !this.isMissingBalanceColumnError(message)
      ) {
        break;
      }
    }

    return { data: null, error: lastError };
  }

  private withoutOptionalBalanceColumns(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const {
      real_balance: _realBalance,
      demo_balance: _demoBalance,
      balance_mode: _balanceMode,
      account_status: _accountStatus,
      ...rest
    } = payload;

    return rest;
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
    const realBalance = Number(
      (data as { real_balance?: unknown }).real_balance ??
        profile.available_balance,
    );
    const demoBalance = Number(
      (data as { demo_balance?: unknown }).demo_balance ??
        profile.available_balance,
    );
    const balanceMode = this.readBalanceMode(
      data as Record<string, unknown>,
    );

    profile.available_balance = this.resolveAvailableBalance(
      realBalance,
      demoBalance,
      profile.pending_balance,
      balanceMode,
    );
    profile.account_status = this.readAccountStatus(
      data as Record<string, unknown>,
    );

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
    const client = this.supabaseService.getAdminClient();
    const { data: users, error: usersError } = await client
      .from('users')
      .select('id, username, password, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (usersError) {
      throw new InternalServerErrorException(
        usersError.message ?? 'Failed to list merchants',
      );
    }

    const userRows = users ?? [];
    const userIds = userRows.map((row) => row.id as string);
    const merchantByUserId = new Map<string, Record<string, unknown>>();

    if (userIds.length > 0) {
      const fullSelect =
        'user_id, merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, real_balance, demo_balance, balance_mode, approval_mode, account_status, escrow_account_details';
      const withoutApprovalSelect =
        'user_id, merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, real_balance, demo_balance, balance_mode, account_status, escrow_account_details';
      const basicSelect =
        'user_id, merchant_name, user_ref, virtual_account_no, escrow_ifsc, available_balance, pending_balance, escrow_account_details';

      let merchantsQuery = await client
        .from('merchants')
        .select(fullSelect)
        .in('user_id', userIds);

      if (
        merchantsQuery.error &&
        this.isMissingColumnError(merchantsQuery.error.message, 'approval_mode')
      ) {
        merchantsQuery = (await client
          .from('merchants')
          .select(withoutApprovalSelect)
          .in('user_id', userIds)) as typeof merchantsQuery;
      }

      if (
        merchantsQuery.error &&
        this.isMissingBalanceColumnError(merchantsQuery.error.message)
      ) {
        merchantsQuery = (await client
          .from('merchants')
          .select(basicSelect)
          .in('user_id', userIds)) as typeof merchantsQuery;
      }

      if (merchantsQuery.error) {
        throw new InternalServerErrorException(
          merchantsQuery.error.message ?? 'Failed to list merchants',
        );
      }

      for (const merchant of merchantsQuery.data ?? []) {
        merchantByUserId.set(
          merchant.user_id as string,
          merchant as Record<string, unknown>,
        );
      }
    }

    return userRows.map((row) => {
      const merchant = merchantByUserId.get(row.id as string);
      const realBalance = Number(
        merchant?.real_balance ?? merchant?.available_balance ?? 0,
      );
      const demoBalance = Number(
        merchant?.demo_balance ?? merchant?.available_balance ?? 0,
      );
      const pendingBalance = Number(merchant?.pending_balance ?? 0);
      const balanceMode =
        merchant?.balance_mode === 'real' ? 'real' : 'demo';
      const accountStatus = this.readAccountStatus(merchant ?? {});

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
          realBalance,
          demoBalance,
          pendingBalance,
          balanceMode,
        ),
        real_balance: realBalance,
        demo_balance: demoBalance,
        pending_balance: pendingBalance,
        balance_mode: balanceMode,
        approval_mode: this.readApprovalMode(merchant ?? {}),
        account_status: accountStatus,
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
        pending_balance: number;
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
        pending_balance: number;
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
          const realBalance =
            row.real_balance !== undefined && row.real_balance !== null
              ? Number(row.real_balance)
              : availableBalance;
          const demoBalance =
            row.demo_balance !== undefined && row.demo_balance !== null
              ? Number(row.demo_balance)
              : 0;

          balanceMap.set(String(row.user_id), {
            real_balance: realBalance,
            demo_balance: demoBalance,
            pending_balance: Number(row.pending_balance ?? 0),
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

  private isSupabaseErrorRow(value: unknown): value is { error: true } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      (value as { error?: unknown }).error === true
    );
  }

  private isMissingColumnError(message: string, column: string): boolean {
    return message.toLowerCase().includes(column.toLowerCase());
  }

  private isMissingBalanceColumnError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes('real_balance') ||
      normalized.includes('demo_balance') ||
      normalized.includes('balance_mode') ||
      normalized.includes('account_status') ||
      normalized.includes('approval_mode')
    );
  }

  private readApprovalMode(row: {
    approval_mode?: unknown;
    escrow_account_details?: unknown;
  }): MerchantApprovalMode {
    if (row.approval_mode === 'auto' || row.approval_mode === 'manual') {
      return row.approval_mode;
    }

    if (
      typeof row.escrow_account_details === 'object' &&
      row.escrow_account_details !== null &&
      (row.escrow_account_details as { approval_mode?: unknown })
        .approval_mode === 'auto'
    ) {
      return 'auto';
    }

    return 'manual';
  }

  private mergeApprovalModeIntoDetails(
    details: unknown,
    approvalMode: MerchantApprovalMode,
  ): Record<string, unknown> {
    const base =
      typeof details === 'object' && details !== null
        ? { ...(details as Record<string, unknown>) }
        : {};

    return {
      ...base,
      approval_mode: approvalMode,
    };
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

  async updateApprovalModeByUserId(
    userId: string,
    approvalMode: MerchantApprovalMode,
  ): Promise<{ approvalMode: MerchantApprovalMode }> {
    const data = await this.loadMerchantBalanceRow(userId);

    if (!data) {
      throw new NotFoundException('Merchant not found');
    }

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({ approval_mode: approvalMode })
      .eq('user_id', userId);

    if (
      updateError &&
      this.isMissingColumnError(updateError.message, 'approval_mode')
    ) {
      const { error: fallbackError } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          escrow_account_details: this.mergeApprovalModeIntoDetails(
            data.escrow_account_details,
            approvalMode,
          ),
        })
        .eq('user_id', userId);

      if (fallbackError) {
        throw new InternalServerErrorException(
          'Failed to update approval mode',
        );
      }

      return { approvalMode };
    }

    if (updateError) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(updateError.message)
          ? this.migrationRequiredMessage()
          : 'Failed to update approval mode',
      );
    }

    return { approvalMode };
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
    balanceMode: 'real' | 'demo';
    approvalMode: MerchantApprovalMode;
    realBalance: number;
    demoBalance: number;
    pendingBalance: number;
    spendable: number;
  } | null> {
    const fullSelect =
      'id, merchant_name, user_ref, real_balance, demo_balance, pending_balance, balance_mode, approval_mode, escrow_account_details';
    const fallbackSelect =
      'id, merchant_name, user_ref, real_balance, demo_balance, pending_balance, balance_mode, escrow_account_details';

    let { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select(fullSelect)
      .eq('user_id', userId)
      .maybeSingle();

    if (error && this.isMissingColumnError(error.message, 'approval_mode')) {
      ({ data, error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .select(fallbackSelect)
        .eq('user_id', userId)
        .maybeSingle());
    }

    if (error) {
      throw new InternalServerErrorException('Failed to load merchant ledger');
    }

    if (!data) {
      return null;
    }

    const balanceMode = data.balance_mode === 'real' ? 'real' : 'demo';
    const realBalance = Number(data.real_balance ?? 0);
    const demoBalance = Number(data.demo_balance ?? 0);
    const pendingBalance = Number(data.pending_balance ?? 0);

    return {
      merchantId: data.id as string,
      merchantName: data.merchant_name as string,
      userRef: (data.user_ref as string | null) ?? null,
      balanceMode,
      approvalMode: this.readApprovalMode(data),
      realBalance,
      demoBalance,
      pendingBalance,
      spendable: this.resolveAvailableBalance(
        realBalance,
        demoBalance,
        pendingBalance,
        balanceMode,
      ),
    };
  }

  async holdFundsForTransfer(
    userId: string,
    amount: number,
    ledgerSnapshot?: {
      balanceMode: 'real' | 'demo';
      realBalance: number;
      demoBalance: number;
      pendingBalance: number;
      spendable: number;
    },
  ): Promise<void> {
    const ledger = ledgerSnapshot ?? (await this.getLedgerByUserId(userId));

    if (!ledger) {
      throw new NotFoundException('Merchant profile not found');
    }

    if (ledger.spendable < amount) {
      throw new BadRequestException('Insufficient available balance');
    }

    const nextPending = Number((ledger.pendingBalance + amount).toFixed(2));

    if (ledger.balanceMode === 'real') {
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          pending_balance: nextPending,
          available_balance: Number(
            Math.max(ledger.realBalance - nextPending, 0).toFixed(2),
          ),
        })
        .eq('user_id', userId);

      if (error) {
        throw new InternalServerErrorException(
          'Failed to reserve transfer funds',
        );
      }

      return;
    }

    const nextDemo = Number((ledger.demoBalance - amount).toFixed(2));
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        demo_balance: nextDemo,
        available_balance: nextDemo,
        pending_balance: nextPending,
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

    const nextPending = Number(
      Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
    );

    if (ledger.balanceMode === 'real') {
      const nextReal = Number(
        Math.max(ledger.realBalance - amount, 0).toFixed(2),
      );
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          real_balance: nextReal,
          pending_balance: nextPending,
          available_balance: Number(
            Math.max(nextReal - nextPending, 0).toFixed(2),
          ),
        })
        .eq('user_id', userId);

      if (error) {
        throw new InternalServerErrorException(
          'Failed to finalize successful transfer balance',
        );
      }

      return;
    }

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({ pending_balance: nextPending })
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

    const nextPending = Number(
      Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
    );

    if (ledger.balanceMode === 'real') {
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          pending_balance: nextPending,
          available_balance: Number(
            Math.max(ledger.realBalance - nextPending, 0).toFixed(2),
          ),
        })
        .eq('user_id', userId);

      if (error) {
        throw new InternalServerErrorException('Failed to release held funds');
      }

      return;
    }

    const nextDemo = Number((ledger.demoBalance + amount).toFixed(2));
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        demo_balance: nextDemo,
        available_balance: nextDemo,
        pending_balance: nextPending,
      })
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException('Failed to release held funds');
    }
  }

  async creditBackAfterBankFailure(
    userId: string,
    amount: number,
  ): Promise<void> {
    const ledger = await this.getLedgerByUserId(userId);

    if (!ledger) {
      return;
    }

    if (ledger.balanceMode === 'real') {
      const nextReal = Number((ledger.realBalance + amount).toFixed(2));
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('merchants')
        .update({
          real_balance: nextReal,
          available_balance: Number(
            Math.max(nextReal - ledger.pendingBalance, 0).toFixed(2),
          ),
        })
        .eq('user_id', userId);

      if (error) {
        throw new InternalServerErrorException(
          'Failed to credit merchant after bank rejection',
        );
      }

      return;
    }

    const nextDemo = Number((ledger.demoBalance + amount).toFixed(2));
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        demo_balance: nextDemo,
        available_balance: nextDemo,
      })
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to credit merchant after bank rejection',
      );
    }
  }

  async updateRealBalanceByUserId(
    userId: string,
    realBalance: number,
  ): Promise<void> {
    const balanceMap = await this.loadBalanceMapByUserIds([userId]);
    const balances = balanceMap.get(userId);
    const pending = balances?.pending_balance ?? 0;
    const demo = balances?.demo_balance ?? 0;
    const mode = balances?.balance_mode ?? 'demo';

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update({
        real_balance: realBalance,
        available_balance: this.resolveAvailableBalance(
          realBalance,
          demo,
          pending,
          mode,
        ),
      })
      .eq('user_id', userId);

    if (updateError) {
      throw new InternalServerErrorException(
        this.isMissingBalanceColumnError(updateError.message)
          ? this.migrationRequiredMessage()
          : 'Failed to update collected balance',
      );
    }
  }

  async creditCollectDeposit(input: {
    virtualAccount: string;
    amount: number;
    dedupeKey: string;
    utr: string | null;
    remitterName: string | null;
    remitterAccount: string | null;
    callbackId: string | null;
  }): Promise<{ outcome: string; merchantId?: string }> {
    const merchant = await this.findMerchantByVirtualAccount(
      input.virtualAccount,
    );

    if (!merchant) {
      return { outcome: 'merchant_not_found' };
    }

    const client = this.supabaseService.getAdminClient();
    const { error: insertError } = await client.from('deposits').insert({
      callback_id: input.callbackId,
      merchant_id: merchant.merchantId,
      user_id: merchant.userId,
      virtual_account: input.virtualAccount,
      amount: input.amount,
      utr: input.utr,
      dedupe_key: input.dedupeKey,
      remitter_name: input.remitterName,
      remitter_account: input.remitterAccount,
      debit_credit: 'Credit',
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return { outcome: 'already_credited', merchantId: merchant.merchantId };
      }

      throw new InternalServerErrorException(
        insertError.message ?? 'Failed to store deposit',
      );
    }

    const balanceMap = await this.loadBalanceMapByUserIds([merchant.userId]);
    const currentReal = balanceMap.get(merchant.userId)?.real_balance ?? 0;
    const nextReal = Number((currentReal + input.amount).toFixed(2));

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
      .ilike('virtual_account_no', virtualAccountNo.trim())
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

  async listDepositsForUser(userId: string): Promise<PublicDeposit[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('deposits')
      .select(
        'id, amount, utr, virtual_account, remitter_name, remitter_account, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      if (
        error.message.toLowerCase().includes('deposits') &&
        (error.message.toLowerCase().includes('does not exist') ||
          error.code === '42P01' ||
          error.code === 'PGRST205')
      ) {
        return [];
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to load deposits',
      );
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      amount: Number(row.amount ?? 0),
      utr: (row.utr as string | null) ?? null,
      virtual_account: String(row.virtual_account ?? ''),
      remitter_name: (row.remitter_name as string | null) ?? null,
      remitter_account: (row.remitter_account as string | null) ?? null,
      created_at: row.created_at as string,
    }));
  }

  async listDepositsForAdmin(): Promise<AdminDepositListItem[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('deposits')
      .select(
        'id, user_id, merchant_id, amount, utr, virtual_account, remitter_name, remitter_account, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      if (
        error.message.toLowerCase().includes('deposits') &&
        (error.message.toLowerCase().includes('does not exist') ||
          error.code === '42P01' ||
          error.code === 'PGRST205')
      ) {
        return [];
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to load deposits',
      );
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      user_id: (row.user_id as string | null) ?? null,
      merchant_id: (row.merchant_id as string | null) ?? null,
      amount: Number(row.amount ?? 0),
      utr: (row.utr as string | null) ?? null,
      virtual_account: String(row.virtual_account ?? ''),
      remitter_name: (row.remitter_name as string | null) ?? null,
      remitter_account: (row.remitter_account as string | null) ?? null,
      created_at: row.created_at as string,
    }));
  }

  async getApiKeyByUserId(_userId: string): Promise<string> {
    return this.getPlatformCredentials().apiKey;
  }

  async getDecryptedCredentials(_userId: string): Promise<{
    apiKey: string;
    privateKey: string;
  }> {
    return this.getPlatformCredentials();
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
