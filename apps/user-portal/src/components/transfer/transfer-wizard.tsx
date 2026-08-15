'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Copy, Loader2, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import { PAYOUT_MODES, type BankPayoutMode } from '@/lib/payout-mode';
import { validateTransferFields } from '@/lib/transfer-validation';
import { cn } from '@/lib/utils';

const IMPS_FEE = 0;

interface TransferWizardProps {
  availableBalance: number;
  disabled?: boolean;
}

export function TransferWizard({
  availableBalance,
  disabled = false,
}: TransferWizardProps) {
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedRef, setCompletedRef] = useState<string | null>(null);
  const [completedBeneficiary, setCompletedBeneficiary] = useState('');
  const [completedAmount, setCompletedAmount] = useState(0);

  const [amount, setAmount] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [payoutMode, setPayoutMode] = useState<BankPayoutMode>('IMPS');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const parsedAmount = Number.parseFloat(amount) || 0;
  const totalDebit = parsedAmount + IMPS_FEE;
  const remaining = availableBalance - totalDebit;

  const errors = useMemo(
    () =>
      validateTransferFields({
        amount,
        beneficiaryName,
        accountNo,
        ifsc,
        availableBalance,
        payoutMode,
      }),
    [amount, beneficiaryName, accountNo, ifsc, availableBalance, payoutMode],
  );

  const formValid = Object.keys(errors).length === 0;
  const sendEnabled = formValid && !disabled && !isSubmitting;

  function markTouched(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function resetForm() {
    setSubmitted(false);
    setAmount('');
    setBeneficiaryName('');
    setAccountNo('');
    setIfsc('');
    setPayoutMode('IMPS');
    setCompletedRef(null);
    setCompletedBeneficiary('');
    setCompletedAmount(0);
    setTouched({});
  }

  async function submitTransfer() {
    if (disabled || !formValid) return;

    setIsSubmitting(true);
    setConfirmOpen(false);

    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsedAmount,
          payout_mode: payoutMode,
          beneficiary_account_name: beneficiaryName.trim(),
          beneficiary_account_no: accountNo.trim(),
          beneficiary_ifsc: ifsc.trim().toUpperCase(),
        }),
      });

      const data = await response.json();

      if (response.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Transfer could not be completed');
      }

      setCompletedRef(data.payout_ref as string);
      setCompletedBeneficiary(beneficiaryName.trim());
      setCompletedAmount(parsedAmount);
      setSubmitted(true);
      toast.success('Transfer submitted');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Transfer could not be completed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyRef(ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      toast.success('Payment reference copied');
    } catch {
      toast.error('Could not copy');
    }
  }

  return (
    <>
      <GlassCard className={disabled ? 'opacity-60' : undefined}>
        <GlassCardHeader className="p-5 pb-3">
          <GlassCardTitle>
            {submitted ? 'Transfer submitted' : 'Transfer details'}
          </GlassCardTitle>
          <GlassCardDescription>
            {submitted
              ? 'Your transfer is processing.'
              : `Available ${formatCurrency(availableBalance)} · ${payoutMode}`}
          </GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent className="p-5 pt-0">
          <AnimatePresence mode="wait">
            {!submitted ? (
              <motion.div
                key="transfer"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-4"
              >
                <fieldset disabled={disabled} className="m-0 space-y-4 border-0 p-0">
                  <div className={cn(glassInset(), 'grid gap-3 px-4 py-3 text-sm sm:grid-cols-2')}>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available</span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(availableBalance)}
                      </span>
                    </div>
                    {parsedAmount > 0 ? (
                      <div className="flex justify-between sm:border-l sm:border-white/50 sm:pl-3">
                        <span className="text-muted-foreground">After transfer</span>
                        <span
                          className={cn(
                            'font-medium tabular-nums',
                            remaining < 0 && 'text-destructive',
                          )}
                        >
                          {formatCurrency(Math.max(remaining, 0))}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="payoutMode">Payout mode</Label>
                      <Select
                        value={payoutMode}
                        onValueChange={(value) =>
                          setPayoutMode(value as BankPayoutMode)
                        }
                      >
                        <SelectTrigger id="payoutMode" aria-label="Payout mode">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYOUT_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {mode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {payoutMode === 'RTGS' ? (
                        <p className="text-xs text-muted-foreground">
                          RTGS minimum is ₹2,00,000
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (INR)</Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                          ₹
                        </span>
                        <Input
                          id="amount"
                          type="number"
                          inputMode="decimal"
                          min={1}
                          step="0.01"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          onBlur={() => markTouched('amount')}
                          aria-invalid={touched.amount && !!errors.amount}
                          className="pl-8 font-medium tabular-nums"
                        />
                      </div>
                      {touched.amount && errors.amount ? (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.amount}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="beneficiaryName">Beneficiary name</Label>
                      <Input
                        id="beneficiaryName"
                        placeholder="Account holder name"
                        value={beneficiaryName}
                        onChange={(e) => setBeneficiaryName(e.target.value)}
                        onBlur={() => markTouched('beneficiaryName')}
                        aria-invalid={
                          touched.beneficiaryName && !!errors.beneficiaryName
                        }
                      />
                      {touched.beneficiaryName && errors.beneficiaryName ? (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.beneficiaryName}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="accountNo">Account number</Label>
                      <Input
                        id="accountNo"
                        className="font-mono"
                        placeholder="Beneficiary account number"
                        value={accountNo}
                        onChange={(e) => setAccountNo(e.target.value)}
                        onBlur={() => markTouched('accountNo')}
                        aria-invalid={touched.accountNo && !!errors.accountNo}
                      />
                      {touched.accountNo && errors.accountNo ? (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.accountNo}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ifsc">IFSC</Label>
                      <Input
                        id="ifsc"
                        className="font-mono uppercase"
                        placeholder="HDFC0001234"
                        value={ifsc}
                        onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                        onBlur={() => markTouched('ifsc')}
                        aria-invalid={touched.ifsc && !!errors.ifsc}
                      />
                      {touched.ifsc && errors.ifsc ? (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.ifsc}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    className={cn(
                      'w-full sm:w-auto',
                      !sendEnabled && 'cursor-not-allowed opacity-50',
                    )}
                    disabled={!sendEnabled}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send transfer
                      </>
                    )}
                  </Button>
                </fieldset>
              </motion.div>
            ) : (
              completedRef && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center py-4 text-center"
                >
                  <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                  <p className="mt-4 text-lg font-semibold">Transfer submitted</p>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    {completedBeneficiary} · {formatCurrency(completedAmount)} ·{' '}
                    {payoutMode}. This payout is now processing.
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">Payment ref</p>
                  <p className="mt-1 font-mono text-sm">{completedRef}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => void copyRef(completedRef)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy reference
                  </Button>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <Button asChild variant="secondary">
                      <Link href="/history">View history</Link>
                    </Button>
                    <Button onClick={resetForm}>Make another transfer</Button>
                  </div>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </GlassCardContent>
      </GlassCard>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              Review the details below before submitting.
            </DialogDescription>
          </DialogHeader>
          <dl className={cn(glassInset(), 'space-y-2 p-4 text-sm')}>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Beneficiary</dt>
              <dd className="text-right font-medium">{beneficiaryName.trim()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="font-medium">{payoutMode}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-semibold tabular-nums">
                {formatCurrency(parsedAmount)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Fee</dt>
              <dd className="tabular-nums">{formatCurrency(IMPS_FEE)}</dd>
            </div>
            <Separator />
            <div className="flex justify-between gap-4">
              <dt className="font-medium">Total debit</dt>
              <dd className="font-semibold tabular-nums">
                {formatCurrency(totalDebit)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">To account</dt>
              <dd className="font-mono text-right">{accountNo}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">IFSC</dt>
              <dd className="font-mono">{ifsc.toUpperCase()}</dd>
            </div>
          </dl>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={disabled || isSubmitting}
              onClick={() => void submitTransfer()}
            >
              {isSubmitting ? 'Sending…' : 'Confirm & send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
