import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  listEndpoints() {
    return {
      ok: true,
      message: 'Webhook is running. Bank should POST JSON here.',
      callback: 'POST /webhooks/escrowstack',
      supabase_table: 'callbacks',
    };
  }

  @Get('escrowstack')
  async getEscrowStackStatus() {
    await this.webhooksService.replayStoredCollects();

    return {
      ok: true,
      status: 'running',
      message:
        'Callback URL is live. Bank POSTs JSON. Collect credits are applied from Virtual Account + Amount.',
      method: 'POST',
      url: '/webhooks/escrowstack',
    };
  }

  @Post('escrowstack')
  @HttpCode(200)
  handleEscrowStack(@Body() payload: unknown, @Req() req: Request) {
    return this.webhooksService.handleEscrowStackWebhook(payload, {
      remoteIp: this.resolveClientIp(req),
    });
  }

  private resolveClientIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }

    if (Array.isArray(forwarded) && forwarded[0]) {
      return forwarded[0].split(',')[0]?.trim() ?? null;
    }

    return req.ip ?? req.socket.remoteAddress ?? null;
  }
}
