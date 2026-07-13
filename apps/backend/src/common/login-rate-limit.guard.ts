import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      path: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const forwarded = request.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : request.ip) ?? 'unknown';

    const key = `${ip}:${request.path}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const timestamps = (this.attempts.get(key) ?? []).filter(
      (time) => time > windowStart,
    );

    if (timestamps.length >= MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many login attempts. Try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.attempts.set(key, timestamps);
    return true;
  }
}
