import Link from 'next/link';
import { HistoryPanel } from '@/components/history/history-panel';
import { requireUserProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';

export default async function HistoryPage() {
  const { user, merchant } = await requireUserProfile();

  if (!merchant) {
    return (
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle>History</GlassCardTitle>
          <GlassCardDescription>Your account is not active yet.</GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent>
          <Button asChild variant="outline">
            <Link href="/">Back to account</Link>
          </Button>
        </GlassCardContent>
      </GlassCard>
    );
  }

  const accountLabel = `${merchant.merchant_name} (${user.username})`;

  return <HistoryPanel accountLabel={accountLabel} />;
}
