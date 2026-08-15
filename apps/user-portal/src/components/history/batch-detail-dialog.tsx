'use client';

import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { exportBatchStatementXlsx } from '@/lib/export-batch';
import { formatCurrency, formatDate } from '@/lib/format';
import { glassInset, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  type HistoryEntry,
} from '@/lib/history-display';
import { transferUtr } from '@/lib/transfer-display';
import { cn } from '@/lib/utils';

interface BatchDetailDialogProps {
  entry: Extract<HistoryEntry, { kind: 'batch' }> | null;
  onClose: () => void;
}

export function BatchDetailDialog({ entry, onClose }: BatchDetailDialogProps) {
  if (!entry) {
    return null;
  }

  const title = batchDisplayTitle(entry);
  const status = aggregateBatchStatus(entry.transfers);

  function downloadBatchSheet() {
    exportBatchStatementXlsx(entry.transfers, {
      label: entry.label,
      batchId: entry.batchId,
    });
    toast.success('Batch statement downloaded');
  }

  return (
    <Dialog open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-white/50 px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {entry.transfers.length} payout{entry.transfers.length === 1 ? '' : 's'} ·{' '}
            {formatCurrency(entry.totalAmount)} · {formatDate(entry.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 border-b border-white/50 px-6 py-3">
          <TransferStatusBadge status={status} />
          <Button variant="outline" size="sm" onClick={downloadBatchSheet}>
            <Download className="mr-2 h-4 w-4" />
            Download batch Excel
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-auto px-6 py-4">
          <table className="min-w-full text-left text-sm">
            <thead className={glassTableHead()}>
              <tr>
                <th className="px-3 py-2">Beneficiary</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">IFSC</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">UTR</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/50">
              {entry.transfers.map((transfer) => (
                <tr key={transfer.id} className={glassTableRow('default')}>
                  <td className="px-3 py-2 font-medium">
                    {transfer.beneficiary_account_name}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {transfer.beneficiary_account_no ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {transfer.beneficiary_ifsc ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs font-medium">
                    {transfer.payout_mode ?? 'IMPS'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(transfer.amount)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {transferUtr(transfer) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TransferStatusBadge status={transfer.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className={cn(glassInset(), 'mx-6 mb-6 mt-2 px-4 py-3')}>
          <p className="text-xs text-muted-foreground">
            Excel uses the same upload columns, including payout mode, plus payment ref, UTR, and status.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
