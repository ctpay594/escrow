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
import { TransfersService, TransferReconcileService } from '../transfers';
import type { TransferStatus } from '../transfers/transfers.types';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminAuthService, AdminUsersService } from './admin.service';
import type { AdminJwtPayload } from './admin.types';
import { CurrentAdmin } from './current-admin.decorator';
import {
  AdminBootstrapDto,
  AdminLoginDto,
} from './dto/admin-login.dto';
import {
  CreateManagedUserDto,
  FetchEscrowDetailsDto,
  ResetManagedPasswordDto,
  UpdateDemoBalanceDto,
  UpdateBalanceModeDto,
  UpdateAccountStatusDto,
  UpdateManagedUsernameDto,
} from './dto/managed-user.dto';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('bootstrap')
  bootstrap(@Body() dto: AdminBootstrapDto) {
    return this.adminAuthService.bootstrap(dto);
  }

  @Post('login')
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

@Controller('admin/users')
@UseGuards(AdminJwtAuthGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  listUsers() {
    return this.adminUsersService.listUsers();
  }

  @Post('fetch-escrow-details')
  fetchEscrowDetails(@Body() dto: FetchEscrowDetailsDto) {
    return this.adminUsersService.fetchEscrowDetails(dto);
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
