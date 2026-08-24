'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Pencil, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ApprovalMode } from '@/components/merchants/approval-mode-toggle';
import { ApprovalModeToggle } from '@/components/merchants/approval-mode-toggle';
import type { BalanceMode } from '@/components/merchants/balance-mode-toggle';
import { BalanceModeToggle } from '@/components/merchants/balance-mode-toggle';
import {
  EmptyStateIllustrated,
  ErrorCard,
  PageHeader,
} from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { glassInset, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { updateMerchantBalanceMode } from '@/lib/merchant-balance';
import { updateMerchantApprovalMode } from '@/lib/merchant-approval';
import { cn } from '@/lib/utils';

interface ManagedMerchant {
  id: string;
  username: string;
  merchant_name: string;
  virtual_account_no?: string | null;
  escrow_ifsc?: string | null;
  available_balance: number;
  real_balance: number;
  demo_balance: number;
  pending_balance: number;
  balance_mode: BalanceMode;
  approval_mode: ApprovalMode;
  account_status?: 'active' | 'on_hold' | 'terminated';
}

function generateUsernameFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);
  const suffix = String(Math.floor(100 + Math.random() * 900));
  const base = slug.length >= 3 ? slug : `user${suffix}`;

  return `${base}${suffix}`.slice(0, 20);
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let value = '';

  for (let i = 0; i < 10; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }

  return value;
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

function formatSyncedAgo(syncedAt: number | null): string {
  if (syncedAt == null) {
    return '—';
  }

  const seconds = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));

  if (seconds < 15) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  return `${hours}h ago`;
}

