import { BulkTransferPanel } from '@/components/transfer/bulk-transfer-panel';
import { TransferWizard } from '@/components/transfer/transfer-wizard';
import { canMerchantTransfer } from '@/components/account-status-banner';
import { PageHeader } from '@/components/shared/page-header';
import { requireUserProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { formatCurrency } from '@/lib/format';
import Link from 'next/link';

export default async function TransferPage() {
  const { merchant } = await requireUserProfile();

  if (!merchant) {
    return (
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle>Transfer</GlassCardTitle>
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

  const transfersEnabled = canMerchantTransfer(merchant.account_status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Transfer"
        description={`Available ${formatCurrency(merchant.available_balance)} · Single payout or bulk upload`}
      />

      {!transfersEnabled ? (
        <GlassCard className="border-amber-200/80 bg-amber-50/55">
          <GlassCardHeader className="pb-2">
            <GlassCardTitle className="text-base">Transfers disabled</GlassCardTitle>
            <GlassCardDescription>
              {merchant.account_status === 'terminated'
                ? 'This account has been terminated. You can still review history from the menu.'
                : 'This account is on hold. You can view your balance and history, but cannot send money.'}
            </GlassCardDescription>
          </GlassCardHeader>
          <GlassCardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/history">View transaction history</Link>
            </Button>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="mx-auto w-full max-w-lg lg:mx-0">
          <TransferWizard
            availableBalance={merchant.available_balance}
            disabled={!transfersEnabled}
          />
        </div>
        <BulkTransferPanel
          availableBalance={merchant.available_balance}
          disabled={!transfersEnabled}
        />
      </div>
    </div>
  );
}
