import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LoginRateLimitGuard } from '../common/login-rate-limit.guard';
import { TransfersService, TransferReconcileService } from '../transfers';
import type { TransferStatus } from '../transfers/transfers.types';
import { CreateBulkTransferDto } from '../transfers/dto/create-bulk-transfer.dto';
import { CreateTransferDto } from '../transfers/dto/create-transfer.dto';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthService, AdminUsersService } from './admin.service';
import { BankSyncService } from '../bank-sync';
import type { AdminJwtPayload } from './admin.types';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminLoginDto } from './dto/admin-login.dto';
import {
  CreateManagedUserDto,
  ResetManagedPasswordDto,
  UpdateDemoBalanceDto,
  UpdateBalanceModeDto,
  UpdateApprovalModeDto,
  UpdateAccountStatusDto,
  UpdateManagedUsernameDto,
} from './dto/managed-user.dto';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminAuthService.getProfile(admin);
  }

  @Post('logout')
  logout() {
    return { message: 'Logged out' };
  }
}

@Controller('admin/bank')
@UseGuards(AdminJwtAuthGuard)
export class AdminBankController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get('balance')
  getCompanyBankBalance() {
    return this.adminUsersService.fetchCompanyBankBalance();
  }
}

@Controller('admin/users')
@UseGuards(AdminJwtAuthGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  listUsers() {
    return this.adminUsersService.listUsers();
  }

  @Post()
  createUser(@Body() dto: CreateManagedUserDto) {
    return this.adminUsersService.createUser(dto);
  }

  @Patch(':id/username')
  updateUsername(
    @Param('id') id: string,
    @Body() dto: UpdateManagedUsernameDto,
  ) {
    return this.adminUsersService.updateUsername(id, dto);
  }

  @Patch(':id/password')
  updatePassword(
    @Param('id') id: string,
    @Body() dto: ResetManagedPasswordDto,
  ) {
    return this.adminUsersService.updatePassword(id, dto);
  }

  @Patch(':id/demo-balance')
  updateDemoBalance(
    @Param('id') id: string,
    @Body() dto: UpdateDemoBalanceDto,
  ) {
    return this.adminUsersService.updateDemoBalance(id, dto.demo_balance);
  }

  @Patch(':id/balance-mode')
  updateBalanceMode(
    @Param('id') id: string,
    @Body() dto: UpdateBalanceModeDto,
  ) {
    return this.adminUsersService.updateBalanceMode(id, dto.balance_mode);
  }

  @Patch(':id/approval-mode')
  updateApprovalMode(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalModeDto,
  ) {
    return this.adminUsersService.updateApprovalMode(id, dto.approval_mode);
  }

  @Patch(':id/account-status')
  updateAccountStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.adminUsersService.updateAccountStatus(id, dto.account_status);
  }

  @Post(':id/refresh-balance')
  refreshRealBalance(@Param('id') id: string) {
    return this.adminUsersService.refreshRealBalance(id);
  }

  @Get('deposits')
  listAllDeposits() {
    return this.adminUsersService.listAllDeposits();
  }

  @Get(':id/deposits')
  listDeposits(@Param('id') id: string) {
    return this.adminUsersService.listDeposits(id);
  }

  @Get(':id/ledger')
  listLedger(@Param('id') id: string) {
    return this.adminUsersService.listLedger(id);
  }

  @Delete(':id')
  deleteUser(@Param('id') id: string) {
    return this.adminUsersService.deleteUser(id);
  }
}

@Controller('admin/transfers')
@UseGuards(AdminJwtAuthGuard)
export class AdminTransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly transferReconcileService: TransferReconcileService,
  ) {}

  @Get()
  listTransfers(
    @Query('status') status?: TransferStatus,
    @Query('user_id') userId?: string,
  ) {
    return this.transfersService.listTransfersForAdmin(status, userId);
  }

  @Post('company')
  createCompanyTransfer(@Body() dto: CreateTransferDto) {
    return this.transfersService.createCompanyTransfer({
      amount: dto.amount,
      payoutMode: dto.payout_mode,
      transactionNote: dto.transaction_note,
      beneficiaryAccountName: dto.beneficiary_account_name,
      beneficiaryAccountNo: dto.beneficiary_account_no,
      beneficiaryIfsc: dto.beneficiary_ifsc,
      beneficiaryVpa: dto.beneficiary_vpa,
    });
  }

  @Post('company/bulk')
  createCompanyBulkTransfer(@Body() dto: CreateBulkTransferDto) {
    return this.transfersService.createCompanyBulkTransfer(
      dto.transfers.map((item) => ({
        amount: item.amount,
        payoutMode: item.payout_mode,
        transactionNote: item.transaction_note,
        beneficiaryAccountName: item.beneficiary_account_name,
        beneficiaryAccountNo: item.beneficiary_account_no,
        beneficiaryIfsc: item.beneficiary_ifsc,
        beneficiaryVpa: item.beneficiary_vpa,
      })),
      dto.label,
    );
  }

  @Post('reconcile-status')
  reconcileStatus(@Query('user_id') userId?: string) {
    if (userId) {
      return this.transfersService.reconcileProcessingTransfers({ userId });
    }

    return this.transfersService.reconcileAllProcessingTransfers();
  }

  @Post('batches/:batchId/approve-all')
  async approveBatch(@Param('batchId') batchId: string) {
    const result = await this.transfersService.approveBatch(batchId);
    if (result.approved > 0) {
      this.transferReconcileService.scheduleReconcile();
    }
    return result;
  }

  @Post(':id/approve')
  async approveTransfer(@Param('id') id: string) {
    const transfer = await this.transfersService.approveTransfer(id);
    this.transferReconcileService.scheduleReconcile();
    return transfer;
  }

  @Post(':id/reject')
  rejectTransfer(@Param('id') id: string) {
    return this.transfersService.rejectTransfer(id);
  }
}

@Controller('admin/analytics')
@UseGuards(AdminJwtAuthGuard)
export class AdminAnalyticsController {
  constructor(private readonly adminAnalyticsService: AdminAnalyticsService) {}

  @Get()
  getAnalytics(
    @Query('user_id') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminAnalyticsService.getAnalytics({
      userId: userId?.trim() || undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }
}

@Controller('admin/bank-sync')
@UseGuards(AdminJwtAuthGuard)
export class AdminBankSyncController {
  constructor(private readonly bankSyncService: BankSyncService) {}

  @Get('status')
  getStatus() {
    return this.bankSyncService.getStatus();
  }

  @Get('runs')
  listRuns() {
    return this.bankSyncService.listRecentRuns();
  }

  @Get('notifications')
  listNotifications() {
    return this.bankSyncService.listNotifications();
  }

  @Post('notifications/read')
  markNotificationsRead(@Body() body: { ids?: string[] }) {
    return this.bankSyncService.markNotificationsRead(body.ids);
  }

  @Post('run')
  runManualSync() {
    return this.bankSyncService.runManualSync();
  }
}
