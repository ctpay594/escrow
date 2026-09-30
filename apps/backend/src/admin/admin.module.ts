import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { jwtExpiresInSeconds } from '../config/jwt-expires';
import { CommonModule } from '../common/common.module';
import { AdminsModule } from '../admins';
import { BankSyncModule } from '../bank-sync';
import { EscrowStackModule } from '../escrowstack';
import { MerchantsModule } from '../merchants';
import { SupabaseModule } from '../supabase';
import { TransfersModule } from '../transfers';
import { UsersModule } from '../users';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import {
  AdminAuthController,
  AdminAnalyticsController,
  AdminBankSyncController,
  AdminBankController,
  AdminTransfersController,
  AdminUsersController,
} from './admin.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthService, AdminUsersService } from './admin.service';

@Module({
  imports: [
    AdminsModule,
    UsersModule,
    MerchantsModule,
    EscrowStackModule,
    BankSyncModule,
    SupabaseModule,
    TransfersModule,
    CommonModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
        signOptions: {
          // Default 12h — set ADMIN_JWT_EXPIRES_IN_SECONDS on VPS to override
          expiresIn: jwtExpiresInSeconds(
            configService,
            'ADMIN_JWT_EXPIRES_IN_SECONDS',
            43_200,
          ),
        },
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminBankController,
    AdminUsersController,
    AdminTransfersController,
    AdminAnalyticsController,
    AdminBankSyncController,
  ],
  providers: [
    AdminAuthService,
    AdminUsersService,
    AdminAnalyticsService,
    AdminJwtAuthGuard,
  ],
})
export class AdminModule {}
