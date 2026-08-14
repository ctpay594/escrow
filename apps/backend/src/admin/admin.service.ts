import {
  BadRequestException,
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
  FetchEscrowDetailsDto,
  ResetManagedPasswordDto,
  UpdateManagedUsernameDto,
} from './dto/managed-user.dto';
import type { EscrowMerchantPreview } from './admin.types';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly adminsService: AdminsService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminAuthResponse> {
    const admin = await this.adminsService.findByUsername(dto.username);

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

  async fetchEscrowDetails(
    dto: FetchEscrowDetailsDto,
  ): Promise<EscrowMerchantPreview> {
    this.validatePrivateKeyFormat(dto.escrow_private_key);

    const snapshot = await this.fetchEscrowSnapshot(dto.escrow_api_key);

    return {
      virtual_account_no: snapshot.virtualAccountNo,
      escrow_ifsc: snapshot.escrowIfsc,
      real_balance: snapshot.availableBalance,
    };
  }

  async createUser(dto: CreateManagedUserDto) {
    this.validatePrivateKeyFormat(dto.escrow_private_key);

    const user = await this.usersService.create(dto.username, dto.password);

    try {
      const snapshot = await this.fetchEscrowSnapshot(dto.escrow_api_key);
      const demoBalance = dto.demo_balance ?? snapshot.availableBalance;

      const apiKeyLabel = this.escrowStackService.decodeMerchantNameFromApiKey(
        dto.escrow_api_key,
      );

      const merchant = await this.merchantsService.create({
        userId: user.id,
        merchantName: dto.merchant_name,
        apiKey: dto.escrow_api_key,
        privateKey: dto.escrow_private_key,
        userRef:
          snapshot.userRef ??
          (dto.username.length >= 5 ? dto.username : apiKeyLabel) ??
          dto.username,
        virtualAccountNo: snapshot.virtualAccountNo ?? undefined,
        escrowIfsc: snapshot.escrowIfsc ?? undefined,
        realBalance: snapshot.availableBalance,
        demoBalance,
        escrowAccountDetails: snapshot.escrowAccountDetails,
      });

      return {
        user: {
          id: user.id,
          username: user.username,
        },
        merchant,
        message: 'Merchant onboarded and synced from EscrowStack',
      };
    } catch (error) {
      await this.usersService.delete(user.id);
      throw error;
    }
  }

  private async fetchEscrowSnapshot(apiKey: string) {
    // Balance is required (new PT path). Load-account is optional — not in
    // the Chakatalwar passthrough collection; VA/IFSC may be filled later.
    const balanceResult =
      await this.escrowStackService.fetchTransactionBalance(apiKey);

    let accountDetails: Awaited<
      ReturnType<EscrowStackService['fetchLoadAccountDetails']>
    > = { raw: {} };

    try {
      accountDetails =
        await this.escrowStackService.fetchLoadAccountDetails(apiKey);
    } catch {
      // Endpoint may 404 on passthrough accounts — continue with balance only.
    }

    const apiKeyLabel =
      this.escrowStackService.decodeMerchantNameFromApiKey(apiKey);

    const merchantName =
      accountDetails.merchantName ?? apiKeyLabel ?? 'Escrow Merchant';

    return {
      merchantName,
      userRef: accountDetails.userRef ?? null,
      // PT balance response includes account_no — use it when load-account is missing
      virtualAccountNo:
        accountDetails.virtualAccountNo ?? balanceResult.accountNo ?? null,
      escrowIfsc: accountDetails.escrowIfsc ?? null,
      availableBalance: balanceResult.balance,
      apiKeyLabel,
      loadInstructions: accountDetails.loadInstructions ?? null,
      escrowAccountDetails: {
        balance: balanceResult.raw,
        account: accountDetails.raw,
        customer_id: balanceResult.customerId ?? null,
        account_no: balanceResult.accountNo ?? null,
      },
    };
  }

  private validatePrivateKeyFormat(privateKey: string) {
    const normalized = privateKey.trim();

    if (
      !normalized.includes('BEGIN PRIVATE KEY') &&
      !normalized.includes('BEGIN RSA PRIVATE KEY')
    ) {
      throw new BadRequestException(
        'Private key must be a valid PEM format (BEGIN PRIVATE KEY)',
      );
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

  async refreshRealBalance(id: string) {
    const credentials = await this.merchantsService.getDecryptedCredentials(id);
    const balanceResult = await this.escrowStackService.fetchTransactionBalance(
      credentials.apiKey,
    );

    await this.merchantsService.updateRealBalanceByUserId(
      id,
      balanceResult.balance,
      {
        accountNo: balanceResult.accountNo,
        customerId: balanceResult.customerId,
        balanceRaw: balanceResult.raw,
      },
    );

    return {
      real_balance: balanceResult.balance,
      account_no: balanceResult.accountNo ?? null,
      customer_id: balanceResult.customerId ?? null,
      message: 'Real balance refreshed from EscrowStack',
    };
  }

  async deleteUser(id: string) {
    const deleted = await this.usersService.delete(id);

    return {
      ...deleted,
      message: 'User deleted successfully',
    };
  }
}
