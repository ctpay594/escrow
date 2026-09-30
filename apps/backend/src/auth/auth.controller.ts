import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LoginRateLimitGuard } from '../common/login-rate-limit.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtPayload } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, {
      ip: this.clientIp(req),
      userAgent: this.userAgent(req),
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user);
  }

  @Post('logout')
  logout() {
    return { message: 'Logged out' };
  }

  private clientIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }

    if (Array.isArray(forwarded) && forwarded[0]) {
      return forwarded[0].split(',')[0]?.trim() ?? null;
    }

    return req.ip ?? req.socket.remoteAddress ?? null;
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}
