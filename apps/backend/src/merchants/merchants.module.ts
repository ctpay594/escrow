import { Module } from '@nestjs/common';
import { LedgerReconcileService } from './ledger-reconcile.service';
import { MerchantsService } from './merchants.service';

@Module({
  providers: [MerchantsService, LedgerReconcileService],
  exports: [MerchantsService, LedgerReconcileService],
})
export class MerchantsModule {}
