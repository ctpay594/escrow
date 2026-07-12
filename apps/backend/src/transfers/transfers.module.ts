import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EscrowStackModule } from '../escrowstack';
import { MerchantsModule } from '../merchants';
import { UsersModule } from '../users';
import { TransferReconcileService } from './transfer-reconcile.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [MerchantsModule, AuthModule, EscrowStackModule, UsersModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransferReconcileService],
  exports: [TransfersService, TransferReconcileService],
})
export class TransfersModule {}
