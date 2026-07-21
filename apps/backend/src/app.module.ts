import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin';
import { AuthModule } from './auth';
import { TransfersModule } from './transfers';
import { WebhooksModule } from './webhooks';
import { CryptoModule } from './crypto';
import { HealthModule } from './health';
import { SupabaseModule } from './supabase';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SupabaseModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    TransfersModule,
    AdminModule,
    WebhooksModule,
  ],
})
export class AppModule {}
