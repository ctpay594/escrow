import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase';
import type {
  AdminDepositListItem,
  AdminMerchantListItem,
  CreateMerchantInput,
  LedgerEntry,
  LedgerMutationRef,
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
  private readonly logger = new Logger(MerchantsService.name);
  /** Serializes deposit/hold/success/release per merchant (same process). */
  private readonly merchantLedgerTail = new Map<string, Promise<unknown>>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private enqueueMerchantLedger<T>(
    userId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.merchantLedgerTail.get(userId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.merchantLedgerTail.set(
      userId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

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
    const previousDemo = balances?.demo_balance ?? 0;
    const ledger = await this.getLedgerByUserId(userId);

    const payload: Record<string, number> = {
      demo_balance: demoBalance,
    };

    if (balanceMode === 'demo') {
      payload.available_balance = demoBalance;
    }

    const delta = Number((demoBalance - previousDemo).toFixed(2));

    if (ledger && delta !== 0) {
      const claimed = await this.claimLedgerEvent({
        userId,
        merchantId: ledger.merchantId,
        direction: delta > 0 ? 'credit' : 'debit',
        amount: Math.abs(delta),
        reason: 'demo_adjust',
        refId: crypto.randomUUID(),
        note: `Demo balance set to ${demoBalance.toFixed(2)}`,
        realBefore: ledger.realBalance,
        realAfter: ledger.realBalance,
        pendingBefore: ledger.pendingBalance,
        pendingAfter: ledger.pendingBalance,
        availableAfter:
          balanceMode === 'demo' ? demoBalance : ledger.spendable,
      });

      if (!claimed) {
        return;
      }
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
    _ledgerSnapshot?: {
      merchantId?: string;
      balanceMode?: 'real' | 'demo';
      realBalance?: number;
      demoBalance?: number;
      pendingBalance?: number;
      spendable?: number;
    },
    ref?: LedgerMutationRef,
  ): Promise<void> {
    return this.enqueueMerchantLedger(userId, () =>
      this.holdFundsForTransferLocked(userId, amount, ref),
    );
  }

  private async holdFundsForTransferLocked(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid hold amount');
    }

    if (ref) {
      const ledger = await this.getLedgerByUserId(userId);
      if (!ledger) {
        throw new NotFoundException('Merchant profile not found');
      }
      this.assertSufficientSpendable(ledger, amount);
      const nextPending = Number((ledger.pendingBalance + amount).toFixed(2));
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(ledger.realBalance - nextPending, 0).toFixed(2))
          : Number((ledger.demoBalance - amount).toFixed(2));
      const claimed = await this.claimLedgerEvent({
        userId,
        merchantId: ledger.merchantId,
        direction: 'debit',
        amount,
        reason: ref.reason,
        refId: ref.refId,
        note: ref.note,
        realBefore: ledger.realBalance,
        realAfter: ledger.realBalance,
        pendingBefore: ledger.pendingBalance,
        pendingAfter: nextPending,
        availableAfter: nextAvailable,
      });
      if (!claimed) {
        throw new BadRequestException(
          'Transfer hold could not be reserved (duplicate reference). Try again.',
        );
      }
    }

    const client = this.supabaseService.getAdminClient();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ledger = await this.getLedgerByUserId(userId);

      if (!ledger) {
        throw new NotFoundException('Merchant profile not found');
      }

      this.assertSufficientSpendable(ledger, amount);

      const pendingBefore = ledger.pendingBalance;
      const nextPending = Number((pendingBefore + amount).toFixed(2));
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(ledger.realBalance - nextPending, 0).toFixed(2))
          : Number((ledger.demoBalance - amount).toFixed(2));

      if (ledger.balanceMode === 'real') {
        const { data, error } = await client
          .from('merchants')
          .update({
            pending_balance: nextPending,
            available_balance: nextAvailable,
          })
          .eq('user_id', userId)
          .eq('pending_balance', pendingBefore)
          .eq('real_balance', ledger.realBalance)
          .select('id')
          .maybeSingle();

        if (error) {
          throw new InternalServerErrorException(
            'Failed to reserve transfer funds',
          );
        }

        if (data) {
          return;
        }

        continue;
      }

      const demoBefore = ledger.demoBalance;
      const nextDemo = Number((demoBefore - amount).toFixed(2));
      const { data, error } = await client
        .from('merchants')
        .update({
          demo_balance: nextDemo,
          available_balance: nextDemo,
          pending_balance: nextPending,
        })
        .eq('user_id', userId)
        .eq('pending_balance', pendingBefore)
        .eq('demo_balance', demoBefore)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          'Failed to reserve transfer funds',
        );
      }

      if (data) {
        return;
      }
    }

    throw new InternalServerErrorException(
      'Failed to reserve transfer funds after concurrent updates',
    );
  }

  private assertSufficientSpendable(
    ledger: {
      balanceMode: 'real' | 'demo';
      realBalance: number;
      demoBalance: number;
      pendingBalance: number;
      spendable: number;
    },
    amount: number,
  ): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid transfer amount');
    }

    if (!Number.isFinite(ledger.spendable) || ledger.spendable + 0.001 < amount) {
      throw new BadRequestException(
        `Insufficient available balance. Need ₹${amount.toLocaleString('en-IN')}, available ₹${Number(ledger.spendable || 0).toLocaleString('en-IN')}`,
      );
    }

    if (ledger.balanceMode === 'real') {
      const nextPending = Number((ledger.pendingBalance + amount).toFixed(2));
      if (nextPending > ledger.realBalance + 0.001) {
        throw new BadRequestException(
          `Insufficient available balance. Need ₹${amount.toLocaleString('en-IN')}, available ₹${ledger.spendable.toLocaleString('en-IN')}`,
        );
      }
    }
  }

  async clearPendingForSuccessfulTransfer(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    return this.enqueueMerchantLedger(userId, () =>
      this.clearPendingForSuccessfulTransferLocked(userId, amount, ref),
    );
  }

  private async clearPendingForSuccessfulTransferLocked(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    if (ref) {
      const ledger = await this.getLedgerByUserId(userId);
      if (!ledger) {
        return;
      }
      const nextPending = Number(
        Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
      );
      const nextReal =
        ledger.balanceMode === 'real'
          ? Number(Math.max(ledger.realBalance - amount, 0).toFixed(2))
          : ledger.realBalance;
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(nextReal - nextPending, 0).toFixed(2))
          : ledger.spendable;
      const claimed = await this.claimLedgerEvent({
        userId,
        merchantId: ledger.merchantId,
        direction: 'debit',
        amount,
        reason: ref.reason,
        refId: ref.refId,
        note: ref.note,
        realBefore: ledger.realBalance,
        realAfter: nextReal,
        pendingBefore: ledger.pendingBalance,
        pendingAfter: nextPending,
        availableAfter: nextAvailable,
      });
      if (!claimed) {
        this.logger.warn(
          `Skip duplicate success debit for ${userId} ref ${ref.refId}`,
        );
        return;
      }
    }

    const client = this.supabaseService.getAdminClient();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ledger = await this.getLedgerByUserId(userId);

      if (!ledger) {
        return;
      }

      if (ledger.pendingBalance + 0.001 < amount) {
        this.logger.warn(
          `Skip success debit for ${userId}: pending ${ledger.pendingBalance} < ${amount}`,
        );
        return;
      }

      const pendingBefore = ledger.pendingBalance;
      const realBefore = ledger.realBalance;
      const nextPending = Number(Math.max(pendingBefore - amount, 0).toFixed(2));
      const nextReal =
        ledger.balanceMode === 'real'
          ? Number(Math.max(realBefore - amount, 0).toFixed(2))
          : realBefore;
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(nextReal - nextPending, 0).toFixed(2))
          : ledger.spendable;

      if (ledger.balanceMode === 'real') {
        const { data, error } = await client
          .from('merchants')
          .update({
            real_balance: nextReal,
            pending_balance: nextPending,
            available_balance: nextAvailable,
          })
          .eq('user_id', userId)
          .eq('pending_balance', pendingBefore)
          .eq('real_balance', realBefore)
          .select('id')
          .maybeSingle();

        if (error) {
          throw new InternalServerErrorException(
            'Failed to finalize successful transfer balance',
          );
        }

        if (data) {
          return;
        }

        continue;
      }

      const { data, error } = await client
        .from('merchants')
        .update({ pending_balance: nextPending })
        .eq('user_id', userId)
        .eq('pending_balance', pendingBefore)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          'Failed to finalize successful transfer balance',
        );
      }

      if (data) {
        return;
      }
    }

    throw new InternalServerErrorException(
      'Failed to finalize successful transfer after concurrent updates',
    );
  }

  async releaseHeldFunds(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    return this.enqueueMerchantLedger(userId, () =>
      this.releaseHeldFundsLocked(userId, amount, ref),
    );
  }

  private async releaseHeldFundsLocked(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    if (ref) {
      const ledger = await this.getLedgerByUserId(userId);
      if (!ledger) {
        return;
      }
      const nextPending = Number(
        Math.max(ledger.pendingBalance - amount, 0).toFixed(2),
      );
      const nextDemo =
        ledger.balanceMode === 'demo'
          ? Number((ledger.demoBalance + amount).toFixed(2))
          : ledger.demoBalance;
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(ledger.realBalance - nextPending, 0).toFixed(2))
          : nextDemo;
      const claimed = await this.claimLedgerEvent({
        userId,
        merchantId: ledger.merchantId,
        direction: 'credit',
        amount,
        reason: ref.reason,
        refId: ref.refId,
        note: ref.note,
        realBefore: ledger.realBalance,
        realAfter: ledger.realBalance,
        pendingBefore: ledger.pendingBalance,
        pendingAfter: nextPending,
        availableAfter: nextAvailable,
      });
      if (!claimed) {
        return;
      }
    }

    const client = this.supabaseService.getAdminClient();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ledger = await this.getLedgerByUserId(userId);

      if (!ledger) {
        return;
      }

      const pendingBefore = ledger.pendingBalance;
      const nextPending = Number(Math.max(pendingBefore - amount, 0).toFixed(2));

      if (ledger.balanceMode === 'real') {
        const nextAvailable = Number(
          Math.max(ledger.realBalance - nextPending, 0).toFixed(2),
        );
        const { data, error } = await client
          .from('merchants')
          .update({
            pending_balance: nextPending,
            available_balance: nextAvailable,
          })
          .eq('user_id', userId)
          .eq('pending_balance', pendingBefore)
          .eq('real_balance', ledger.realBalance)
          .select('id')
          .maybeSingle();

        if (error) {
          throw new InternalServerErrorException('Failed to release held funds');
        }

        if (data) {
          return;
        }

        continue;
      }

      const demoBefore = ledger.demoBalance;
      const nextDemo = Number((demoBefore + amount).toFixed(2));
      const { data, error } = await client
        .from('merchants')
        .update({
          demo_balance: nextDemo,
          available_balance: nextDemo,
          pending_balance: nextPending,
        })
        .eq('user_id', userId)
        .eq('pending_balance', pendingBefore)
        .eq('demo_balance', demoBefore)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException('Failed to release held funds');
      }

      if (data) {
        return;
      }
    }

    throw new InternalServerErrorException(
      'Failed to release held funds after concurrent updates',
    );
  }

  async creditBackAfterBankFailure(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    return this.enqueueMerchantLedger(userId, () =>
      this.creditBackAfterBankFailureLocked(userId, amount, ref),
    );
  }

  private async creditBackAfterBankFailureLocked(
    userId: string,
    amount: number,
    ref?: LedgerMutationRef,
  ): Promise<void> {
    if (ref) {
      const ledger = await this.getLedgerByUserId(userId);
      if (!ledger) {
        return;
      }
      const nextReal =
        ledger.balanceMode === 'real'
          ? Number((ledger.realBalance + amount).toFixed(2))
          : ledger.realBalance;
      const nextDemo =
        ledger.balanceMode === 'demo'
          ? Number((ledger.demoBalance + amount).toFixed(2))
          : ledger.demoBalance;
      const nextAvailable =
        ledger.balanceMode === 'real'
          ? Number(Math.max(nextReal - ledger.pendingBalance, 0).toFixed(2))
          : nextDemo;
      const claimed = await this.claimLedgerEvent({
        userId,
        merchantId: ledger.merchantId,
        direction: 'credit',
        amount,
        reason: ref.reason,
        refId: ref.refId,
        note: ref.note,
        realBefore: ledger.realBalance,
        realAfter: nextReal,
        pendingBefore: ledger.pendingBalance,
        pendingAfter: ledger.pendingBalance,
        availableAfter: nextAvailable,
      });
      if (!claimed) {
        return;
      }
    }

    const client = this.supabaseService.getAdminClient();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ledger = await this.getLedgerByUserId(userId);

      if (!ledger) {
        return;
      }

      if (ledger.balanceMode === 'real') {
        const realBefore = ledger.realBalance;
        const nextReal = Number((realBefore + amount).toFixed(2));
        const nextAvailable = Number(
          Math.max(nextReal - ledger.pendingBalance, 0).toFixed(2),
        );
        const { data, error } = await client
          .from('merchants')
          .update({
            real_balance: nextReal,
            available_balance: nextAvailable,
          })
          .eq('user_id', userId)
          .eq('real_balance', realBefore)
          .eq('pending_balance', ledger.pendingBalance)
          .select('id')
          .maybeSingle();

        if (error) {
          throw new InternalServerErrorException(
            'Failed to credit merchant after bank rejection',
          );
        }

        if (data) {
          return;
        }

        continue;
      }

      const demoBefore = ledger.demoBalance;
      const nextDemo = Number((demoBefore + amount).toFixed(2));
      const { data, error } = await client
        .from('merchants')
        .update({
          demo_balance: nextDemo,
          available_balance: nextDemo,
        })
        .eq('user_id', userId)
        .eq('demo_balance', demoBefore)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          'Failed to credit merchant after bank rejection',
        );
      }

      if (data) {
        return;
      }
    }

    throw new InternalServerErrorException(
      'Failed to credit merchant after concurrent updates',
    );
  }

  /**
   * Safe heal: pending stuck with no open transfers.
   * Drops ghost pending and the matching overstated collected.
   */
  async healStuckPendingBalance(userId: string): Promise<{
    healed: boolean;
    pendingBefore: number;
    realBefore: number;
    realAfter: number;
    reason: string;
  }> {
    return this.enqueueMerchantLedger(userId, () =>
      this.healStuckPendingBalanceLocked(userId),
    );
  }

  private async healStuckPendingBalanceLocked(userId: string): Promise<{
    healed: boolean;
    pendingBefore: number;
    realBefore: number;
    realAfter: number;
    reason: string;
  }> {
    const ledger = await this.getLedgerByUserId(userId);

    if (!ledger) {
      return {
        healed: false,
        pendingBefore: 0,
        realBefore: 0,
        realAfter: 0,
        reason: 'merchant_not_found',
      };
    }

    const pendingBefore = ledger.pendingBalance;
    const realBefore = ledger.realBalance;

    if (pendingBefore <= 0) {
      return {
        healed: false,
        pendingBefore,
        realBefore,
        realAfter: realBefore,
        reason: 'no_pending',
      };
    }

    const { data: openRows, error: openError } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .select('amount')
      .eq('user_id', userId)
      .in('status', ['PENDING_APPROVAL', 'PROCESSING']);

    if (openError) {
      throw new InternalServerErrorException(
        openError.message ?? 'Failed to load open transfers',
      );
    }

    const openSum = Number(
      (openRows ?? [])
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
        .toFixed(2),
    );

    if (openSum > 0) {
      if (Math.abs(openSum - pendingBefore) < 0.02) {
        return {
          healed: false,
          pendingBefore,
          realBefore,
          realAfter: realBefore,
          reason: 'pending_matches_open',
        };
      }

      return {
        healed: false,
        pendingBefore,
        realBefore,
        realAfter: realBefore,
        reason: `pending_mismatch_open:${openSum}`,
      };
    }

    const ghost = pendingBefore;
    const nextReal =
      ledger.balanceMode === 'real'
        ? Number(Math.max(realBefore - ghost, 0).toFixed(2))
        : realBefore;
    const nextAvailable =
      ledger.balanceMode === 'real' ? nextReal : ledger.demoBalance;

    const refId = `heal:stuck-pending:${userId}:${ghost}`;
    const claimed = await this.claimLedgerEvent({
      userId,
      merchantId: ledger.merchantId,
      direction: 'debit',
      amount: ghost,
      reason: 'balance_correction',
      refId,
      note: `Clear stuck pending ${ghost} with no open transfers (race leftover)`,
      realBefore,
      realAfter: nextReal,
      pendingBefore,
      pendingAfter: 0,
      availableAfter: nextAvailable,
    });

    if (!claimed) {
      return {
        healed: false,
        pendingBefore,
        realBefore,
        realAfter: realBefore,
        reason: 'already_healed',
      };
    }

    const updatePayload =
      ledger.balanceMode === 'real'
        ? {
            real_balance: nextReal,
            pending_balance: 0,
            available_balance: nextAvailable,
          }
        : {
            pending_balance: 0,
            available_balance: nextAvailable,
          };

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('pending_balance', pendingBefore)
      .eq('real_balance', realBefore)
      .select('real_balance, pending_balance')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        error.message ?? 'Failed to heal stuck pending',
      );
    }

    if (!data) {
      return {
        healed: false,
        pendingBefore,
        realBefore,
        realAfter: realBefore,
        reason: 'cas_conflict',
      };
    }

    this.logger.warn(
      `Healed stuck pending for ${userId}: pending ${pendingBefore}→0 real ${realBefore}→${nextReal}`,
    );

    return {
      healed: true,
      pendingBefore,
      realBefore,
      realAfter: Number(data.real_balance ?? nextReal),
      reason: 'healed_stuck_pending',
    };
  }

  async listMerchantLedgerSnapshots(): Promise<
    Array<{
      userId: string;
      merchantId: string;
      merchantName: string;
      realBalance: number;
      pendingBalance: number;
      balanceMode: 'real' | 'demo';
    }>
  > {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('merchants')
      .select(
        'id, user_id, merchant_name, real_balance, pending_balance, balance_mode',
      );

    if (error) {
      throw new InternalServerErrorException(
        error.message ?? 'Failed to list merchants for reconcile',
      );
    }

    return (data ?? []).map((row) => ({
      userId: row.user_id as string,
      merchantId: row.id as string,
      merchantName: String(row.merchant_name ?? ''),
      realBalance: Number(row.real_balance ?? 0),
      pendingBalance: Number(row.pending_balance ?? 0),
      balanceMode: row.balance_mode === 'real' ? 'real' : 'demo',
    }));
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

    return this.enqueueMerchantLedger(merchant.userId, () =>
      this.creditCollectDepositLocked(merchant, input),
    );
  }

  private async creditCollectDepositLocked(
    merchant: { userId: string; merchantId: string },
    input: {
      amount: number;
      dedupeKey: string;
      utr: string | null;
      remitterName: string | null;
      remitterAccount: string | null;
      callbackId: string | null;
      virtualAccount: string;
    },
  ): Promise<{ outcome: string; merchantId?: string }> {
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

    const credited = await this.addCollectedBalance(
      merchant.userId,
      input.amount,
    );
    const ledger = await this.getLedgerByUserId(merchant.userId);

    if (ledger) {
      const claimed = await this.claimLedgerEvent({
        userId: merchant.userId,
        merchantId: merchant.merchantId,
        direction: 'credit',
        amount: input.amount,
        reason: 'deposit',
        refId: input.dedupeKey,
        note: input.utr ? `UTR ${input.utr}` : undefined,
        realBefore: credited.realBefore,
        realAfter: credited.realAfter,
        pendingBefore: credited.pendingBalance,
        pendingAfter: credited.pendingBalance,
        availableAfter: Number(
          Math.max(credited.realAfter - credited.pendingBalance, 0).toFixed(2),
        ),
      });

      if (!claimed) {
        return { outcome: 'already_credited', merchantId: merchant.merchantId };
      }
    }

    return {
      outcome: 'credited',
      merchantId: merchant.merchantId,
    };
  }

  async applyCollectedCorrection(input: {
    userId: string;
    amount: number;
    refId: string;
    note: string;
  }): Promise<{ applied: boolean; realAfter: number }> {
    const ledger = await this.getLedgerByUserId(input.userId);

    if (!ledger) {
      throw new NotFoundException('Merchant profile not found');
    }

    const claimed = await this.claimLedgerEvent({
      userId: input.userId,
      merchantId: ledger.merchantId,
      direction: 'credit',
      amount: input.amount,
      reason: 'balance_correction',
      refId: input.refId,
      note: input.note,
      realBefore: ledger.realBalance,
      realAfter: Number((ledger.realBalance + input.amount).toFixed(2)),
      pendingBefore: ledger.pendingBalance,
      pendingAfter: ledger.pendingBalance,
      availableAfter: Number(
        Math.max(
          ledger.realBalance + input.amount - ledger.pendingBalance,
          0,
        ).toFixed(2),
      ),
    });

    if (!claimed) {
      return { applied: false, realAfter: ledger.realBalance };
    }

    const credited = await this.addCollectedBalance(input.userId, input.amount);

    return { applied: true, realAfter: credited.realAfter };
  }

  private async addCollectedBalance(
    userId: string,
    amount: number,
  ): Promise<{
    realBefore: number;
    realAfter: number;
    pendingBalance: number;
  }> {
    const fromRpc = await this.addCollectedBalanceViaLock(userId, amount);

    if (fromRpc) {
      return fromRpc;
    }

    const client = this.supabaseService.getAdminClient();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await this.getLedgerByUserId(userId);

      if (!current) {
        throw new NotFoundException('Merchant profile not found');
      }

      const realBefore = current.realBalance;
      const realAfter = Number((realBefore + amount).toFixed(2));
      const availableAfter = this.resolveAvailableBalance(
        realAfter,
        current.demoBalance,
        current.pendingBalance,
        current.balanceMode,
      );

      const { data, error } = await client
        .from('merchants')
        .update({
          real_balance: realAfter,
          available_balance: availableAfter,
        })
        .eq('user_id', userId)
        .eq('real_balance', realBefore)
        .select('real_balance, pending_balance')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          error.message ?? 'Failed to credit collected balance',
        );
      }

      if (data) {
        return {
          realBefore,
          realAfter: Number(data.real_balance),
          pendingBalance: Number(data.pending_balance ?? 0),
        };
      }
    }

    throw new InternalServerErrorException(
      'Failed to credit collected balance after concurrent updates',
    );
  }

  private async addCollectedBalanceViaLock(
    userId: string,
    amount: number,
  ): Promise<{
    realBefore: number;
    realAfter: number;
    pendingBalance: number;
  } | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .rpc('credit_merchant_collected', {
        p_user_id: userId,
        p_amount: amount,
      });

    if (error) {
      if (
        error.message.toLowerCase().includes('credit_merchant_collected') ||
        error.code === 'PGRST202' ||
        error.code === '42883'
      ) {
        return null;
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to credit collected balance',
      );
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return null;
    }

    return {
      realBefore: Number(row.real_before),
      realAfter: Number(row.real_after),
      pendingBalance: Number(row.pending_balance ?? 0),
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

  async listLedgerForUser(userId: string): Promise<LedgerEntry[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('ledger_entries')
      .select(
        'id, direction, amount, reason, ref_id, note, real_before, real_after, pending_before, pending_after, available_after, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      if (this.isMissingLedgerTable(error.message, error.code)) {
        return [];
      }

      throw new InternalServerErrorException(
        error.message ?? 'Failed to load balance log',
      );
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      direction: row.direction === 'debit' ? 'debit' : 'credit',
      amount: Number(row.amount ?? 0),
      reason: String(row.reason ?? ''),
      ref_id: String(row.ref_id ?? ''),
      note: (row.note as string | null) ?? null,
      real_before:
        row.real_before == null ? null : Number(row.real_before),
      real_after: row.real_after == null ? null : Number(row.real_after),
      pending_before:
        row.pending_before == null ? null : Number(row.pending_before),
      pending_after:
        row.pending_after == null ? null : Number(row.pending_after),
      available_after:
        row.available_after == null ? null : Number(row.available_after),
      created_at: row.created_at as string,
    }));
  }

  private isMissingLedgerTable(message: string, code?: string): boolean {
    return (
      code === '42P01' ||
      code === 'PGRST205' ||
      (message.toLowerCase().includes('ledger_entries') &&
        (message.toLowerCase().includes('does not exist') ||
          message.toLowerCase().includes('schema cache')))
    );
  }

  private async claimLedgerEvent(input: {
    userId: string;
    merchantId: string;
    direction: 'credit' | 'debit';
    amount: number;
    reason: string;
    refId: string;
    note?: string;
    realBefore: number;
    realAfter: number;
    pendingBefore: number;
    pendingAfter: number;
    availableAfter: number;
  }): Promise<boolean> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('ledger_entries')
      .insert({
        user_id: input.userId,
        merchant_id: input.merchantId,
        direction: input.direction,
        amount: input.amount,
        reason: input.reason,
        ref_id: input.refId,
        note: input.note ?? null,
        real_before: input.realBefore,
        real_after: input.realAfter,
        pending_before: input.pendingBefore,
        pending_after: input.pendingAfter,
        available_after: input.availableAfter,
      });

    if (!error) {
      return true;
    }

    if (error.code === '23505') {
      return false;
    }

    if (this.isMissingLedgerTable(error.message, error.code)) {
      this.logger.warn(
        'ledger_entries table missing — run the SQL in 001_schema.sql, continuing without a log row',
      );
      return true;
    }

    throw new InternalServerErrorException(
      error.message ?? 'Failed to record balance log',
    );
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
