import { Module } from '@nestjs/common';
import { EscrowStackService } from './escrowstack.service';

@Module({
  providers: [EscrowStackService],
  exports: [EscrowStackService],
})
export class EscrowStackModule {}
