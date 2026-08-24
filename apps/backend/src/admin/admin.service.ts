import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminsService } from '../admins';
import { EscrowStackService } from '../escrowstack';
import { MerchantsService } from '../merchants';
import { UsersService } from '../users';
import type { AdminAuthResponse, AdminJwtPayload } from './admin.types';
import type { AdminLoginDto } from './dto/admin-login.dto';
import type {
  CreateManagedUserDto,
  ResetManagedPasswordDto,
  UpdateManagedUsernameDto,
} from './dto/managed-user.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly adminsService: AdminsService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminAuthResponse> {
    const admin = await this.adminsService.findByUsername(dto.username.trim());

    if (!admin || admin.password !== dto.password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.buildAuthResponse({
      id: admin.id,
      username: admin.username,
    });
  }

  async getProfile(payload: AdminJwtPayload) {
    const admin = await this.adminsService.findById(payload.sub);

    if (!admin) {
      throw new UnauthorizedException('Admin no longer exists');
    }

    return { admin };
  }

  private buildAuthResponse(admin: {
    id: string;
    username: string;
  }): AdminAuthResponse {
    const accessToken = this.jwtService.sign({
      sub: admin.id,
      username: admin.username,
      role: 'admin',
    } satisfies AdminJwtPayload);

    return {
      admin,
      accessToken,
    };
  }
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly usersService: UsersService,
    private readonly merchantsService: MerchantsService,
    private readonly escrowStackService: EscrowStackService,
  ) {}

  listUsers() {
    return this.merchantsService.findAllForAdmin();
  }

  async createUser(dto: CreateManagedUserDto) {
    const user = await this.usersService.create(dto.username, dto.password);

    try {
      const virtualAccountNo =
        await this.merchantsService.allocateVirtualAccount();
      const escrowIfsc = this.merchantsService.getSharedIfsc();
      const demoBalance = dto.demo_balance ?? 0;

      const merchant = await this.merchantsService.create({
        userId: user.id,
        merchantName: dto.merchant_name,
        userRef: dto.username.length >= 5 ? dto.username : dto.merchant_name,
        virtualAccountNo,
        escrowIfsc,
        realBalance: 0,
        demoBalance,
        escrowAccountDetails: {
          assigned_virtual_account: virtualAccountNo,
          shared_ifsc: escrowIfsc,
        },
      });

      return {
        user: {
          id: user.id,
          username: user.username,
        },
        merchant,
        message: `Merchant onboarded. Virtual account ${virtualAccountNo}`,
      };
    } catch (error) {
      await this.usersService.delete(user.id);
      throw error;
    }
  }

  updateUsername(id: string, dto: UpdateManagedUsernameDto) {
    return this.usersService.updateUsername(id, dto.username);
  }

  async updatePassword(id: string, dto: ResetManagedPasswordDto) {
    const user = await this.usersService.updatePassword(id, dto.password);

    return {
      user,
      message: 'Password updated successfully',
    };
  }

  async updateDemoBalance(id: string, demoBalance: number) {
    await this.merchantsService.updateDemoBalanceByUserId(id, demoBalance);

    return {
      demo_balance: demoBalance,
      message: 'Demo balance updated',
    };
  }

  async updateBalanceMode(id: string, balanceMode: 'real' | 'demo') {
    const result = await this.merchantsService.updateBalanceModeByUserId(
      id,
      balanceMode,
    );

    return {
      balance_mode: result.balanceMode,
      available_balance: result.availableBalance,
      message: 'Balance mode updated',
    };
  }

  async updateApprovalMode(id: string, approvalMode: 'auto' | 'manual') {
    const result = await this.merchantsService.updateApprovalModeByUserId(
      id,
      approvalMode,
    );

    return {
      approval_mode: result.approvalMode,
      message: 'Approval mode updated',
    };
  }

  async updateAccountStatus(
    id: string,
    accountStatus: 'active' | 'on_hold' | 'terminated',
  ) {
    const result = await this.merchantsService.updateAccountStatusByUserId(
      id,
      accountStatus,
    );

    return {
      account_status: result.accountStatus,
      message: 'Account status updated',
    };
  }

  async fetchCompanyBankBalance() {
    const credentials = this.merchantsService.getPlatformCredentials();
    const balanceResult = await this.escrowStackService.fetchTransactionBalance(
      credentials.apiKey,
    );

    const remaining =
      balanceResult.availableBalance ?? balanceResult.balance;
    const lien =
      balanceResult.lienAmount ?? balanceResult.holdAmount ?? null;
    const total =
      balanceResult.totalBalance ??
      (lien != null
        ? Number((remaining + lien).toFixed(2))
        : remaining);

    return {
      // Remaining = spendable (clear). Do not use HDFC "avaliable" as this.
      bank_balance: remaining,
      available_balance: remaining,
      remaining_balance: remaining,
      clear_balance: remaining,
      // Total = HDFC avaliable_balance (clear + lien)
      total_balance: total,
      hold_amount: balanceResult.holdAmount ?? lien,
      lien_amount: lien,
      unclear_amount: balanceResult.unclearAmount ?? null,
      ledger_balance: balanceResult.ledgerBalance ?? null,
      account_no: balanceResult.accountNo ?? null,
      customer_id: balanceResult.customerId ?? null,
      message:
        'Company HDFC: total = clear+lien; remaining = spendable; lien = hold',
    };
  }

  listDeposits(userId: string) {
    return this.merchantsService.listDepositsForUser(userId);
  }

  listLedger(userId: string) {
    return this.merchantsService.listLedgerForUser(userId);
  }

  listAllDeposits() {
    return this.merchantsService.listDepositsForAdmin();
  }

  async refreshRealBalance(_id: string) {
    return this.fetchCompanyBankBalance();
  }

  async deleteUser(id: string) {
    const deleted = await this.usersService.delete(id);

    return {
      ...deleted,
      message: 'User deleted successfully',
    };
  }
}
