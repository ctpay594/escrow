import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { HealthCheckResult } from '../health/health.types';

@Injectable()
export class SupabaseService {
  private readonly adminClient: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const url = this.normalizeUrl(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
    );
    const serviceRoleKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    this.adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/$/, '');
  }

  /** Server-side client with service role — bypasses RLS. Never expose to frontends. */
  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }

  /** RLS-aware client scoped to a user's JWT (e.g. from Authorization header). */
  async checkConnection(): Promise<HealthCheckResult> {
    const url = this.normalizeUrl(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
    );
    const serviceRoleKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    const startedAt = Date.now();

    try {
      const response = await fetch(`${url}/auth/v1/health`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        return {
          status: 'error',
          latencyMs,
          message: `Supabase health check failed (${response.status})`,
        };
      }

      return {
        status: 'ok',
        latencyMs,
        message: 'Connected to Supabase',
      };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message:
          error instanceof Error
            ? error.message
            : 'Supabase health check failed',
      };
    }
  }

  getUserClient(accessToken: string): SupabaseClient {
    const url = this.normalizeUrl(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
    );
    const anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    return createClient(url, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
}
