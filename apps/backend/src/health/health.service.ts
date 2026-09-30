import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase';
import {
  HealthCheckResult,
  HealthResponse,
  HealthStatus,
} from './health.types';

@Injectable()
export class HealthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    const checks: Record<string, HealthCheckResult> = {
      api: { status: 'ok' },
      db: await this.supabaseService.checkConnection(),
    };

    const status = this.aggregateStatus(checks);

    return {
      s: status === 'ok' ? 'S' : status === 'degraded' ? 'D' : 'E',
    };
  }

  private aggregateStatus(
    checks: Record<string, HealthCheckResult>,
  ): HealthStatus {
    const statuses = Object.values(checks).map((check) => check.status);

    if (statuses.includes('error')) {
      return 'error';
    }

    if (statuses.includes('degraded')) {
      return 'degraded';
    }

    return 'ok';
  }
}
