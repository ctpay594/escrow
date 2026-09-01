import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin';
import { AuthModule } from './auth';
import { BankSyncModule } from './bank-sync';
import { TransfersModule } from './transfers';
import { WebhooksModule } from './webhooks';
import { HealthModule } from './health';
import { SupabaseModule } from './supabase';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SupabaseModule,
    HealthModule,
    AuthModule,
    TransfersModule,
    BankSyncModule,
    AdminModule,
    WebhooksModule,
  ],
})
export class AppModule {}
