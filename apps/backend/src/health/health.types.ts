export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

/** Compact public probe — avoid naming internal services. */
export interface HealthResponse {
  /** S = ok, D = degraded, E = error */
  s: 'S' | 'D' | 'E';
}
