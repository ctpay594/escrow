import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AdminJwtPayload } from './admin.types';

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { admin?: AdminJwtPayload }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing admin session token');
    }

    try {
      const payload = this.jwtService.verify<AdminJwtPayload>(token);

      if (payload.role !== 'admin') {
        throw new UnauthorizedException('Invalid admin session');
      }

      request.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired admin session');
    }
  }

  private extractToken(request: Request): string | null {
    const authorization = request.headers.authorization;

    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice(7);
    }

    return null;
  }
}
