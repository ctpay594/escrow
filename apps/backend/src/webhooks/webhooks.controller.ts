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
      message: 'CTPay webhook service is running.',
      endpoints: {
        escrowstack: {
          status: 'running',
          check: 'GET /webhooks/escrowstack',
          callback: 'POST /webhooks/escrowstack',
        },
      },
    };
  }

  @Get('escrowstack')
  getEscrowStackStatus() {
    return {
      ok: true,
      status: 'running',
      service: 'escrowstack',
      message:
        'EscrowStack callback endpoint is live. Send bank webhooks via POST with JSON body.',
      method: 'POST',
      url: '/webhooks/escrowstack',
      checked_at: new Date().toISOString(),
    };
  }

  @Post('escrowstack')
  @HttpCode(200)
  handleEscrowStack(
    @Body() payload: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.webhooksService.handleEscrowStackWebhook(payload, {
      remoteIp: this.resolveClientIp(req),
      userAgent: req.get('user-agent') ?? null,
      requestHeaders: this.sanitizeHeaders(req.headers),
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

  private sanitizeHeaders(
    headers: Request['headers'],
  ): Record<string, string | string[]> {
    const safe: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }

      const normalized = key.toLowerCase();

      if (
        normalized === 'authorization' ||
        normalized === 'cookie' ||
        normalized === 'set-cookie'
      ) {
        continue;
      }

      safe[normalized] = value;
    }

    return safe;
  }
}
