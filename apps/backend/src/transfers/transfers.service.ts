import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EscrowStackService } from '../escrowstack';
import type { PayoutItem } from '../escrowstack/escrowstack.types';
import { MerchantsService } from '../merchants';
import { SupabaseService } from '../supabase';
import { UsersService } from '../users';
import { generatePayoutRef } from './payout-ref.util';
import { TransferReconcileService } from './transfer-reconcile.service';
import type {
  AdminTransferListItem,
  ApproveBatchResult,
  BulkTransferResult,
  CreateTransferInput,
  PublicTransfer,
  ReconcileTransfersResult,
  TransferRecord,
  TransferStatus,
  UserTransfersListResult,
} from './transfers.types';

const PUBLIC_TRANSFER_FIELDS =
  'payout_ref, amount, payout_mode, transaction_note, beneficiary_account_name, beneficiary_account_no, beneficiary_ifsc, beneficiary_vpa, status, utr, bank_ref, created_at, updated_at';

const PUBLIC_TRANSFER_SELECT = `id, ${PUBLIC_TRANSFER_FIELDS}`;

const PUBLIC_TRANSFER_SELECT_WITH_BATCH = `id, batch_id, ${PUBLIC_TRANSFER_FIELDS}`;

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly merchantsService: MerchantsService,
    private readonly escrowStackService: EscrowStackService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TransferReconcileService))
    private readonly transferReconcileService: TransferReconcileService,
  ) {}

  async createTransfer(input: CreateTransferInput): Promise<PublicTransfer> {
    this.validateTransferRules(input);

    await this.merchantsService.assertCanTransfer(input.userId);

    const [ledger, portalUser] = await Promise.all([
      this.merchantsService.getLedgerByUserId(input.userId),
      this.usersService.findById(input.userId),
    ]);

    if (!ledger) {
      throw new NotFoundException('Merchant profile not found');
    }

    if (ledger.spendable < input.amount) {
      throw new BadRequestException('Insufficient available balance');
    }

    const payee =
      this.tryResolvePayee(ledger, portalUser?.username) ??
      this.resolvePayee(
        await this.merchantsService.getApiKeyByUserId(input.userId),
        ledger,
        portalUser?.username,
      );

    const payoutRef = generatePayoutRef();

    await this.merchantsService.holdFundsForTransfer(
      input.userId,
      input.amount,
      ledger,
    );

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .insert({
        user_id: input.userId,
        merchant_id: ledger.merchantId,
        payout_ref: payoutRef,
        amount: input.amount,
        payout_mode: input.payoutMode,
        transaction_note: input.transactionNote ?? null,
        beneficiary_account_name: input.beneficiaryAccountName,
        beneficiary_account_no: input.beneficiaryAccountNo ?? null,
        beneficiary_ifsc: input.beneficiaryIfsc ?? null,
        beneficiary_vpa: input.beneficiaryVpa ?? null,
        payee_user_ref: payee.userRef,
        payee_user_name: payee.userName,
        status: 'PENDING_APPROVAL',
      })
      .select('id')
      .single();

    if (error || !data) {
      await this.merchantsService.releaseHeldFunds(input.userId, input.amount);

      throw new InternalServerErrorException(
        'Failed to create transfer request',
      );
    }

    return this.dispatchCreatedTransfer(
      (data as TransferRecord).id,
      ledger.approvalMode,
    );
  }

  async createBulkTransfer(
    userId: string,
    items: CreateTransferInput[],
    label?: string,
  ): Promise<BulkTransferResult> {
    if (items.length === 0) {
      throw new BadRequestException('At least one transfer is required');
    }

    if (items.length > 500) {
      throw new BadRequestException('Maximum 500 transfers per bulk upload');
    }

    for (const item of items) {
      this.validateTransferRules(item);
    }

    await this.merchantsService.assertCanTransfer(userId);

    const totalAmount = Number(
      items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    );

    const [ledger, portalUser] = await Promise.all([
      this.merchantsService.getLedgerByUserId(userId),
      this.usersService.findById(userId),
    ]);

    if (!ledger) {
      throw new NotFoundException('Merchant profile not found');
    }

    if (ledger.spendable < totalAmount) {
      throw new BadRequestException(
        `Insufficient balance. Need ${totalAmount}, available ${ledger.spendable}`,
      );
    }

    const payee =
      this.tryResolvePayee(ledger, portalUser?.username) ??
      this.resolvePayee(
        await this.merchantsService.getApiKeyByUserId(userId),
        ledger,
        portalUser?.username,
      );

    const { data: batchRow, error: batchError } = await this.supabaseService
      .getAdminClient()
      .from('transfer_batches')
      .insert({
        user_id: userId,
        merchant_id: ledger.merchantId,
        label: label?.trim() || null,
        total_amount: totalAmount,
        transfer_count: items.length,
      })
      .select('id, label, total_amount, transfer_count, created_at')
      .single();

    if (batchError || !batchRow) {
      throw new InternalServerErrorException('Failed to create transfer batch');
    }

    const batchId = batchRow.id as string;
    const createdTransfers: PublicTransfer[] = [];
    const heldAmounts: number[] = [];

    try {
      for (const item of items) {
        await this.merchantsService.holdFundsForTransfer(userId, item.amount);
        heldAmounts.push(item.amount);

        const payoutRef = generatePayoutRef();
        const { data, error } = await this.supabaseService
          .getAdminClient()
          .from('transfers')
          .insert({
            user_id: userId,
            merchant_id: ledger.merchantId,
            batch_id: batchId,
            payout_ref: payoutRef,
            amount: item.amount,
            payout_mode: item.payoutMode,
            transaction_note: item.transactionNote ?? null,
            beneficiary_account_name: item.beneficiaryAccountName,
            beneficiary_account_no: item.beneficiaryAccountNo ?? null,
            beneficiary_ifsc: item.beneficiaryIfsc ?? null,
            beneficiary_vpa: item.beneficiaryVpa ?? null,
            payee_user_ref: payee.userRef,
            payee_user_name: payee.userName,
            status: 'PENDING_APPROVAL',
          })
          .select('id')
          .single();

        if (error || !data) {
          throw new InternalServerErrorException(
            'Failed to create bulk transfer row',
          );
        }

        createdTransfers.push(
          this.toPublicTransfer(
            await this.fetchTransferRowById((data as TransferRecord).id),
          ),
        );
      }
    } catch (error) {
      for (let index = heldAmounts.length - 1; index >= 0; index -= 1) {
        await this.merchantsService.releaseHeldFunds(
          userId,
          heldAmounts[index],
        );
      }

      await this.supabaseService
        .getAdminClient()
        .from('transfers')
        .delete()
        .eq('batch_id', batchId);

      await this.supabaseService
        .getAdminClient()
        .from('transfer_batches')
        .delete()
        .eq('id', batchId);

      throw error;
    }

    const created = {
      batch: {
        id: batchId,
        label: (batchRow.label as string | null) ?? null,
        total_amount: Number(batchRow.total_amount),
        transfer_count: Number(batchRow.transfer_count),
        created_at: batchRow.created_at as string,
      },
      transfers: createdTransfers,
      total_amount: totalAmount,
      transfer_count: items.length,
    };

    if (ledger.approvalMode !== 'auto') {
      return created;
    }

    try {
      const approval = await this.approveBatch(batchId);

      if (approval.approved > 0) {
        this.transferReconcileService.scheduleReconcile();
      }

      if (approval.failed.length > 0) {
        this.logger.warn(
          `Auto-approve batch ${batchId}: ${approval.approved} sent, ${approval.failed.length} still pending`,
        );
      }

      const approvedById = new Map(
        approval.transfers.map((transfer) => [transfer.id, transfer]),
      );

      return {
        ...created,
        transfers: createdTransfers.map(
          (transfer) => approvedById.get(transfer.id) ?? transfer,
        ),
      };
    } catch (error) {
      this.logger.error(
        `Auto-approve batch ${batchId} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      return created;
    }
  }

  async approveBatch(batchId: string): Promise<ApproveBatchResult> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .select('id, payout_ref, status')
      .eq('batch_id', batchId)
      .eq('status', 'PENDING_APPROVAL')
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to load batch transfers');
    }

    const pending = data ?? [];

    if (pending.length === 0) {
      throw new BadRequestException('No pending transfers in this batch');
    }

    const approvedTransfers: PublicTransfer[] = [];
    const failed: ApproveBatchResult['failed'] = [];

    for (const row of pending) {
      try {
        const transfer = await this.approveTransfer(row.id as string);
        approvedTransfers.push(transfer);
      } catch (approveError) {
        failed.push({
          transfer_id: row.id as string,
          payout_ref: row.payout_ref as string,
          message:
            approveError instanceof Error
              ? approveError.message
              : 'Approval failed',
        });
      }
    }

    return {
      batch_id: batchId,
      approved: approvedTransfers.length,
      failed,
      transfers: approvedTransfers,
    };
  }

  async listTransfersForUser(userId: string): Promise<UserTransfersListResult> {
    const [rows, batchesResult] = await Promise.all([
      this.fetchTransferRows((select) =>
        this.supabaseService
          .getAdminClient()
          .from('transfers')
          .select(select)
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ),
      this.supabaseService
        .getAdminClient()
        .from('transfer_batches')
        .select('id, label, total_amount, transfer_count, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (batchesResult.error) {
      throw new InternalServerErrorException('Failed to load transfer batches');
    }

    return {
      transfers: rows.map((row) =>
        this.toPublicTransfer(row as TransferRecord),
      ),
      batches: (batchesResult.data ?? []).map((batch) => ({
        id: batch.id as string,
        label: (batch.label as string | null) ?? null,
        total_amount: Number(batch.total_amount),
        transfer_count: Number(batch.transfer_count),
        created_at: batch.created_at as string,
      })),
    };
  }

  listDepositsForUser(userId: string) {
    return this.merchantsService.listDepositsForUser(userId);
  }

  async listTransfersForAdmin(
    status?: TransferStatus,
    userId?: string,
  ): Promise<AdminTransferListItem[]> {
    const rows = await this.fetchTransferRows((select) => {
      let query = this.supabaseService
        .getAdminClient()
        .from('transfers')
        .select(
          `${select}, user_id, merchant_id, payee_user_ref, payee_user_name, escrow_response, users ( username ), merchants ( merchant_name )`,
        )
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      if (userId) {
        query = query.eq('user_id', userId);
      }

      return query;
    });

    return rows.map((row) =>
      this.toAdminTransfer(row as Record<string, unknown>),
    );
  }

  async approveTransfer(transferId: string): Promise<PublicTransfer> {
    const transfer = await this.findTransferById(transferId);

    if (transfer.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Transfer is not pending approval');
    }

    const credentials = await this.merchantsService.getDecryptedCredentials(
      transfer.user_id,
    );
    const payee =
      transfer.payee_user_ref && transfer.payee_user_ref.length >= 5
        ? {
            userRef: transfer.payee_user_ref,
            userName: transfer.payee_user_name ?? transfer.payee_user_ref,
          }
        : this.resolvePayee(credentials.apiKey, {
            userRef: transfer.payee_user_ref,
            merchantName: transfer.payee_user_name,
          });
    const payoutItem = this.buildPayoutItem(transfer, payee);
    const result = await this.escrowStackService.submitPayout(
      credentials.apiKey,
      credentials.privateKey,
      [payoutItem],
    );

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .update({
        status: 'PROCESSING',
        escrow_response: result.raw,
      })
      .eq('id', transferId);

    if (updateError) {
      throw new InternalServerErrorException(
        'Payout submitted but failed to update transfer status',
      );
    }

    return this.toPublicTransfer(await this.fetchTransferRowById(transferId));
  }

  private async dispatchCreatedTransfer(
    transferId: string,
    approvalMode: 'auto' | 'manual',
  ): Promise<PublicTransfer> {
    if (approvalMode !== 'auto') {
      return this.toPublicTransfer(await this.fetchTransferRowById(transferId));
    }

    try {
      const transfer = await this.approveTransfer(transferId);
      this.transferReconcileService.scheduleReconcile();
      return transfer;
    } catch (error) {
      this.logger.error(
        `Auto-approve failed for transfer ${transferId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      return this.toPublicTransfer(await this.fetchTransferRowById(transferId));
    }
  }

  async reconcileAllProcessingTransfers(): Promise<ReconcileTransfersResult> {
    return this.reconcileProcessingTransfers();
  }

  async reconcileProcessingTransfersForUser(
    userId: string,
  ): Promise<ReconcileTransfersResult> {
    return this.reconcileProcessingTransfers({ userId });
  }

  async reconcileProcessingTransfers(options?: {
    userId?: string;
    merchantId?: string;
  }): Promise<ReconcileTransfersResult> {
    let query = this.supabaseService
      .getAdminClient()
      .from('transfers')
      .select('*')
      .eq('status', 'PROCESSING')
      .order('created_at', { ascending: false });

    if (options?.userId) {
      query = query.eq('user_id', options.userId);
    }

    if (options?.merchantId) {
      query = query.eq('merchant_id', options.merchantId);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load processing transfers',
      );
    }

    const transfers = (data ?? []) as TransferRecord[];

    if (transfers.length === 0) {
      return {
        checked: 0,
        updated: 0,
        stillProcessing: 0,
        transfers: [],
      };
    }

    const credentials = this.merchantsService.getPlatformCredentials();
    const statusResult = await this.escrowStackService.getPayoutStatus(
      credentials.apiKey,
      transfers.flatMap((transfer) => {
        const dates = [
          ...new Set(
            [
              this.toIstTxnDate(transfer.updated_at),
              this.toIstTxnDate(transfer.created_at),
            ].filter(Boolean),
          ),
        ];

        return dates.map((txnDate) => ({
          payoutRef: transfer.payout_ref,
          txnDate,
          mode: transfer.payout_mode,
        }));
      }),
    );
    const statusByRef = new Map(
      statusResult.entries.map((entry) => [entry.payout_ref, entry]),
    );

    let updated = 0;
    const updatedTransfers: PublicTransfer[] = [];

    for (const transfer of transfers) {
      const entry = statusByRef.get(transfer.payout_ref);

      if (!entry) {
        continue;
      }

      const applied = await this.applyPayoutStatusUpdate(transfer, entry);

      if (applied) {
        updated += 1;
        updatedTransfers.push(applied);
      }
    }

    const stillProcessing = transfers.filter((transfer) => {
      const updatedTransfer = updatedTransfers.find(
        (item) => item.id === transfer.id,
      );

      if (!updatedTransfer) {
        return true;
      }

      return updatedTransfer.status === 'PROCESSING';
    }).length;

    return {
      checked: transfers.length,
      updated,
      stillProcessing,
      transfers: updatedTransfers,
    };
  }

  async handleEscrowPayoutWebhook(
    raw: Record<string, unknown>,
  ): Promise<{ outcome: string }> {
    const payoutRef =
      this.pickWebhookString(raw, 'payout_ref') ??
      this.pickWebhookString(raw, 'PAYMENTREFNO');

    if (!payoutRef) {
      return { outcome: 'ignored_no_payout_ref' };
    }

    const transfer = await this.fetchTransferByPayoutRef(payoutRef);

    if (!transfer) {
      return { outcome: 'transfer_not_found' };
    }

    if (transfer.status !== 'PROCESSING') {
      if (transfer.status === 'SUCCESS' || transfer.status === 'FAILED') {
        return { outcome: 'already_final' };
      }

      return { outcome: `ignored_status_${transfer.status}` };
    }

    const entry = {
      status:
        this.pickWebhookString(raw, 'status') ??
        this.pickWebhookString(raw, 'TXN_STATUS') ??
        this.pickWebhookString(raw, 'code') ??
        '',
      utr:
        this.pickWebhookString(raw, 'bankref') ??
        this.pickWebhookString(raw, 'UTR_NO') ??
        this.pickWebhookString(raw, 'utr') ??
        undefined,
      bank_ref:
        this.pickWebhookString(raw, 'bankref') ??
        this.pickWebhookString(raw, 'TXN_REFERENCE_NO') ??
        undefined,
      raw,
    };

    const applied = await this.applyPayoutStatusUpdate(transfer, entry);

    return { outcome: applied ? 'updated' : 'no_change' };
  }

  private async fetchTransferByPayoutRef(
    payoutRef: string,
  ): Promise<TransferRecord | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .select('*')
      .eq('payout_ref', payoutRef)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to load transfer');
    }

    return data ? (data as TransferRecord) : null;
  }

  private pickWebhookString(
    raw: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = raw[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }

  private async applyPayoutStatusUpdate(
    transfer: TransferRecord,
    entry: {
      status: string;
      utr?: string;
      bank_ref?: string;
      raw: Record<string, unknown>;
    },
  ): Promise<PublicTransfer | null> {
    if (transfer.status !== 'PROCESSING') {
      return null;
    }

    const mappedStatus = this.mapEscrowStatus(entry.status, entry.raw);
    const bankRef = entry.bank_ref?.trim() || null;
    const utr = entry.utr?.trim() || bankRef;

    if (mappedStatus === 'PROCESSING') {
      if (!utr && !bankRef) {
        return null;
      }

      const { error: utrError } = await this.supabaseService
        .getAdminClient()
        .from('transfers')
        .update({
          utr,
          bank_ref: bankRef,
        })
        .eq('id', transfer.id)
        .eq('status', 'PROCESSING');

      if (utrError) {
        return null;
      }

      return this.toPublicTransfer(
        await this.fetchTransferRowById(transfer.id),
      );
    }

    if (mappedStatus === 'SUCCESS') {
      await this.merchantsService.clearPendingForSuccessfulTransfer(
        transfer.user_id,
        Number(transfer.amount),
      );
    } else if (mappedStatus === 'FAILED') {
      await this.merchantsService.releaseHeldFunds(
        transfer.user_id,
        Number(transfer.amount),
      );
    }

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .update({
        status: mappedStatus,
        utr,
        bank_ref: bankRef,
        escrow_response: entry.raw,
      })
      .eq('id', transfer.id)
      .eq('status', 'PROCESSING');

    if (updateError) {
      return null;
    }

    return this.toPublicTransfer(await this.fetchTransferRowById(transfer.id));
  }

  private mapEscrowStatus(
    status: string,
    raw: Record<string, unknown>,
  ): TransferStatus {
    const normalized = status.trim().toLowerCase();
    const code = this.pickStatusCode(raw);

    if (
      code === 'po_bp_dcp' ||
      code === 'txsett' ||
      normalized === 'processed' ||
      normalized === 'completed' ||
      normalized === 'complete' ||
      normalized === 'success' ||
      normalized === 'txsett' ||
      normalized === 'settled'
    ) {
      return 'SUCCESS';
    }

    if (
      code === 'err_bp_ipr' ||
      code === 'txrej' ||
      code === 'txfail' ||
      normalized.includes('fail') ||
      normalized.includes('error') ||
      normalized.includes('reject') ||
      normalized.includes('return') ||
      normalized.includes('revers')
    ) {
      return 'FAILED';
    }

    if (
      code === 'el_ps' ||
      normalized === 'pending' ||
      normalized === 'submitted' ||
      normalized === 'unknown'
    ) {
      return 'PROCESSING';
    }

    return 'PROCESSING';
  }

  private toIstTxnDate(iso: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  }

  private pickStatusCode(raw: Record<string, unknown>): string | null {
    const code = raw.code ?? raw.status_code ?? raw.statusCode ?? raw.OD_STATUS ?? raw.TXN_STATUS;

    if (typeof code === 'string') {
      return code.trim().toLowerCase();
    }

    return null;
  }

  async rejectTransfer(transferId: string): Promise<PublicTransfer> {
    const transfer = await this.findTransferById(transferId);

    if (transfer.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Transfer is not pending approval');
    }

    await this.merchantsService.releaseHeldFunds(
      transfer.user_id,
      Number(transfer.amount),
    );

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .update({ status: 'REJECTED' })
      .eq('id', transferId);

    if (updateError) {
      throw new InternalServerErrorException('Failed to reject transfer');
    }

    return this.toPublicTransfer(await this.fetchTransferRowById(transferId));
  }

  private async findTransferById(transferId: string): Promise<TransferRecord> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('transfers')
      .select('*')
      .eq('id', transferId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to load transfer');
    }

    if (!data) {
      throw new NotFoundException('Transfer not found');
    }

    return data as TransferRecord;
  }

  private tryResolvePayee(
    ledger: { userRef?: string | null; merchantName?: string | null },
    portalUsername?: string | null,
  ): { userRef: string; userName: string } | null {
    const candidates = [ledger.userRef, portalUsername, ledger.merchantName]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value);

    const payeeId = candidates.find((value) => value.length >= 5);

    if (!payeeId) {
      return null;
    }

    return { userRef: payeeId, userName: payeeId };
  }

  private resolvePayee(
    apiKey: string,
    ledger: { userRef?: string | null; merchantName?: string | null },
    portalUsername?: string | null,
  ): {
    userRef: string;
    userName: string;
  } {
    const jwtName =
      this.escrowStackService.decodeMerchantNameFromApiKey(apiKey);

    const candidates = [
      ledger.userRef,
      jwtName,
      portalUsername,
      ledger.merchantName,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value);

    const payeeId =
      candidates.find((value) => value.length >= 5) ?? candidates[0];

    if (!payeeId) {
      throw new BadRequestException(
        'EscrowStack payee not found. Set payee.user_ref like Postman (e.g. testuser).',
      );
    }

    if (payeeId.length < 5) {
      throw new BadRequestException(
        'payee user_ref must be at least 5 characters. Re-onboard with username testuser or update merchant user_ref.',
      );
    }

    return { userRef: payeeId, userName: payeeId };
  }

  private buildPayoutItem(
    transfer: TransferRecord,
    payee: { userRef: string; userName: string },
  ): PayoutItem {
    const beneficiary =
      transfer.payout_mode === 'UPI'
        ? {
            account_name: transfer.beneficiary_account_name,
            vpa: transfer.beneficiary_vpa ?? undefined,
          }
        : {
            account_name: transfer.beneficiary_account_name,
            account_no: transfer.beneficiary_account_no ?? undefined,
            ifsc: transfer.beneficiary_ifsc ?? undefined,
          };

    return {
      payout_ref: transfer.payout_ref,
      amount: Number(transfer.amount),
      payout_mode: transfer.payout_mode,
      transaction_note: transfer.transaction_note?.trim() || 'payout',
      payee: {
        user_ref: payee.userRef,
        user_name: payee.userName ?? '',
      },
      beneficiary,
    };
  }

  private toAdminTransfer(row: Record<string, unknown>): AdminTransferListItem {
    const users = row.users as { username?: string } | null;
    const merchants = row.merchants as { merchant_name?: string } | null;

    return {
      ...this.toPublicTransfer(row as unknown as TransferRecord),
      user_id: String(row.user_id),
      merchant_id: String(row.merchant_id),
      username: users?.username ?? '—',
      merchant_name: merchants?.merchant_name ?? '—',
      payee_user_ref: row.payee_user_ref ? String(row.payee_user_ref) : null,
      payee_user_name: row.payee_user_name ? String(row.payee_user_name) : null,
      escrow_response:
        row.escrow_response && typeof row.escrow_response === 'object'
          ? (row.escrow_response as Record<string, unknown>)
          : null,
    };
  }

  private isMissingBatchColumnError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes('batch_id') || normalized.includes('transfer_batches')
    );
  }

  private transferSelectCandidates(): string[] {
    return [PUBLIC_TRANSFER_SELECT_WITH_BATCH, PUBLIC_TRANSFER_SELECT];
  }

  private async fetchTransferRows(
    run: (select: string) => PromiseLike<{
      data: unknown[] | null;
      error: { message: string } | null;
    }>,
  ): Promise<unknown[]> {
    for (const select of this.transferSelectCandidates()) {
      const { data, error } = await run(select);

      if (!error) {
        return data ?? [];
      }

      if (!this.isMissingBatchColumnError(error.message)) {
        throw new InternalServerErrorException('Failed to load transfers');
      }
    }

    throw new InternalServerErrorException('Failed to load transfers');
  }

  private async fetchTransferRowById(
    transferId: string,
  ): Promise<TransferRecord> {
    for (const select of this.transferSelectCandidates()) {
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .from('transfers')
        .select(select)
        .eq('id', transferId)
        .maybeSingle();

      if (!error && data) {
        return data as unknown as TransferRecord;
      }

      if (error && !this.isMissingBatchColumnError(error.message)) {
        throw new InternalServerErrorException('Failed to load transfer');
      }
    }

    throw new InternalServerErrorException('Failed to load transfer');
  }

  private validateTransferRules(input: CreateTransferInput): void {
    if (input.payoutMode === 'RTGS' && input.amount < 200_000) {
      throw new BadRequestException(
        'RTGS transfers require a minimum of ₹2,00,000',
      );
    }

    if (input.payoutMode === 'UPI') {
      if (!input.beneficiaryVpa?.trim()) {
        throw new BadRequestException('UPI ID is required for UPI transfers');
      }

      return;
    }

    if (!input.beneficiaryAccountNo?.trim() || !input.beneficiaryIfsc?.trim()) {
      throw new BadRequestException(
        'Account number and IFSC are required for bank transfers',
      );
    }
  }

  private toPublicTransfer(record: TransferRecord): PublicTransfer {
    return {
      id: record.id,
      batch_id: record.batch_id ?? null,
      payout_ref: record.payout_ref,
      amount: Number(record.amount),
      payout_mode: record.payout_mode,
      transaction_note: record.transaction_note,
      beneficiary_account_name: record.beneficiary_account_name,
      beneficiary_account_no: record.beneficiary_account_no,
      beneficiary_ifsc: record.beneficiary_ifsc,
      beneficiary_vpa: record.beneficiary_vpa,
      status: record.status,
      utr: record.utr ?? null,
      bank_ref: record.bank_ref ?? null,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}
