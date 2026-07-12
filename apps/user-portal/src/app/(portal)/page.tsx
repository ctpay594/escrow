import { AccountDashboard } from '@/components/account/account-dashboard';
import { requireUserProfile } from '@/lib/auth';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';

export default async function HomePage() {
  const { user, merchant } = await requireUserProfile();

  if (!merchant) {
    return (
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle>Account</GlassCardTitle>
          <GlassCardDescription>Your account is not active yet.</GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent className="text-sm text-muted-foreground">
          Please contact support to activate your CTPay account.
        </GlassCardContent>
      </GlassCard>
    );
  }

  return <AccountDashboard user={user} merchant={merchant} />;
}
