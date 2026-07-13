import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { jwtExpiresInSeconds } from '../config/jwt-expires';
import { LoginRateLimitGuard } from '../common/login-rate-limit.guard';
import { AdminsModule } from '../admins';
import { EscrowStackModule } from '../escrowstack';
import { MerchantsModule } from '../merchants';
import { TransfersModule } from '../transfers';
import { UsersModule } from '../users';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import {
  AdminAuthController,
  AdminTransfersController,
  AdminUsersController,
} from './admin.controller';
import { AdminAuthService, AdminUsersService } from './admin.service';

@Module({
  imports: [
    AdminsModule,
    UsersModule,
    MerchantsModule,
    EscrowStackModule,
    TransfersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
        signOptions: {
          expiresIn: jwtExpiresInSeconds(
            configService,
            'ADMIN_JWT_EXPIRES_IN_SECONDS',
          ),
        },
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminTransfersController,
  ],
  providers: [
    AdminAuthService,
    AdminUsersService,
    AdminJwtAuthGuard,
    LoginRateLimitGuard,
  ],
})
export class AdminModule {}
