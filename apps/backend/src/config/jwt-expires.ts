import type { ConfigService } from '@nestjs/config';

export function jwtExpiresInSeconds(
  configService: ConfigService,
  key: string,
  fallback = 604800,
): number {
  const raw = configService.get<string | number>(key);

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