export function MerchantsListPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [merchants, setMerchants] = useState<ManagedMerchant[]>([]);
  const [pendingByUser, setPendingByUser] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newMerchantName, setNewMerchantName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createdMerchant, setCreatedMerchant] = useState<{
    merchant_name: string;
    username: string;
    password: string;
    virtual_account_no: string;
    escrow_ifsc: string;
  } | null>(null);
  const [companyBankTotal, setCompanyBankTotal] = useState<number | null>(null);
  const [companyBankLien, setCompanyBankLien] = useState<number | null>(null);
  const [companyBankRemaining, setCompanyBankRemaining] = useState<
    number | null
  >(null);
  const [companyBankError, setCompanyBankError] = useState<string | null>(null);
  const [companyBankLoading, setCompanyBankLoading] = useState(true);
  const [companyBankSyncedAt, setCompanyBankSyncedAt] = useState<number | null>(
    null,
  );
  const [editingDemoId, setEditingDemoId] = useState<string | null>(null);
  const [demoDraft, setDemoDraft] = useState('');
  const [savingDemoId, setSavingDemoId] = useState<string | null>(null);
  const [updatingModeId, setUpdatingModeId] = useState<string | null>(null);
  const [updatingApprovalId, setUpdatingApprovalId] = useState<string | null>(
    null,
  );

  const loadCompanyBankBalance = useCallback(async () => {
    setCompanyBankLoading(true);
    setCompanyBankError(null);

    try {
      const bankResponse = await fetch('/api/bank-balance', {
        cache: 'no-store',
      });
      const bankData = await bankResponse.json().catch(() => ({}));

      if (redirectToLoginIfUnauthorized(bankResponse)) {
        return;
      }

      if (!bankResponse.ok) {
        throw new Error(
          typeof bankData.message === 'string'
            ? bankData.message
            : 'Failed to load company bank balance',
        );
      }

      const remaining = Number(
        bankData.remaining_balance ??
          bankData.clear_balance ??
          bankData.available_balance ??
          bankData.bank_balance,
      );
      const lien = Number(
        bankData.lien_amount ?? bankData.hold_amount,
      );
      const total = Number(
        bankData.total_balance ??
          (Number.isFinite(remaining) && Number.isFinite(lien)
            ? remaining + lien
            : remaining),
      );

      if (!Number.isFinite(remaining)) {
        throw new Error('Company bank balance response was not a number');
      }

      setCompanyBankRemaining(remaining);
      setCompanyBankLien(Number.isFinite(lien) ? lien : null);
      setCompanyBankTotal(Number.isFinite(total) ? total : remaining);
      setCompanyBankSyncedAt(Date.now());
    } catch (bankError) {
      setCompanyBankRemaining(null);
      setCompanyBankTotal(null);
      setCompanyBankLien(null);
      setCompanyBankSyncedAt(null);
      setCompanyBankError(
        bankError instanceof Error
          ? bankError.message
          : 'Failed to load company bank balance',
      );
    } finally {
      setCompanyBankLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    void loadCompanyBankBalance();

    try {
      const [usersResponse, pendingResponse] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/transfers?status=PENDING_APPROVAL', { cache: 'no-store' }),
      ]);

      const usersData = await usersResponse.json();
      const pendingData = await pendingResponse.json();

      if (redirectToLoginIfUnauthorized(usersResponse)) {
        return;
      }

      if (!usersResponse.ok) {
        throw new Error(usersData.message ?? 'Failed to load merchants');
      }

      const list = Array.isArray(usersData) ? usersData : [];

      setMerchants(
        list.map((merchant) => ({
          ...merchant,
          balance_mode: merchant.balance_mode ?? 'demo',
          approval_mode: merchant.approval_mode ?? 'manual',
        })),
      );

      if (Array.isArray(pendingData)) {
        const counts: Record<string, number> = {};
        for (const transfer of pendingData as { user_id: string }[]) {
          counts[transfer.user_id] = (counts[transfer.user_id] ?? 0) + 1;
        }
        setPendingByUser(counts);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load merchants',
      );
    } finally {
      setIsLoading(false);
    }
  }, [loadCompanyBankBalance]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPendingOnly(searchParams.get('needsApproval') === '1');
  }, [searchParams]);

  useEffect(() => {
    const name = newMerchantName.trim();
    if (!onboardingOpen) {
      return;
    }

    if (name.length < 2) {
      setNewUsername('');
      setNewPassword('');
      return;
    }

    const timer = window.setTimeout(() => {
      setNewUsername(generateUsernameFromName(name));
      setNewPassword(generatePassword());
    }, 400);

    return () => window.clearTimeout(timer);
  }, [newMerchantName, onboardingOpen]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return merchants.filter((merchant) => {
      if (pendingOnly && (pendingByUser[merchant.id] ?? 0) === 0) {
        return false;
      }

      if (!query) return true;

      return (
        merchant.merchant_name.toLowerCase().includes(query) ||
        merchant.username.toLowerCase().includes(query)
      );
    });
  }, [merchants, search, pendingOnly, pendingByUser]);

  const totalPendingApprovals = useMemo(
    () => Object.values(pendingByUser).reduce((sum, count) => sum + count, 0),
    [pendingByUser],
  );

  const totalPendingBalance = useMemo(
    () =>
      merchants.reduce(
        (sum, merchant) => sum + Number(merchant.pending_balance ?? 0),
        0,
      ),
    [merchants],
  );

  function applyPendingOnly(value: boolean) {
    setPendingOnly(value);
    router.replace(value ? '/?needsApproval=1' : '/', { scroll: false });
  }

  async function changeMerchantBalanceMode(
    merchant: ManagedMerchant,
    balanceMode: BalanceMode,
  ) {
    if (merchant.balance_mode === balanceMode) {
      return;
    }

    setUpdatingModeId(merchant.id);

    try {
      const data = await updateMerchantBalanceMode(merchant.id, balanceMode);

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                balance_mode: balanceMode,
                available_balance: Number(data.available_balance),
              }
            : row,
        ),
      );
      toast.success(`${merchant.merchant_name}: portal shows ${balanceMode}`);
    } catch (modeError) {
      toast.error(
        modeError instanceof Error
          ? modeError.message
          : 'Failed to update balance mode',
      );
    } finally {
      setUpdatingModeId(null);
    }
  }

  async function changeMerchantApprovalMode(
    merchant: ManagedMerchant,
    approvalMode: ApprovalMode,
  ) {
    if (merchant.approval_mode === approvalMode) {
      return;
    }

    setUpdatingApprovalId(merchant.id);

    try {
      await updateMerchantApprovalMode(merchant.id, approvalMode);

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                approval_mode: approvalMode,
              }
            : row,
        ),
      );
      toast.success(
        approvalMode === 'auto'
          ? `${merchant.merchant_name}: payouts auto-sent to bank`
          : `${merchant.merchant_name}: payouts need approval`,
      );
    } catch (approvalError) {
      toast.error(
        approvalError instanceof Error
          ? approvalError.message
          : 'Failed to update approval mode',
      );
    } finally {
      setUpdatingApprovalId(null);
    }
  }

  async function saveMerchantDemoBalance(merchant: ManagedMerchant) {
    const nextBalance = Number(demoDraft);
    if (!Number.isFinite(nextBalance) || nextBalance < 0) {
      toast.error('Enter a valid demo balance');
      return;
    }

    setSavingDemoId(merchant.id);

    try {
      const response = await fetch(`/api/users/${merchant.id}/demo-balance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo_balance: nextBalance }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update demo balance');
      }

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                demo_balance: nextBalance,
                available_balance:
                  row.balance_mode === 'demo' ? nextBalance : row.available_balance,
              }
            : row,
        ),
      );
      setEditingDemoId(null);
      toast.success(`${merchant.merchant_name}: demo ${formatCurrency(nextBalance)}`);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update demo balance',
      );
    } finally {
      setSavingDemoId(null);
    }
  }

  async function handleCreateMerchant(event: FormEvent) {
    event.preventDefault();
    setIsCreating(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_name: newMerchantName.trim(),
          username: newUsername.trim(),
          password: newPassword.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to create merchant');
      }

      const va =
        (data.merchant?.virtual_account_no as string | undefined) ?? '';
      const ifsc =
        (data.merchant?.escrow_ifsc as string | undefined) ?? 'HDFC0000060';

      setCreatedMerchant({
        merchant_name: newMerchantName.trim(),
        username: newUsername.trim(),
        password: newPassword.trim(),
        virtual_account_no: va,
        escrow_ifsc: ifsc,
      });
      toast.success(
        va
          ? `Merchant created. VA ${va}`
          : `Merchant "${newMerchantName}" created`,
      );
      setNewMerchantName('');
      setNewUsername('');
      setNewPassword('');
      setOnboardingOpen(false);
      await loadData();
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : 'Failed to create merchant',
      );
    } finally {
      setIsCreating(false);
    }
  }

  function resetOnboardingForm() {
    setNewMerchantName('');
    setNewUsername('');
    setNewPassword('');
  }

  function generateCredentialsFromName(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNewUsername('');
      setNewPassword('');
      return;
    }

    setNewUsername(generateUsernameFromName(trimmed));
    setNewPassword(generatePassword());
  }

  function toggleOnboarding() {
    setOnboardingOpen((open) => {
      if (open) {
        resetOnboardingForm();
        return false;
      }

      resetOnboardingForm();
      setCreatedMerchant(null);
      return true;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merchants"
        description="Manage merchants, balances, and transfers."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={toggleOnboarding}>
              <Plus className="mr-2 h-4 w-4" />
              {onboardingOpen ? 'Close' : 'Add merchant'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadData()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <GlassCard>
        <GlassCardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Company bank · HDFC
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Total − hold = available for payouts
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground"
              onClick={() => void loadCompanyBankBalance()}
            >
              <RefreshCw
                className={cn(
                  'h-3.5 w-3.5',
                  companyBankLoading && 'animate-spin',
                )}
              />
              Last synced {formatSyncedAgo(companyBankSyncedAt)}
            </button>
          </div>

          {companyBankError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {companyBankError}
            </p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1.35fr] sm:items-end">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Total
                  </p>
                  <p className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums text-slate-800 sm:text-2xl">
                    {companyBankLoading || companyBankTotal == null
                      ? '—'
                      : formatCurrency(companyBankTotal)}
                  </p>
                </div>
                <span
                  className="hidden pb-1 text-lg font-medium text-slate-300 sm:block"
                  aria-hidden
                >
                  −
                </span>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700/80">
                    On hold
                  </p>
                  <p className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums text-amber-950 sm:text-2xl">
                    {companyBankLoading || companyBankLien == null
                      ? '—'
                      : formatCurrency(companyBankLien)}
                  </p>
                </div>
                <span
                  className="hidden pb-1 text-lg font-medium text-slate-300 sm:block"
                  aria-hidden
                >
                  =
                </span>
                <div className="rounded-xl bg-emerald-50/90 px-4 py-3 sm:-mb-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800/80">
                    Available
                  </p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-emerald-950 sm:text-3xl">
                    {companyBankLoading || companyBankRemaining == null
                      ? '—'
                      : formatCurrency(companyBankRemaining)}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="w-full shrink-0 sm:w-auto">
                <Link href="/transfers">Transfer funds</Link>
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums text-slate-900">
                {isLoading ? '—' : merchants.length}
              </span>
              <span className="text-muted-foreground">Merchants</span>
            </div>
            <button
              type="button"
              className={cn(
                'flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-50',
                pendingOnly && 'bg-amber-50 text-amber-950',
              )}
              onClick={() => applyPendingOnly(!pendingOnly)}
            >
              <span className="font-semibold tabular-nums">
                {isLoading ? '—' : totalPendingApprovals}
              </span>
              <span
                className={cn(
                  'text-muted-foreground',
                  pendingOnly && 'text-amber-800/80',
                )}
              >
                Pending{pendingOnly ? ' · clear' : ''}
              </span>
            </button>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums text-slate-900">
                {isLoading ? '—' : formatCurrency(totalPendingBalance)}
              </span>
              <span className="text-muted-foreground">Pending balance</span>
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      {onboardingOpen ? (
        <GlassCard className="overflow-hidden border-dashed border-slate-300/80">
          <GlassCardHeader className="space-y-1 px-5 py-4">
            <GlassCardTitle className="text-sm font-medium">
              Onboard merchant
            </GlassCardTitle>
            <p className="text-xs text-muted-foreground">
              Enter the merchant name. We generate a portal username from that
              name and a random password. Virtual account and IFSC are assigned
              after create.
            </p>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4 border-t border-white/50 pt-6">
            <form
              autoComplete="off"
              onSubmit={(e) => void handleCreateMerchant(e)}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="onboard-merchant-name">Merchant name</Label>
                <Input
                  id="onboard-merchant-name"
                  name="merchant_name"
                  required
                  minLength={2}
                  autoComplete="off"
                  placeholder="e.g. Rootpay"
                  value={newMerchantName}
                  onChange={(e) => setNewMerchantName(e.target.value)}
                />
              </div>
              {newUsername && newPassword ? (
                <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Username
                    </p>
                    <p className="font-mono text-sm font-semibold break-all">
                      {newUsername}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Password
                    </p>
                    <p className="font-mono text-sm font-semibold break-all">
                      {newPassword}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => generateCredentialsFromName(newMerchantName)}
                    >
                      Generate again
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Username and password appear here after you enter the merchant
                  name.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Virtual account is auto-assigned (CHAK69 + 6 digits). IFSC
                HDFC0000060.
              </p>
              <Button
                type="submit"
                disabled={isCreating || !newUsername || !newPassword}
              >
                {isCreating ? 'Creating…' : 'Create merchant'}
              </Button>
            </form>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      {createdMerchant ? (
        <GlassCard className="overflow-hidden border-emerald-200/80 bg-emerald-50/40">
          <GlassCardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-5 py-4">
            <div>
              <GlassCardTitle className="text-sm font-medium">
                {createdMerchant.merchant_name} created
              </GlassCardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Copy these now. Username and password are not shown again
                here after you dismiss this.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreatedMerchant(null)}
            >
              Dismiss
            </Button>
          </GlassCardHeader>
          <GlassCardContent className="grid gap-4 border-t border-white/50 pt-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Username
              </p>
              <p className="mt-1 font-mono text-sm font-semibold break-all">
                {createdMerchant.username}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Password
              </p>
              <p className="mt-1 font-mono text-sm font-semibold break-all">
                {createdMerchant.password}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Virtual account
              </p>
              <p className="mt-1 font-mono text-sm font-semibold break-all">
                {createdMerchant.virtual_account_no || 'Assigned on create'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                IFSC
              </p>
              <p className="mt-1 font-mono text-sm font-semibold break-all">
                {createdMerchant.escrow_ifsc}
              </p>
            </div>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      <GlassCard className="overflow-hidden">
        <GlassCardHeader className="flex flex-col gap-4 border-b border-white/50 bg-white/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <GlassCardTitle className="text-base font-semibold">Merchant accounts</GlassCardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isLoading
                ? 'Loading…'
                : pendingOnly
                  ? `${filtered.length} with pending approvals · click a row to open`
                  : `${filtered.length} merchant${filtered.length === 1 ? '' : 's'} · click a row to open`}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:max-w-xs">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search merchants..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 bg-white/60 pl-9 backdrop-blur-sm"
              />
            </div>
            {pendingOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPendingOnly(false)}
              >
                Clear pending filter
              </Button>
            ) : null}
          </div>
        </GlassCardHeader>
        <GlassCardContent className="p-0">
          {error ? (
            <div className="p-5">
              <ErrorCard message={error} onRetry={() => void loadData()} />
            </div>
          ) : isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="mx-5 my-4 h-12 rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyStateIllustrated
                icon={Users}
                title={
                  merchants.length === 0
                    ? 'No merchants yet'
                    : pendingOnly
                      ? 'No pending approvals'
                      : 'No matches'
                }
                description={
                  merchants.length === 0
                    ? 'Onboard your first merchant to get started.'
                    : pendingOnly
                      ? 'No merchants currently have transfers waiting for approval.'
                      : 'Try a different search term.'
                }
                action={
                  merchants.length === 0 ? (
                    <Button size="sm" onClick={() => setOnboardingOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add merchant
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={glassTableHead()}>
                    <th className="px-5 py-3 text-left">Merchant</th>
                    <th className="px-4 py-3 text-right">Collected</th>
                    <th className="px-4 py-3 text-right">Demo (portal)</th>
                    <th className="px-4 py-3 text-right">Pending</th>
                    <th className="px-4 py-3 text-center">Portal</th>
                    <th className="px-4 py-3 text-center">Payouts</th>
                    <th className="w-36 px-5 py-3 text-right" aria-hidden />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/50">
                  {filtered.map((merchant) => {
                    const pendingApprovals = pendingByUser[merchant.id] ?? 0;
                    const isEditingDemo = editingDemoId === merchant.id;
                    const isSavingDemo = savingDemoId === merchant.id;
                    const isUpdatingMode = updatingModeId === merchant.id;
                    const isUpdatingApproval =
                      updatingApprovalId === merchant.id;
                    const usesReal = merchant.balance_mode === 'real';

                    return (
                      <tr
                        key={merchant.id}
                        className={cn(
                          'cursor-pointer',
                          glassTableRow(
                            pendingApprovals > 0 ? 'attention' : 'default',
                          ),
                        )}
                        onClick={() => router.push(`/merchants/${merchant.id}`)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                glassInset(),
                                'flex h-9 w-9 shrink-0 items-center justify-center text-xs font-semibold uppercase text-muted-foreground',
                              )}
                            >
                              {merchant.merchant_name.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-foreground">
                                  {merchant.merchant_name}
                                </span>
                                {merchant.account_status === 'on_hold' ? (
                                  <Badge variant="warning" className="text-[10px]">
                                    On hold
                                  </Badge>
                                ) : null}
                                {merchant.account_status === 'terminated' ? (
                                  <Badge variant="destructive" className="text-[10px]">
                                    Terminated
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {merchant.username}
                                {merchant.virtual_account_no
                                  ? ` · ${merchant.virtual_account_no}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                            <span
                              className={
                                usesReal
                                  ? 'font-semibold tabular-nums text-foreground'
                                  : 'font-medium tabular-nums text-muted-foreground'
                              }
                            >
                              {formatCurrency(merchant.real_balance)}
                            </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isEditingDemo ? (
                            <div
                              className="ml-auto inline-flex flex-col items-end gap-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={demoDraft}
                                onChange={(e) => setDemoDraft(e.target.value)}
                                className="h-8 w-28 text-right tabular-nums"
                              />
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={isSavingDemo}
                                  onClick={() => void saveMerchantDemoBalance(merchant)}
                                >
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isSavingDemo}
                                  onClick={() => setEditingDemoId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <span
                                className={
                                  usesReal
                                    ? 'font-medium tabular-nums text-muted-foreground'
                                    : 'font-semibold tabular-nums text-foreground'
                                }
                              >
                                {formatCurrency(merchant.demo_balance)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Edit demo balance for ${merchant.merchant_name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingDemoId(merchant.id);
                                  setDemoDraft(String(merchant.demo_balance));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(merchant.pending_balance)}
                        </td>
                        <td
                          className="px-4 py-3.5 text-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <BalanceModeToggle
                            value={merchant.balance_mode}
                            disabled={isUpdatingMode}
                            onChange={(mode) =>
                              void changeMerchantBalanceMode(merchant, mode)
                            }
                          />
                        </td>
                        <td
                          className="px-4 py-3.5 text-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ApprovalModeToggle
                            value={merchant.approval_mode ?? 'manual'}
                            disabled={isUpdatingApproval}
                            onChange={(mode) =>
                              void changeMerchantApprovalMode(merchant, mode)
                            }
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {pendingApprovals > 0 ? (
                              <Badge variant="warning" className="text-[10px]">
                                {pendingApprovals} to approve
                              </Badge>
                            ) : null}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
