import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase';

export type LoginRealm = 'user' | 'admin';

@Injectable()
export class LoginAuditService {
  private readonly logger = new Logger(LoginAuditService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async record(input: {
    realm: LoginRealm;
    username: string;
    userId?: string | null;
    success: boolean;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('login_events')
        .insert({
          realm: input.realm,
          username: input.username.trim().slice(0, 120),
          user_id: input.userId ?? null,
          success: input.success,
          ip: input.ip?.slice(0, 80) ?? null,
          user_agent: input.userAgent?.slice(0, 300) ?? null,
        });

      if (error) {
        this.logger.warn(`login_events insert failed: ${error.message}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'login audit failed';
      this.logger.warn(message);
    }
  }
}
