import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase';
import {
  HealthCheckResult,
  HealthResponse,
  HealthStatus,
} from './health.types';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(private readonly supabaseService: SupabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    const checks: Record<string, HealthCheckResult> = {
      api: this.checkApi(),
      supabase: await this.supabaseService.checkConnection(),
    };

    return {
      status: this.aggregateStatus(checks),
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      checks,
    };
  }

  private checkApi(): HealthCheckResult {
    return { status: 'ok', message: 'Backend API is running' };
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
