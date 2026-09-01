import { Module } from '@nestjs/common';
import { EscrowStackModule } from '../escrowstack';
import { MerchantsModule } from '../merchants';
import { SupabaseModule } from '../supabase';
import { BankSyncCronService } from './bank-sync.cron';
import { BankSyncService } from './bank-sync.service';

@Module({
  imports: [EscrowStackModule, MerchantsModule, SupabaseModule],
  providers: [BankSyncService, BankSyncCronService],
  exports: [BankSyncService],
})
export class BankSyncModule {}
