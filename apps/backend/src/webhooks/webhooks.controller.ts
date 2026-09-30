import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /** Quiet 404 — do not advertise webhook paths or trigger side effects. */
  @Get()
  listEndpoints() {
    throw new NotFoundException();
  }

  @Get('escrowstack')
  getEscrowStackStatus() {
    throw new NotFoundException();
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
