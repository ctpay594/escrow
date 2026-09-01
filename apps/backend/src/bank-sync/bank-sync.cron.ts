import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BankSyncService } from './bank-sync.service';

@Injectable()
export class BankSyncCronService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly bankSyncService: BankSyncService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.bankSyncService.maybeRunDailyCron();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
