'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { glassInset } from '@/lib/glass-styles';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface TransferActionDetails {
  beneficiaryName: string;
  amount: number;
  payoutRef: string;
}

interface TransferActionDialogProps {
  open: boolean;
  mode: 'approve' | 'reject' | null;
  transfer: TransferActionDetails | null;
  rejectReason: string;
  isSubmitting?: boolean;
  onRejectReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TransferActionDialog({
  open,
  mode,
  transfer,
  rejectReason,
  isSubmitting = false,
  onRejectReasonChange,
  onConfirm,
  onCancel,
}: TransferActionDialogProps) {
  if (!mode || !transfer) {
    return null;
  }

  const isReject = mode === 'reject';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isReject ? 'Reject transfer?' : 'Approve transfer?'}
          </DialogTitle>
          <DialogDescription>
            {isReject
              ? 'Funds will be returned to the merchant balance.'
              : 'This will submit the payout to EscrowStack for processing.'}
          </DialogDescription>
        </DialogHeader>

        <dl className={cn(glassInset(), 'space-y-2 p-4 text-sm')}>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Beneficiary</dt>
            <dd className="text-right font-medium">{transfer.beneficiaryName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-semibold tabular-nums">
              {formatCurrency(transfer.amount)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Payment ref</dt>
            <dd className="font-mono text-right text-xs">{transfer.payoutRef}</dd>
          </div>
        </dl>

        {isReject ? (
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(event) => onRejectReasonChange(event.target.value)}
              placeholder="Add a note for your records"
              className={cn(
                glassInset(),
                'min-h-[72px] w-full px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant={isReject ? 'destructive' : 'default'}
            disabled={isSubmitting}
            onClick={onConfirm}
          >
            {isSubmitting
              ? 'Working…'
              : isReject
                ? 'Confirm rejection'
                : 'Confirm approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
