import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginAuditService } from '../common/login-audit.service';
import { MerchantsService } from '../merchants';
import { UsersService } from '../users';
import type { AuthResponse, JwtPayload } from './auth.types';
import type { LoginDto } from './dto/login.dto';

export interface LoginRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly merchantsService: MerchantsService,
    private readonly jwtService: JwtService,
    private readonly loginAuditService: LoginAuditService,
  ) {}

  async login(
    dto: LoginDto,
    meta: LoginRequestMeta = {},
  ): Promise<AuthResponse> {
    const username = dto.username.trim();
    const user = await this.usersService.findByUsername(username);

    if (!user || user.password !== dto.password) {
      await this.loginAuditService.record({
        realm: 'user',
        username,
        success: false,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    await this.loginAuditService.record({
      realm: 'user',
      username: user.username,
      userId: user.id,
      success: true,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.buildAuthResponse({
      id: user.id,
      username: user.username,
    });
  }

  async getProfile(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const merchant = await this.merchantsService.findPublicProfileByUserId(
      user.id,
    );

    return { user, merchant };
  }

  private buildAuthResponse(user: {
    id: string;
    username: string;
  }): AuthResponse {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      username: user.username,
    } satisfies JwtPayload);

    return {
      user,
      accessToken,
    };
  }
}
