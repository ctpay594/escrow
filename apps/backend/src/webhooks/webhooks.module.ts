import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants';
import { TransfersModule } from '../transfers';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TransfersModule, MerchantsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
