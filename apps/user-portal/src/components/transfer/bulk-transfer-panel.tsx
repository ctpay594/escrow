'use client';

import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';
import {
  bulkRowsHaveAccountWarnings,
  bulkRowsTotal,
  downloadBulkTransferSample,
  looksLikeRoundedAccount,
  parseBulkTransferFile,
  type BulkTransferRow,
} from '@/lib/bulk-transfer';

interface BulkTransferPanelProps {
  availableBalance: number;
  disabled?: boolean;
}

export function BulkTransferPanel({
  availableBalance,
  disabled = false,
}: BulkTransferPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkTransferRow[]>([]);
  const [parseErrors, setParseErrors] = useState<
    { rowNumber: number; message: string }[]
  >([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const totalAmount = bulkRowsTotal(rows);
  const remaining = availableBalance - totalAmount;
  const hasAccountWarnings = bulkRowsHaveAccountWarnings(rows);

  async function handleFileChange(file: File | null) {
    if (!file || disabled) return;

    setIsParsing(true);
    setFileName(file.name);
    setParseErrors([]);

    try {
      const parsed = await parseBulkTransferFile(file);
      setParseErrors(parsed.errors);
      setRows(parsed.rows);

      if (parsed.errors.length > 0 && parsed.rows.length === 0) {
        toast.error(`${parsed.errors.length} row(s) have errors`);
        return;
      }

      if (parsed.rows.length === 0) {
        return;
      }

      if (parsed.errors.length > 0) {
        toast.message(`${parsed.rows.length} valid · ${parsed.errors.length} skipped`);
      }

      if (bulkRowsHaveAccountWarnings(parsed.rows)) {
        toast.warning(
          'Some account numbers may be wrong — check highlighted rows and fix before submitting.',
        );
      }

      setPreviewOpen(true);
    } catch {
      toast.error('Could not read the file');
      setRows([]);
    } finally {
      setIsParsing(false);
    }
  }

  function updateRowAccount(index: number, accountNo: string) {
    const digits = accountNo.replace(/[^\d]/g, '');
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              beneficiary_account_no: digits,
              accountWarning: looksLikeRoundedAccount(digits),
            }
          : row,
      ),
    );
  }

  async function submitBulkTransfer() {
    if (rows.length === 0 || disabled) return;

    if (hasAccountWarnings) {
      toast.error('Fix highlighted account numbers before submitting');
      return;
    }

    if (totalAmount > availableBalance) {
      toast.error('Total exceeds available balance');
      return;
    }

    for (const row of rows) {
      if (!/^\d{9,18}$/.test(row.beneficiary_account_no)) {
        toast.error(`Row ${row.rowNumber}: invalid account number`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/transfers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: fileName ?? undefined,
          transfers: rows.map((row) => ({
            amount: row.amount,
            payout_mode: 'IMPS',
            beneficiary_account_name: row.beneficiary_account_name,
            beneficiary_account_no: row.beneficiary_account_no,
            beneficiary_ifsc: row.beneficiary_ifsc,
          })),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Bulk transfer failed');
      }

      toast.success(
        `${data.transfer_count} transfers submitted`,
      );
      setPreviewOpen(false);
      setRows([]);
      setFileName(null);
      setParseErrors([]);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : 'Bulk transfer failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <GlassCard>
        <GlassCardHeader className="pb-3">
          <GlassCardTitle className="text-base">Bulk transfer</GlassCardTitle>
          <GlassCardDescription>
            Upload Excel or CSV (name, account, IFSC, amount). Transfers are
            processed after you submit.
          </GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            disabled={disabled}
            onClick={downloadBulkTransferSample}
          >
            <Download className="mr-2 h-4 w-4" />
            Download sample sheet
          </Button>

          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onDragOver={(event) => {
              event.preventDefault();
              if (!disabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (disabled) return;
              const file = event.dataTransfer.files?.[0] ?? null;
              void handleFileChange(file);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={cn(
              glassInset(),
              'flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-4 py-8 text-center transition-all duration-200',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-slate-300/80 hover:border-primary/40 hover:bg-white/55',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <FileSpreadsheet className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {fileName ?? 'Upload .xlsx, .xls, or .csv'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drag &amp; drop or choose · up to 500 transfers
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={disabled}
              onChange={(event) =>
                void handleFileChange(event.target.files?.[0] ?? null)
              }
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4"
              disabled={isParsing || disabled}
              onClick={(event) => {
                event.preventDefault();
                inputRef.current?.click();
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              {isParsing ? 'Reading…' : 'Choose file'}
            </Button>
          </div>

          {rows.length > 0 ? (
            <div className={cn(glassInset(), 'px-3 py-2 text-sm')}>
              <p className="font-medium">{rows.length} transfers ready</p>
              <p className="text-muted-foreground tabular-nums">
                Total {formatCurrency(totalAmount)}
              </p>
              {hasAccountWarnings ? (
                <p className="mt-1 text-xs text-amber-700">
                  Some account numbers need review before submit.
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="mt-2"
                disabled={disabled}
                onClick={() => setPreviewOpen(true)}
              >
                Review &amp; submit
              </Button>
            </div>
          ) : null}

          {parseErrors.length > 0 ? (
            <div className="max-h-28 overflow-auto rounded-xl border border-red-200/80 bg-red-50/70 px-3 py-2 text-xs text-red-800 backdrop-blur-sm">
              {parseErrors.slice(0, 6).map((item) => (
                <p key={`${item.rowNumber}-${item.message}`}>
                  {item.rowNumber > 0 ? `Row ${item.rowNumber}: ` : ''}
                  {item.message}
                </p>
              ))}
              {parseErrors.length > 6 ? (
                <p>+ {parseErrors.length - 6} more errors</p>
              ) : null}
            </div>
          ) : null}
        </GlassCardContent>
      </GlassCard>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-white/50 px-6 py-4">
            <DialogTitle>Review bulk transfer</DialogTitle>
            <DialogDescription>
              {rows.length} transactions · Total {formatCurrency(totalAmount)}
              {remaining >= 0 ? (
                <> · Balance after {formatCurrency(remaining)}</>
              ) : (
                <> · Exceeds balance by {formatCurrency(Math.abs(remaining))}</>
              )}
            </DialogDescription>
          </DialogHeader>

          {hasAccountWarnings ? (
            <div className="mx-6 mt-4 flex gap-2 rounded-xl border border-amber-200/80 bg-amber-50/75 px-3 py-2 text-xs text-amber-900 backdrop-blur-sm">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Highlighted account numbers look truncated. Edit each account to
                the full digits before submitting.
              </p>
            </div>
          ) : null}

          <div className="max-h-[50vh] overflow-auto px-6 py-4">
            <table className="min-w-full text-left text-sm">
              <thead className={cn(glassInset(), 'sticky top-0 text-muted-foreground')}>
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Beneficiary</th>
                  <th className="pb-2 pr-3 font-medium">Account</th>
                  <th className="pb-2 pr-3 font-medium">IFSC</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => (
                  <tr
                    key={`${row.rowNumber}-${index}`}
                    className={row.accountWarning ? 'bg-amber-50/80' : undefined}
                  >
                    <td className="py-2 pr-3 text-muted-foreground">{index + 1}</td>
                    <td className="py-2 pr-3">{row.beneficiary_account_name}</td>
                    <td className="py-2 pr-3">
                      <Input
                        value={row.beneficiary_account_no}
                        onChange={(event) =>
                          updateRowAccount(index, event.target.value)
                        }
                        className={`h-8 font-mono text-xs tracking-wide ${
                          row.accountWarning
                            ? 'border-amber-400 bg-amber-50 focus-visible:ring-amber-400'
                            : ''
                        }`}
                        inputMode="numeric"
                        aria-invalid={row.accountWarning}
                      />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.beneficiary_ifsc}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="border-t border-white/50 px-6 py-4">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                isSubmitting ||
                rows.length === 0 ||
                totalAmount > availableBalance ||
                hasAccountWarnings ||
                disabled
              }
              onClick={() => void submitBulkTransfer()}
            >
              {isSubmitting
                ? 'Submitting…'
                : `Submit ${rows.length} transfers`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
