'use client';

import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import { transferDestination, transferUtr } from '@/lib/transfer-display';
import type { TransferItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TransferDetailDialogProps {
  transfer: TransferItem | null;
  onClose: () => void;
  onDownloadReceipt?: (transfer: TransferItem) => void;
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value);
}

function DetailRow({
  label,
  value,
  mono = false,
  children,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/50 py-2.5 last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-right',
          mono ? 'break-all font-mono text-xs' : 'font-medium',
        )}
      >
        {children ?? displayValue(value)}
      </dd>
    </div>
  );
}

export function TransferDetailDialog({
  transfer,
  onClose,
  onDownloadReceipt,
}: TransferDetailDialogProps) {
  if (!transfer) {
    return null;
  }

  const utr = transferUtr(transfer);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  }

  function MonoCopyValue({ label, value }: { label: string; value: string }) {
    return (
      <span className="inline-flex max-w-[14rem] items-start justify-end gap-1 sm:max-w-[16rem]">
        <span className="break-all">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => void copyValue(label, value)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </span>
    );
  }

  return (
    <Dialog open={!!transfer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer details</DialogTitle>
        </DialogHeader>
        <dl className={cn(glassInset(), 'rounded-xl px-4 py-1 text-sm')}>
          <DetailRow label="Beneficiary" value={transfer.beneficiary_account_name} />
          <DetailRow label="Amount">
            <span className="font-semibold tabular-nums">
              {formatCurrency(transfer.amount)}
            </span>
          </DetailRow>
          <DetailRow label="Status">
            <TransferStatusBadge status={transfer.status} />
          </DetailRow>
          <DetailRow label="Mode" value={transfer.payout_mode ?? 'IMPS'} />
          <DetailRow label="Payment ref" mono>
            <MonoCopyValue label="Payment ref" value={transfer.payout_ref} />
          </DetailRow>
          <DetailRow label="UTR" mono>
            {utr ? (
              <MonoCopyValue label="UTR" value={utr} />
            ) : (
              '—'
            )}
          </DetailRow>
          <DetailRow label="To account" mono>
            {transferDestination(transfer)}
          </DetailRow>
          {transfer.transaction_note ? (
            <DetailRow label="Note" value={transfer.transaction_note} />
          ) : null}
          <DetailRow label="Submitted">
            {formatDate(transfer.created_at)}
          </DetailRow>
        </dl>
        {onDownloadReceipt ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onDownloadReceipt(transfer)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download receipt
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
