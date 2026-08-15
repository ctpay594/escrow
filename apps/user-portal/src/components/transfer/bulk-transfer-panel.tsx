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
import { PAYOUT_MODES, type BankPayoutMode } from '@/lib/payout-mode';
import { isIfscValid } from '@/lib/transfer-validation';
import { cn } from '@/lib/utils';
import {
  bulkRowNeedsCorrection,
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

      const warningCount = parsed.rows.filter(bulkRowNeedsCorrection).length;
      if (warningCount > 0) {
        toast.warning(
          `${warningCount} row${warningCount === 1 ? '' : 's'} have a wrong account, IFSC, or payout mode. Correct them before submitting.`,
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

  function updateRowName(index: number, name: string) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? withRowWarnings({
              ...row,
              beneficiary_account_name: name,
            })
          : row,
      ),
    );
  }

  function updateRowAccount(index: number, accountNo: string) {
    const digits = accountNo.replace(/[^\d]/g, '');
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? withRowWarnings({
              ...row,
              beneficiary_account_no: digits,
            })
          : row,
      ),
    );
  }

  function updateRowIfsc(index: number, ifsc: string) {
    const nextIfsc = ifsc.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? withRowWarnings({
              ...row,
              beneficiary_ifsc: nextIfsc,
            })
          : row,
      ),
    );
  }

  function updateRowMode(index: number, payoutMode: BankPayoutMode) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? withRowWarnings({
              ...row,
              payout_mode: payoutMode,
              modeWarning: false,
            })
          : row,
      ),
    );
  }

  function updateRowAmount(index: number, amountText: string) {
    const amount = Number.parseFloat(amountText.replace(/[,₹\s]/g, ''));
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? withRowWarnings({
              ...row,
              amount: Number.isFinite(amount) ? amount : 0,
            })
          : row,
      ),
    );
  }

  function withRowWarnings(row: BulkTransferRow): BulkTransferRow {
    const nameWarning =
      !row.beneficiary_account_name.trim() ||
      row.beneficiary_account_name.trim().length < 2;
    const accountValid = /^\d{9,18}$/.test(row.beneficiary_account_no);
    const ifscValid = isIfscValid(row.beneficiary_ifsc);
    const precisionWarning =
      accountValid && looksLikeRoundedAccount(row.beneficiary_account_no);
    const amountValid = Number.isFinite(row.amount) && row.amount > 0;
    const warnings: string[] = [];

    if (nameWarning) {
      warnings.push('Beneficiary name is missing. Add the name.');
    }

    if (!accountValid) {
      warnings.push(
        row.beneficiary_account_no
          ? `Account number ${row.beneficiary_account_no} is wrong. Use 9–18 digits.`
          : 'Account number is missing. Enter 9–18 digits.',
      );
    } else if (precisionWarning) {
      warnings.push(
        `Account number ${row.beneficiary_account_no} looks truncated. Correct it to the full digits.`,
      );
    }

    if (!ifscValid) {
      warnings.push(
        row.beneficiary_ifsc
          ? `IFSC ${row.beneficiary_ifsc} is wrong. Use a valid code like HDFC0001234.`
          : 'IFSC is missing. Enter a valid code like HDFC0001234.',
      );
    }

    if (row.modeWarning) {
      warnings.push('Payout mode is wrong. Use IMPS, NEFT, or RTGS.');
    }

    if (row.payout_mode === 'RTGS' && amountValid && row.amount < 200_000) {
      warnings.push('RTGS requires a minimum of ₹2,00,000. Correct the amount or mode.');
    }

    if (!amountValid) {
      warnings.push('Amount is missing or invalid. Enter the transfer amount.');
    }

    return {
      ...row,
      nameWarning,
      accountWarning: !accountValid || precisionWarning,
      ifscWarning: !ifscValid,
      warningMessage: warnings.join(' '),
    };
  }

  async function submitBulkTransfer() {
    if (rows.length === 0 || disabled) return;

    if (hasAccountWarnings) {
      toast.error('Correct highlighted account numbers, IFSC, or payout mode before submitting');
      return;
    }

    if (totalAmount > availableBalance) {
      toast.error('Total exceeds available balance');
      return;
    }

    for (const row of rows) {
      if (!row.beneficiary_account_name.trim() || row.beneficiary_account_name.trim().length < 2) {
        toast.error(`Row ${row.rowNumber}: add a beneficiary name.`);
        return;
      }

      if (!/^\d{9,18}$/.test(row.beneficiary_account_no)) {
        toast.error(`Row ${row.rowNumber}: this account number is wrong. Correct it.`);
        return;
      }

      if (!isIfscValid(row.beneficiary_ifsc)) {
        toast.error(`Row ${row.rowNumber}: this IFSC is wrong. Correct it.`);
        return;
      }

      if (!(row.amount > 0)) {
        toast.error(`Row ${row.rowNumber}: enter a valid amount.`);
        return;
      }

      if (row.payout_mode === 'RTGS' && row.amount < 200_000) {
        toast.error(`Row ${row.rowNumber}: RTGS requires a minimum of ₹2,00,000.`);
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
            payout_mode: row.payout_mode,
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
            Upload Excel or CSV. Columns can be in any order — we detect name,
            account, IFSC, mode, and amount even if a header is missing.
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
                  Some account numbers, IFSC codes, or payout modes need review
                  before submit.
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
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-0.75rem)] max-w-4xl flex-col overflow-hidden p-0 sm:max-h-[85vh]">
          <DialogHeader className="border-b border-white/50 px-4 py-4 pr-12 sm:px-6">
            <DialogTitle>Review bulk transfer</DialogTitle>
            <DialogDescription className="text-pretty">
              {rows.length} transactions · Total {formatCurrency(totalAmount)}
              {remaining >= 0 ? (
                <> · Balance after {formatCurrency(remaining)}</>
              ) : (
                <> · Exceeds balance by {formatCurrency(Math.abs(remaining))}</>
              )}
            </DialogDescription>
          </DialogHeader>

          {hasAccountWarnings ? (
            <div className="mx-4 mt-4 flex gap-2 rounded-xl border border-amber-200/80 bg-amber-50/75 px-3 py-2 text-xs text-amber-900 backdrop-blur-sm sm:mx-6">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Highlighted fields need a name, account, IFSC, mode, or amount.
                Correct them here before submitting.
              </p>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
            <div className="space-y-3 md:hidden">
              {rows.map((row, index) => {
                const needsCorrection = bulkRowNeedsCorrection(row);

                return (
                  <div
                    key={`${row.rowNumber}-${index}`}
                    className={cn(
                      glassInset(),
                      'space-y-3 p-3',
                      needsCorrection && 'border-amber-300/80 bg-amber-50/80',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">#{index + 1}</p>
                      <p className="text-sm font-medium tabular-nums">
                        {formatCurrency(row.amount)}
                      </p>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-muted-foreground">Beneficiary</span>
                      <Input
                        value={row.beneficiary_account_name}
                        onChange={(event) =>
                          updateRowName(index, event.target.value)
                        }
                        className={cn(
                          'h-9',
                          row.nameWarning &&
                            'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                        )}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-muted-foreground">Account</span>
                      <Input
                        value={row.beneficiary_account_no}
                        onChange={(event) =>
                          updateRowAccount(index, event.target.value)
                        }
                        className={cn(
                          'h-9 font-mono text-xs tracking-wide',
                          row.accountWarning &&
                            'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                        )}
                        inputMode="numeric"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-muted-foreground">IFSC</span>
                        <Input
                          value={row.beneficiary_ifsc}
                          onChange={(event) =>
                            updateRowIfsc(index, event.target.value)
                          }
                          className={cn(
                            'h-9 font-mono text-xs uppercase tracking-wide',
                            row.ifscWarning &&
                              'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                          )}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-muted-foreground">Mode</span>
                        <select
                          value={row.payout_mode}
                          onChange={(event) =>
                            updateRowMode(
                              index,
                              event.target.value as BankPayoutMode,
                            )
                          }
                          className={cn(
                            'h-9 w-full rounded-md border bg-background px-2 text-xs',
                            row.modeWarning
                              ? 'border-amber-400 bg-amber-50'
                              : 'border-input',
                          )}
                        >
                          {PAYOUT_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-muted-foreground">Amount</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.amount || ''}
                        onChange={(event) =>
                          updateRowAmount(index, event.target.value)
                        }
                        className={cn(
                          'h-9 tabular-nums',
                          row.amount <= 0 &&
                            'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                        )}
                      />
                    </label>
                    {row.warningMessage ? (
                      <p className="text-[11px] text-amber-800">{row.warningMessage}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className={cn(glassInset(), 'sticky top-0 text-muted-foreground')}>
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Beneficiary</th>
                  <th className="pb-2 pr-3 font-medium">Account</th>
                  <th className="pb-2 pr-3 font-medium">IFSC</th>
                  <th className="pb-2 pr-3 font-medium">Mode</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => {
                  const needsCorrection = bulkRowNeedsCorrection(row);

                  return (
                  <tr
                    key={`${row.rowNumber}-${index}`}
                    className={needsCorrection ? 'bg-amber-50/80' : undefined}
                  >
                    <td className="py-2 pr-3 text-muted-foreground">{index + 1}</td>
                    <td className="py-2 pr-3">
                      <Input
                        value={row.beneficiary_account_name}
                        onChange={(event) =>
                          updateRowName(index, event.target.value)
                        }
                        className={cn(
                          'h-8 min-w-[8rem]',
                          row.nameWarning &&
                            'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                        )}
                      />
                    </td>
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
                    <td className="py-2 pr-3">
                      <Input
                        value={row.beneficiary_ifsc}
                        onChange={(event) =>
                          updateRowIfsc(index, event.target.value)
                        }
                        className={`h-8 font-mono text-xs uppercase tracking-wide ${
                          row.ifscWarning
                            ? 'border-amber-400 bg-amber-50 focus-visible:ring-amber-400'
                            : ''
                        }`}
                        aria-invalid={row.ifscWarning}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={row.payout_mode}
                        onChange={(event) =>
                          updateRowMode(
                            index,
                            event.target.value as BankPayoutMode,
                          )
                        }
                        className={`h-8 rounded-md border bg-background px-2 text-xs ${
                          row.modeWarning
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-input'
                        }`}
                        aria-label={`Payout mode for row ${row.rowNumber}`}
                      >
                        {PAYOUT_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.amount || ''}
                        onChange={(event) =>
                          updateRowAmount(index, event.target.value)
                        }
                        className={cn(
                          'ml-auto h-8 w-28 text-right tabular-nums',
                          row.amount <= 0 &&
                            'border-amber-400 bg-amber-50 focus-visible:ring-amber-400',
                        )}
                      />
                      {row.warningMessage ? (
                        <p className="mt-1 text-left text-[11px] font-normal text-amber-800">
                          {row.warningMessage}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <DialogFooter className="border-t border-white/50 px-4 py-4 sm:px-6">
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
