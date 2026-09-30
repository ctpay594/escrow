import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase';
import { LoginAuditService } from './login-audit.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

@Module({
  imports: [SupabaseModule],
  providers: [LoginAuditService, LoginRateLimitGuard],
  exports: [LoginAuditService, LoginRateLimitGuard],
})
export class CommonModule {}
